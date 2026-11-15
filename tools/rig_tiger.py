"""
Rig Tigera v Blenderu (varianta A).

Použití:
    blender --background --python tools/rig_tiger.py -- public/models/tiger.glb public/models/tiger_rigged.glb
nebo s modulem bpy (pip install bpy):
    python tools/rig_tiger.py public/models/tiger.glb public/models/tiger_rigged.glb

Co skript dělá:
  1. načte GLB, opraví síť (svaření zdvojených vrcholů, díry, degenerované plochy, normály),
  2. analyzuje tvar: tlapky, osu těla, hřbet a břicho, osy nohou, ocas, krk, hlavu a uši,
  3. normalizuje model: čumák +Z (glTF), tlapky na Y = 0, výška v kohoutku 0,28 m,
  4. postaví čtyřnohou kostru (pánev, páteř, krk, hlava, čelist, uši, 4 nohy po 4 kostech, ocas),
  5. napojí ji pomocí automatic weights (bone heat), omezí na 4 vlivy a normalizuje,
  6. vyexportuje GLB se skinem. Volitelně uloží kontrolní rendery póz (--preview <složka>).

Stejnou analýzu dělá za běhu i hra (src/cat/RuntimeRig.ts, varianta B) – jména kostí se shodují.
"""
import sys
import os
import math
import json
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix

WITHERS = 0.28  # cílová výška v kohoutku [m]

# ----------------------------------------------------------------------------- pomocné funkce


def kmeans(pts, k, iters=30):
    """k-means s inicializací nejvzdálenějšími body (deterministické)."""
    centers = [pts[np.argmax(pts[:, 0])]]
    for _ in range(k - 1):
        d = np.min([np.linalg.norm(pts - c, axis=1) for c in centers], axis=0)
        centers.append(pts[np.argmax(d)])
    centers = np.array(centers)
    for _ in range(iters):
        d = np.linalg.norm(pts[:, None, :] - centers[None, :, :], axis=2)
        lab = np.argmin(d, axis=1)
        new = np.array([pts[lab == i].mean(0) if np.any(lab == i) else centers[i] for i in range(k)])
        if np.allclose(new, centers, atol=1e-6):
            break
        centers = new
    return centers, lab


def polyline_resample(points, n):
    """Převzorkuje lomenou čáru na n+1 bodů se stejnou délkou úseků."""
    points = np.asarray(points)
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    total = cum[-1]
    out = []
    for i in range(n + 1):
        t = total * i / n
        j = min(np.searchsorted(cum, t, side='right') - 1, len(seg) - 1)
        f = 0 if seg[j] < 1e-9 else (t - cum[j]) / seg[j]
        out.append(points[j] + (points[j + 1] - points[j]) * f)
    return np.array(out)


class Track:
    """Osa končetiny jako funkce výšky y (lineární interpolace + extrapolace)."""

    def __init__(self, pts):
        arr = np.array(sorted(pts, key=lambda p: p[1]))
        self.pts = arr[:, :3]
        self.zmin = arr[:, 3]
        self.zmax = arr[:, 4]

    def extent(self, y):
        """Zadní a přední okraj průřezu končetiny ve výšce y."""
        i = int(np.argmin(np.abs(self.pts[:, 1] - min(y, self.pts[-1, 1]))))
        return self.zmin[i], self.zmax[i]

    def at(self, y):
        p = self.pts
        if y <= p[0, 1]:
            return np.array([p[0, 0], y, p[0, 2]])
        if y >= p[-1, 1]:
            # extrapolace podle sklonu horní části
            k = min(4, len(p) - 1)
            d = p[-1] - p[-1 - k]
            dy = max(d[1], 1e-4)
            t = min((y - p[-1, 1]) / dy, 3.0)
            return np.array([p[-1, 0] + d[0] * t * 0.6, y, p[-1, 2] + d[2] * t * 0.6])
        i = np.searchsorted(p[:, 1], y) - 1
        f = (y - p[i, 1]) / max(p[i + 1, 1] - p[i, 1], 1e-9)
        q = p[i] + (p[i + 1] - p[i]) * f
        q[1] = y
        return q

    @property
    def top(self):
        return self.pts[-1, 1]


# ----------------------------------------------------------------------------- analýza tvaru


def find_frame(P):
    """Najde tlapky, osu těla a transformaci do normalizovaného prostoru.
    Vstup: body v glTF souřadnicích (Y nahoru). Vrací (yaw, scale, origin, info)."""
    y0 = P[:, 1].min()
    H = P[:, 1].max() - y0
    low = P[P[:, 1] < y0 + 0.035 * H]
    centers, _ = kmeans(low[:, [0, 2]], 4)
    # dvě dvojice tlapek podél hlavní osy
    c0 = centers.mean(0)
    u, s, vt = np.linalg.svd(centers - c0)
    axis = vt[0]
    order = np.argsort((centers - c0) @ axis)
    pairA = centers[order[:2]]
    pairB = centers[order[2:]]
    midA = pairA.mean(0)
    midB = pairB.mean(0)
    a = (midB - midA) / np.linalg.norm(midB - midA)
    D = np.linalg.norm(midB - midA)
    # která dvojice je přední? Za předními tlapkami je hlava (široká), za zadními ocas (tenký).
    xz = P[:, [0, 2]]
    proj = (xz - midA) @ a
    perp = (xz - midA) @ np.array([-a[1], a[0]])
    upper = P[:, 1] > y0 + 0.45 * H

    def end_width(mask):
        if mask.sum() < 20:
            return 0.0
        pr = proj[mask]
        widths = []
        for lo, hi in zip(np.linspace(pr.min(), pr.max(), 6)[:-1], np.linspace(pr.min(), pr.max(), 6)[1:]):
            m = mask & (proj >= lo) & (proj < hi)
            if m.sum() > 5:
                widths.append(perp[m].max() - perp[m].min())
        return max(widths) if widths else 0.0

    wB = end_width(upper & (proj > D + 0.12 * D))
    wA = end_width(upper & (proj < -0.12 * D))
    if wA > wB:  # hlava je na straně A → otočit
        a = -a
        midA, midB = midB, midA
        pairA, pairB = pairB, pairA
    hind_mid, front_mid = midA, midB
    yaw = math.atan2(a[0], a[1])  # úhel osy těla od +Z
    # výška v kohoutku: horní obrys hřbetu kousek za předními tlapkami
    proj = (xz - hind_mid) @ a
    perp = (xz - hind_mid) @ np.array([-a[1], a[0]])
    m = (proj > D * 0.78) & (proj < D * 0.95) & (np.abs(perp) < D * 0.25)
    withers = np.percentile(P[m, 1], 99) - y0
    scale = WITHERS / withers
    origin = np.array([(hind_mid[0] + front_mid[0]) / 2, y0, (hind_mid[1] + front_mid[1]) / 2])
    return yaw, scale, origin, dict(D=D * scale, paws_hind=pairA, paws_front=pairB)


def to_norm(P, yaw, scale, origin):
    """glTF → normalizovaný prostor (Z dopředu, Y nahoru, X doleva, metry)."""
    c, s = math.cos(-yaw), math.sin(-yaw)
    Q = P - origin
    x = Q[:, 0] * c + Q[:, 2] * s
    z = -Q[:, 0] * s + Q[:, 2] * c
    return np.stack([x * scale, Q[:, 1] * scale, z * scale], axis=1)


def analyze(N, log=print):
    """Najde klouby v normalizovaném prostoru. Vrací dict jméno → (head, tail) a rodiče."""
    hw = WITHERS
    low = N[N[:, 1] < 0.035 * (N[:, 1].max())]
    centers, _ = kmeans(low[:, [0, 2]], 4)
    order = np.argsort(centers[:, 1])
    hind = centers[order[:2]]
    front = centers[order[2:]]
    hind = hind[np.argsort(-hind[:, 0])]  # [levá (+x), pravá]
    front = front[np.argsort(-front[:, 0])]
    hind_z = hind[:, 1].mean()
    front_z = front[:, 1].mean()
    L = front_z - hind_z
    # posun do středu: sagitální rovina = střed trupu
    torso = N[(N[:, 2] > hind_z + 0.2 * L) & (N[:, 2] < front_z - 0.2 * L) & (N[:, 1] > 0.5 * hw)]
    cx = np.median(torso[:, 0])
    log(f'  délka mezi tlapkami {L:.3f} m, střed trupu x = {cx:+.4f}')

    # --- profil hřbetu a břicha
    def back_y(z):
        m = (np.abs(N[:, 2] - z) < 0.012) & (np.abs(N[:, 0] - cx) < 0.05)
        return np.percentile(N[m, 1], 98) if m.sum() > 3 else hw

    def belly_y(z):
        m = (np.abs(N[:, 2] - z) < 0.012) & (np.abs(N[:, 0] - cx) < 0.012) & (N[:, 1] < 0.8 * hw)
        return N[m, 1].min() if m.sum() > 3 else 0.45 * hw

    def spine_point(z):
        t = back_y(z)
        b = belly_y(z)
        b = min(max(b, t - 0.16), t - 0.07)
        return np.array([cx, t - 0.24 * (t - b), z])

    zp = hind_z + 0.10 * L  # pánev (nad kyčlemi)
    zc = front_z - 0.07 * L  # hrudník (mezi lopatkami)
    spine = [spine_point(zp + (zc - zp) * i / 4) for i in range(5)]

    # --- konec trupu a ocas
    def section_area(z):
        m = (np.abs(N[:, 2] - z) < 0.01) & (N[:, 1] > 0.35 * hw)
        if m.sum() < 4:
            return 0.0
        return (N[m, 0].max() - N[m, 0].min()) * (N[m, 1].max() - N[m, 1].min())

    ref_area = section_area(hind_z + 0.25 * L)
    z_rear = hind_z
    for z in np.arange(hind_z + 0.1 * L, N[:, 2].min(), -0.006):
        if section_area(z) < 0.3 * ref_area:
            z_rear = z
            break
    tail_cloud = N[(N[:, 2] < z_rear - 0.004) & (N[:, 1] > 0.3 * hw)]
    tail_root = np.array([cx, back_y(z_rear + 0.03) - 0.018, z_rear + 0.022])
    if len(tail_cloud) > 30:
        c = tail_cloud.mean(0)
        _, _, vt = np.linalg.svd(tail_cloud - c, full_matrices=False)
        u = vt[0]
        if (c - tail_root) @ u < 0:
            u = -u
        pr = (tail_cloud - tail_root) @ u
        bins = np.linspace(max(pr.min(), 0.0), pr.max(), 14)
        line = [tail_root]
        for lo, hi in zip(bins[:-1], bins[1:]):
            m = (pr >= lo) & (pr < hi)
            if m.sum() > 3:
                line.append(tail_cloud[m].mean(0))
        # špička: nejvzdálenější bod, lehce stažený dovnitř
        tip = tail_cloud[np.argmax(pr)]
        line.append(line[-1] + (tip - line[-1]) * 0.8)
        tail = polyline_resample(line, 7)
    else:
        tail = np.array([tail_root + np.array([0, 0.01 * i, -0.04 * i]) for i in range(8)])
    log(f'  konec trupu z = {z_rear:+.3f}, ocas {np.linalg.norm(np.diff(tail, axis=0), axis=1).sum():.3f} m')

    # --- nohy: sledování osy od tlapky nahoru
    def track_leg(px, pz):
        pts = []
        cur = np.array([px, pz])
        base_n = None
        y = 0.006
        while y < 0.62 * hw:
            m = np.abs(N[:, 1] - y) < 0.006
            d = np.linalg.norm(N[m][:, [0, 2]] - cur, axis=1)
            sel = N[m][d < 0.04]
            wide = int((d < 0.085).sum())
            if len(sel) < 4:
                break
            if base_n is None and y > 0.05:
                base_n = wide
            # splynutí s trupem / druhou nohou: skokový nárůst počtu vrcholů
            if base_n is not None and wide > base_n * 2.6:
                break
            cur = sel[:, [0, 2]].mean(0)
            pts.append([cur[0], y, cur[1], sel[:, 2].min(), sel[:, 2].max()])
            y += 0.008
        return Track(pts)

    bones = {}
    parents = {}

    def add(name, head, tail_, parent):
        bones[name] = (np.array(head, dtype=float), np.array(tail_, dtype=float))
        parents[name] = parent

    names = ['hips', 'spine1', 'spine2', 'spine3', 'chest']
    neck_base = spine[4] + np.array([0, 0.012, 0.035])
    chain = spine + [neck_base]
    add('hips', chain[0], chain[1], 'root')
    for i in range(1, 5):
        add(names[i], chain[i], chain[i + 1], names[i - 1])

    for i in range(7):
        add(f'tail{i + 1}', tail[i], tail[i + 1], 'hips' if i == 0 else f'tail{i}')

    def chain_points(side, sgn, px, pz, is_front):
        t = track_leg(px, pz)
        toe = t.at(0.012) + np.array([0, 0, 0.022])
        mp = t.at(0.024) + np.array([0, 0.0, 0.004])
        if is_front:
            wrist = t.at(0.20 * hw)
            elbow = t.at(0.50 * hw)
            zb, zf = t.extent(0.50 * hw)
            elbow[2] = min(elbow[2], zb + 0.018)  # loket je u zadního okraje
            top = np.array([cx + (elbow[0] - cx) * 0.8, 0.72 * hw, elbow[2] + 0.03])
            pts = [top, elbow, wrist, mp, toe]
        else:
            hock = t.at(0.27 * hw)
            zb, zf = t.extent(0.27 * hw)
            hock[2] = min(hock[2], zb + 0.014)  # hlezno vyčnívá dozadu
            knee = t.at(0.53 * hw)
            zb, zf = t.extent(0.53 * hw)
            knee[2] = max(knee[2], zf - 0.02)  # koleno je u předního okraje stehna
            top = np.array([cx + sgn * 0.036, 0.78 * hw, spine[0][2] - 0.012])
            pts = [top, knee, hock, mp, toe]
        log(f'  {"přední" if is_front else "zadní"} {side}: osa sledována do {t.top:.3f} m')
        return [np.array(p, dtype=float) for p in pts]

    def symmetrize(a, b):
        """Sjednotí délky segmentů levé a pravé nohy (směry zůstanou)."""
        for pts_a, pts_b in ((a, b),):
            for i in range(len(pts_a) - 1):
                la = np.linalg.norm(pts_a[i + 1] - pts_a[i])
                lb = np.linalg.norm(pts_b[i + 1] - pts_b[i])
                target = (la + lb) / 2
                for pts, l in ((pts_a, la), (pts_b, lb)):
                    d = (pts[i + 1] - pts[i]) / max(l, 1e-6)
                    shift = pts[i] + d * target - pts[i + 1]
                    for j in range(i + 1, len(pts)):
                        pts[j] = pts[j] + shift
        # tlapky zpět na zem
        for pts in (a, b):
            dy = 0.012 - pts[-1][1]
            pts[-1][1] += dy
            pts[-2][1] = max(0.02, pts[-2][1] + dy)
        return a, b

    for is_front, pair, prefix, parent in ((True, front, 'front', 'chest'), (False, hind, 'hind', 'hips')):
        left = chain_points('L', 1, pair[0][0], pair[0][1], is_front)
        right = chain_points('R', -1, pair[1][0], pair[1][1], is_front)
        left, right = symmetrize(left, right)
        for side, pts in (('L', left), ('R', right)):
            add(f'{prefix}Upper{side}', pts[0], pts[1], parent)
            add(f'{prefix}Lower{side}', pts[1], pts[2], f'{prefix}Upper{side}')
            add(f'{prefix}Foot{side}', pts[2], pts[3], f'{prefix}Lower{side}')
            add(f'{prefix}Paw{side}', pts[3], pts[4], f'{prefix}Foot{side}')

    # --- hlava a krk (orientace podle špiček uší – vousky a límec ji nezmatou)
    chest_pt = spine[4]
    up = np.array([0, 1.0, 0])
    cloud = N[(N[:, 2] > front_z + 0.0) & (N[:, 1] > 0.62 * hw)]
    ear1 = cloud[np.argmax(cloud[:, 1])]
    far = np.linalg.norm(cloud[:, [0, 2]] - ear1[[0, 2]], axis=1) > 0.032
    high = cloud[far & (cloud[:, 1] > ear1[1] - 0.03)]
    ear2 = high[np.argmax(high[:, 1])] if len(high) else ear1 + np.array([0.05, 0, 0])
    side_v = ear1 - ear2
    side_v[1] = 0
    side_v /= np.linalg.norm(side_v)
    fwd = np.cross(side_v, up)
    ear_mid = (ear1 + ear2) / 2
    if fwd @ (ear_mid - chest_pt) < 0:  # dopředu = od hrudníku
        fwd = -fwd
    side_v = np.cross(up, fwd)  # doleva z pohledu hlavy
    # střed lebky: uši sedí vzadu nahoře na hlavě
    center = ear_mid - up * 0.066 + fwd * 0.012
    fwd_ears = fwd.copy()
    ear_l, ear_r = (ear1, ear2) if (ear1 - center) @ side_v > 0 else (ear2, ear1)
    # čenich: nejvzdálenější bod v úzkém válci kolem osy hlavy (pod úrovní očí)
    rel = cloud - center
    along = rel @ fwd
    lateral = np.abs(rel @ side_v)
    m = (lateral < 0.016) & (rel[:, 1] < 0.006) & (rel[:, 1] > -0.036) & (along > 0)
    nose = cloud[m][np.argmax(along[m])] if m.sum() else center + fwd * 0.05
    log(f'  uši {ear_l.round(3)} {ear_r.round(3)}, osa hlavy z uší {fwd.round(3)}, bodů ve válci {int(m.sum())}, dosah {float(along[m].max()) if m.sum() else 0:.3f}')
    fwd = fwd_ears
    head_joint = center - fwd * 0.034 - up * 0.004
    neck_mid = (neck_base + head_joint) / 2 + up * 0.004
    add('neck1', neck_base, neck_mid, 'chest')
    add('neck2', neck_mid, head_joint, 'neck1')
    add('head', head_joint, center + fwd * 0.03 + up * 0.004, 'neck2')
    add('jaw', center + fwd * 0.004 - up * 0.022, nose - up * 0.02 - fwd * 0.008, 'head')
    for nm, tip in (('earL', ear_l), ('earR', ear_r)):
        base = center + (tip - center) * 0.5
        add(nm, base, base + (tip - base) * 0.92, 'head')
    head_yaw = math.degrees(math.atan2(fwd_ears[0], fwd_ears[2]))
    log(f'  hlava: střed {center.round(3)}, čenich {nose.round(3)}, natočení {head_yaw:+.1f}°')
    meta = dict(headYawDeg=head_yaw, nose=nose.tolist(), headCenter=center.tolist(), centerX=float(cx))
    return bones, parents, meta


# ----------------------------------------------------------------------------- Blender


def clean_mesh(ob, log=print):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    boundary = [e for e in bm.edges if e.is_boundary]
    nb = len(boundary)
    if boundary:
        bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    left = sum(1 for e in bm.edges if e.is_boundary)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    log(f'  vrcholy {n0} → {len(me.vertices)}, okraje děr {nb} → {left}, non-manifold hrany {nm}')


def auto_weights(ob, arm, bones, bl):
    """Automatic weights (bone heat). Na původní síti často selže (není vodotěsná), proto se váhy
    spočítají na voxelově přesíťované kopii a přenesou zpět podle nejbližšího povrchu."""

    def try_heat(target):
        for g in list(target.vertex_groups):
            target.vertex_groups.remove(g)
        bpy.ops.object.select_all(action='DESELECT')
        target.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        return sum(1 for v in target.data.vertices if len(v.groups) == 0)

    method = 'bone heat'
    missing = try_heat(ob)
    if missing > len(ob.data.vertices) * 0.02:
        print(f'  bone heat na původní síti selhal ({missing} vrcholů bez vah) → voxelová kopie')
        # zrušit rodičovství z neúspěšného pokusu
        for m in list(ob.modifiers):
            ob.modifiers.remove(m)
        ob.parent = None
        for g in list(ob.vertex_groups):
            ob.vertex_groups.remove(g)
        proxy = ob.copy()
        proxy.data = ob.data.copy()
        proxy.name = 'TigerProxy'
        bpy.context.scene.collection.objects.link(proxy)
        bpy.ops.object.select_all(action='DESELECT')
        proxy.select_set(True)
        bpy.context.view_layer.objects.active = proxy
        # bone heat je citlivý na tvar sítě → zkusit několik velikostí voxelu a vzít nejlepší
        best = None
        for voxel in (0.006, 0.005, 0.007, 0.008, 0.0045):
            proxy.data = ob.data.copy()
            proxy.data.remesh_voxel_size = voxel
            proxy.data.remesh_voxel_adaptivity = 0.0
            bpy.ops.object.select_all(action='DESELECT')
            proxy.select_set(True)
            bpy.context.view_layer.objects.active = proxy
            bpy.ops.object.voxel_remesh()
            miss = try_heat(proxy)
            total = len(proxy.data.vertices)
            print(f'  voxel {voxel * 1000:.1f} mm: {total} vrcholů, bez vah {miss}')
            if best is None or miss / total < best[0]:
                best = (miss / total, voxel)
            if miss == 0:
                break
        ok = best is not None and best[0] < 0.02
        if ok and miss != 0:
            # vrátit se k nejlepší velikosti
            proxy.data = ob.data.copy()
            proxy.data.remesh_voxel_size = best[1]
            bpy.ops.object.select_all(action='DESELECT')
            proxy.select_set(True)
            bpy.context.view_layer.objects.active = proxy
            bpy.ops.object.voxel_remesh()
            try_heat(proxy)
        missing_p = 0 if ok else 1
        if missing_p == 0:
            method = 'bone heat (voxelová kopie + přenos vah)'
            for b in arm.data.bones:
                if b.use_deform and b.name not in ob.vertex_groups:
                    ob.vertex_groups.new(name=b.name)
            mod = ob.modifiers.new('WeightTransfer', 'DATA_TRANSFER')
            mod.object = proxy
            mod.use_vert_data = True
            mod.data_types_verts = {'VGROUP_WEIGHTS'}
            mod.vert_mapping = 'POLYINTERP_NEAREST'
            mod.layers_vgroup_select_src = 'ALL'
            mod.layers_vgroup_select_dst = 'NAME'
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=mod.name)
            ob.parent = arm
            am = ob.modifiers.new('Armature', 'ARMATURE')
            am.object = arm
        else:
            method = 'envelope'
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            arm.select_set(True)
            bpy.context.view_layer.objects.active = arm
            bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')
        bpy.data.objects.remove(proxy, do_unlink=True)
    # vrcholy bez vah navázat na nejbližší kost
    heads = {n: np.array(bl(h)) for n, (h, t) in bones.items()}
    fixed = 0
    for v in ob.data.vertices:
        if sum(g.weight for g in v.groups) < 1e-4:
            p = np.array(v.co)
            n = min(heads, key=lambda k: np.linalg.norm(heads[k] - p))
            ob.vertex_groups[n].add([v.index], 1.0, 'REPLACE')
            fixed += 1
    if fixed:
        print(f'  {fixed} vrcholů bez vah navázáno na nejbližší kost')
    return method


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    preview = None
    analyze_only = '--analyze-only' in argv
    argv = [a for a in argv if a != '--analyze-only']
    if '--preview' in argv:
        i = argv.index('--preview')
        preview = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if len(argv) < 2:
        print(__doc__)
        sys.exit(1)
    src, dst = os.path.abspath(argv[0]), os.path.abspath(argv[1])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise SystemExit('V souboru není žádná síť.')
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.name = 'Tiger'

    print('[1/6] oprava sítě')
    clean_mesh(ob)

    print('[2/6] analýza tvaru')
    me = ob.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    B = co.reshape(-1, 3)
    P = np.stack([B[:, 0], B[:, 2], -B[:, 1]], axis=1)  # Blender (Z nahoru) → glTF (Y nahoru)
    yaw, scale, origin, info = find_frame(P)
    print(f'  osa těla {math.degrees(yaw):+.1f}° od +Z, měřítko {scale:.4f}, vzdálenost tlapek {info["D"]:.3f} m')
    N = to_norm(P, yaw, scale, origin)

    print('[3/6] normalizace a kostra')
    bones, parents, meta = analyze(N)
    if analyze_only:
        for k, (h, t) in bones.items():
            print(f'    {k:14s} {np.round(h, 3)} → {np.round(t, 3)}  ({np.linalg.norm(t - h) * 100:.1f} cm)')
        return
    # vystředit na sagitální rovinu trupu
    cx = meta['centerX']
    N[:, 0] -= cx
    for k in bones:
        bones[k][0][0] -= cx
        bones[k][1][0] -= cx
    Bn = np.stack([N[:, 0], -N[:, 2], N[:, 1]], axis=1)  # zpět do Blenderu
    me.vertices.foreach_set('co', Bn.reshape(-1))
    me.update()
    size = N.max(0) - N.min(0)
    print(f'  rozměry: šířka {size[0]:.3f}, výška {size[1]:.3f}, délka {size[2]:.3f} m')

    def bl(p):
        return Vector((float(p[0]), float(-p[2]), float(p[1])))

    arm_data = bpy.data.armatures.new('TigerRig')
    arm = bpy.data.objects.new('TigerRig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    root = eb.new('root')
    root.head = Vector((0, 0, 0))
    root.tail = Vector((0, 0, 0.05))
    root.use_deform = False
    made = {'root': root}
    for name, (head, tail) in bones.items():
        b = eb.new(name)
        b.head = bl(head)
        b.tail = bl(tail)
        if (b.tail - b.head).length < 0.004:
            b.tail = b.head + Vector((0, 0, 0.004))
        made[name] = b
    for name, parent in parents.items():
        made[name].parent = made[parent]
        made[name].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')

    print('[4/6] automatic weights')
    method = auto_weights(ob, arm, bones, bl)
    print(f'  metoda: {method}')

    print('[5/6] omezení na 4 vlivy, vyhlazení, normalizace')
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    try:
        bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=2, expand=0.0)
    except Exception as e:  # noqa: BLE001
        print('  vyhlazení vah přeskočeno:', e)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # materiál: emisní textura je černá → odpojit emisi
    for m in bpy.data.materials:
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    em = n.inputs.get('Emission Strength')
                    if em:
                        em.default_value = 0.0
                    for key in ('Emission Color', 'Emission'):
                        sock = n.inputs.get(key)
                        if sock:
                            for link in list(sock.links):
                                m.node_tree.links.remove(link)
                            sock.default_value = (0, 0, 0, 1)
        m.use_backface_culling = True

    arm['tiger_meta'] = json.dumps(meta)

    if preview:
        render_previews(ob, arm, preview)

    print('[6/6] export', dst)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        use_selection=True,
        export_skins=True,
        export_animations=False,
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_image_format='AUTO',
        export_all_influences=False,
    )
    print('hotovo:', os.path.getsize(dst) // 1024, 'kB, kostí:', len(bones) + 1)


def render_previews(ob, arm, outdir):
    """Kontrolní rendery: klidová póza + několik testovacích póz (deformace vah)."""
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 560
    scene.render.resolution_y = 420
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 0.75

    def shoot(name, pos):
        cam.location = Vector(pos)
        d = Vector((0, 0, 0.16)) - Vector(pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(outdir, name + '.png')
        bpy.ops.render.render(write_still=True)

    def pose(rots):
        for pb in arm.pose.bones:
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (0, 0, 0)
        for name, (axis, deg) in rots.items():
            pb = arm.pose.bones[name]
            # rotace ve světových osách Blenderu kolem hlavy kosti
            q = Matrix.Rotation(math.radians(deg), 4, axis)
            rest = arm.data.bones[name].matrix_local
            parent = arm.data.bones[name].parent
            pm = parent.matrix_local if parent else Matrix.Identity(4)
            local_rest = pm.inverted() @ rest
            world_now = (pb.parent.matrix if pb.parent else Matrix.Identity(4)) @ local_rest
            loc = world_now.to_translation()
            new_world = Matrix.Translation(loc) @ q @ Matrix.Translation(-loc) @ world_now
            pb.matrix = new_world
            bpy.context.view_layer.update()

    shoot('rig_rest_side', (3, 0, 0.16))
    shoot('rig_rest_front', (0, -3, 0.3))
    # póza 1: zvednutá přední tlapka, hlava dopředu, ocas dolů
    pose({'frontUpperL': ('X', -55), 'frontLowerL': ('X', 70), 'neck1': ('Z', 20), 'head': ('Z', 22), 'tail1': ('X', -35), 'tail3': ('X', -25), 'tail5': ('X', -25)})
    shoot('rig_pose1_side', (3, 0, 0.16))
    shoot('rig_pose1_q', (2, -2, 1.0))
    # póza 2: sed – zadní nohy složené, páteř zvednutá
    pose({'hindUpperL': ('X', -60), 'hindUpperR': ('X', -75), 'hindLowerL': ('X', 95), 'hindLowerR': ('X', 100), 'hindFootL': ('X', -70), 'hindFootR': ('X', -65), 'spine2': ('X', 12), 'chest': ('X', 10)})
    shoot('rig_pose2_side', (-3, 0, 0.16))
    pose({})


if __name__ == '__main__':
    main()
