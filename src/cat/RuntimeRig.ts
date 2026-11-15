import * as THREE from 'three';

/**
 * Varianta B – rig Tigera za běhu (funguje vždy, i bez Blenderu).
 *
 * Stejný postup jako tools/rig_tiger.py: analýza průřezů sítě → klouby → kostra se stejnými jmény
 * kostí. Váhy se počítají ze vzdálenosti vrcholů k úsečkám kostí s hladkým útlumem (nohy jen na
 * své straně těla), vyhladí se po sousedech v síti, omezí na 4 vlivy a normalizují.
 */

export interface RuntimeRigResult {
  holder: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  headYawDeg: number;
}

const WITHERS = 0.28;
type V3 = [number, number, number];

interface BoneDef {
  name: string;
  head: V3;
  tail: V3;
  parent: string;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

/** k-means ve 2D s inicializací nejvzdálenějšími body. */
function kmeans2(pts: Array<[number, number]>, k: number): Array<[number, number]> {
  let centers: Array<[number, number]> = [pts.reduce((a, b) => (b[0] > a[0] ? b : a), pts[0])];
  while (centers.length < k) {
    let best = pts[0];
    let bd = -1;
    for (const p of pts) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, Math.hypot(p[0] - c[0], p[1] - c[1]));
      if (d > bd) {
        bd = d;
        best = p;
      }
    }
    centers.push([best[0], best[1]]);
  }
  for (let it = 0; it < 30; it++) {
    const sum = centers.map(() => [0, 0, 0]);
    for (const p of pts) {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      sum[bi][0] += p[0];
      sum[bi][1] += p[1];
      sum[bi][2]++;
    }
    centers = centers.map((c, i) => (sum[i][2] ? [sum[i][0] / sum[i][2], sum[i][1] / sum[i][2]] : c));
  }
  return centers;
}

/** Osa končetiny jako funkce výšky. */
class Track {
  constructor(readonly pts: Array<{ p: V3; zmin: number; zmax: number }>) {}
  get top(): number {
    return this.pts.length ? this.pts[this.pts.length - 1].p[1] : 0;
  }
  at(y: number): V3 {
    const p = this.pts;
    if (!p.length) return [0, y, 0];
    if (y <= p[0].p[1]) return [p[0].p[0], y, p[0].p[2]];
    const last = p[p.length - 1].p;
    if (y >= last[1]) {
      const k = Math.min(4, p.length - 1);
      const d = sub(last, p[p.length - 1 - k].p);
      const dy = Math.max(d[1], 1e-4);
      const t = Math.min((y - last[1]) / dy, 3);
      return [last[0] + d[0] * t * 0.6, y, last[2] + d[2] * t * 0.6];
    }
    let i = 0;
    while (i < p.length - 2 && p[i + 1].p[1] < y) i++;
    const f = (y - p[i].p[1]) / Math.max(p[i + 1].p[1] - p[i].p[1], 1e-9);
    const q = lerp3(p[i].p, p[i + 1].p, f);
    q[1] = y;
    return q;
  }
  extent(y: number): [number, number] {
    let best = this.pts[0];
    for (const s of this.pts) if (Math.abs(s.p[1] - Math.min(y, this.top)) < Math.abs(best.p[1] - Math.min(y, this.top))) best = s;
    return [best.zmin, best.zmax];
  }
}

function resample(points: V3[], n: number): V3[] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const l = len(sub(points[i + 1], points[i]));
    seg.push(l);
    total += l;
  }
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    let t = (total * i) / n;
    let j = 0;
    while (j < seg.length - 1 && t > seg[j]) {
      t -= seg[j];
      j++;
    }
    out.push(lerp3(points[j], points[j + 1], seg[j] < 1e-9 ? 0 : Math.min(1, t / seg[j])));
  }
  return out;
}

/** Analýza tvaru: vrátí normalizované polohy vrcholů, definice kostí a natočení hlavy. */
function analyze(P: Float32Array): { N: Float32Array; bones: BoneDef[]; headYawDeg: number; yaw: number } | null {
  const n = P.length / 3;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    y0 = Math.min(y0, P[i * 3 + 1]);
    y1 = Math.max(y1, P[i * 3 + 1]);
  }
  const H = y1 - y0;
  // --- tlapky a osa těla
  const low: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) if (P[i * 3 + 1] < y0 + 0.035 * H) low.push([P[i * 3], P[i * 3 + 2]]);
  if (low.length < 16) return null;
  const c4 = kmeans2(low, 4);
  // hlavní osa čtyř středů: nejvzdálenější dvojice určí směr
  let ax: [number, number] = [0, 1];
  let far = 0;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const d = Math.hypot(c4[i][0] - c4[j][0], c4[i][1] - c4[j][1]);
    if (d > far) {
      far = d;
      ax = [(c4[j][0] - c4[i][0]) / d, (c4[j][1] - c4[i][1]) / d];
    }
  }
  const sorted = [...c4].sort((a, b) => a[0] * ax[0] + a[1] * ax[1] - (b[0] * ax[0] + b[1] * ax[1]));
  let midA: [number, number] = [(sorted[0][0] + sorted[1][0]) / 2, (sorted[0][1] + sorted[1][1]) / 2];
  let midB: [number, number] = [(sorted[2][0] + sorted[3][0]) / 2, (sorted[2][1] + sorted[3][1]) / 2];
  let D = Math.hypot(midB[0] - midA[0], midB[1] - midA[1]);
  let a: [number, number] = [(midB[0] - midA[0]) / D, (midB[1] - midA[1]) / D];
  // přední konec = ten širší (hlava s ušima), zadní = tenký ocas
  const endWidth = (sign: number): number => {
    let best = 0;
    const bins = new Map<number, [number, number]>();
    for (let i = 0; i < n; i++) {
      if (P[i * 3 + 1] < y0 + 0.45 * H) continue;
      const px = P[i * 3] - midA[0];
      const pz = P[i * 3 + 2] - midA[1];
      const pr = px * a[0] + pz * a[1];
      const pe = -px * a[1] + pz * a[0];
      const beyond = sign > 0 ? pr - D - 0.12 * D : -pr - 0.12 * D;
      if (beyond < 0) continue;
      const b = Math.floor(beyond / (0.08 * D));
      const e = bins.get(b) ?? [Infinity, -Infinity];
      e[0] = Math.min(e[0], pe);
      e[1] = Math.max(e[1], pe);
      bins.set(b, e);
    }
    for (const e of bins.values()) best = Math.max(best, e[1] - e[0]);
    return best;
  };
  if (endWidth(-1) > endWidth(1)) {
    a = [-a[0], -a[1]];
    const t = midA;
    midA = midB;
    midB = t;
  }
  const yaw = Math.atan2(a[0], a[1]);
  // výška v kohoutku
  const wy: number[] = [];
  for (let i = 0; i < n; i++) {
    const px = P[i * 3] - midA[0];
    const pz = P[i * 3 + 2] - midA[1];
    const pr = px * a[0] + pz * a[1];
    const pe = -px * a[1] + pz * a[0];
    if (pr > D * 0.78 && pr < D * 0.95 && Math.abs(pe) < D * 0.25) wy.push(P[i * 3 + 1]);
  }
  const withers = percentile(wy, 99) - y0;
  if (!(withers > 0)) return null;
  const scale = WITHERS / withers;
  const ox = (midA[0] + midB[0]) / 2;
  const oz = (midA[1] + midB[1]) / 2;
  // --- normalizace
  const N = new Float32Array(P.length);
  const cs = Math.cos(-yaw);
  const sn = Math.sin(-yaw);
  for (let i = 0; i < n; i++) {
    const qx = P[i * 3] - ox;
    const qz = P[i * 3 + 2] - oz;
    N[i * 3] = (qx * cs + qz * sn) * scale;
    N[i * 3 + 1] = (P[i * 3 + 1] - y0) * scale;
    N[i * 3 + 2] = (-qx * sn + qz * cs) * scale;
  }
  D *= scale;
  const hw = WITHERS;
  const X = (i: number) => N[i * 3];
  const Yv = (i: number) => N[i * 3 + 1];
  const Zv = (i: number) => N[i * 3 + 2];
  let maxY = 0;
  let minZ = Infinity;
  for (let i = 0; i < n; i++) {
    maxY = Math.max(maxY, Yv(i));
    minZ = Math.min(minZ, Zv(i));
  }
  const lowN: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) if (Yv(i) < 0.035 * maxY) lowN.push([X(i), Zv(i)]);
  const paws = kmeans2(lowN, 4).sort((p, q) => p[1] - q[1]);
  const hind = [paws[0], paws[1]].sort((p, q) => q[0] - p[0]);
  const front = [paws[2], paws[3]].sort((p, q) => q[0] - p[0]);
  const hindZ = (hind[0][1] + hind[1][1]) / 2;
  const frontZ = (front[0][1] + front[1][1]) / 2;
  const L = frontZ - hindZ;
  const torsoX: number[] = [];
  for (let i = 0; i < n; i++) if (Zv(i) > hindZ + 0.2 * L && Zv(i) < frontZ - 0.2 * L && Yv(i) > 0.5 * hw) torsoX.push(X(i));
  const cx = percentile(torsoX, 50);

  // prostorová mřížka po ose Z pro rychlé dotazy na průřezy
  const zBins = new Map<number, number[]>();
  const BIN = 0.012;
  for (let i = 0; i < n; i++) {
    const k = Math.round(Zv(i) / BIN);
    let arr = zBins.get(k);
    if (!arr) zBins.set(k, (arr = []));
    arr.push(i);
  }
  const slice = (z: number, half: number): number[] => {
    const out: number[] = [];
    for (let k = Math.round((z - half) / BIN); k <= Math.round((z + half) / BIN); k++) {
      const arr = zBins.get(k);
      if (arr) for (const i of arr) if (Math.abs(Zv(i) - z) < half) out.push(i);
    }
    return out;
  };
  const backY = (z: number): number => {
    const ys = slice(z, 0.012).filter((i) => Math.abs(X(i) - cx) < 0.05).map(Yv);
    return ys.length > 3 ? percentile(ys, 98) : hw;
  };
  const bellyY = (z: number): number => {
    const ys = slice(z, 0.012).filter((i) => Math.abs(X(i) - cx) < 0.012 && Yv(i) < 0.8 * hw).map(Yv);
    return ys.length > 3 ? Math.min(...ys) : 0.45 * hw;
  };
  const spinePoint = (z: number): V3 => {
    const t = backY(z);
    const b = Math.min(Math.max(bellyY(z), t - 0.16), t - 0.07);
    return [cx, t - 0.24 * (t - b), z];
  };
  const zp = hindZ + 0.1 * L;
  const zc = frontZ - 0.07 * L;
  const spine: V3[] = [];
  for (let i = 0; i < 5; i++) spine.push(spinePoint(zp + ((zc - zp) * i) / 4));

  // --- konec trupu a ocas
  const sectionArea = (z: number): number => {
    const ids = slice(z, 0.01).filter((i) => Yv(i) > 0.35 * hw);
    if (ids.length < 4) return 0;
    let x0 = Infinity, x1 = -Infinity, ya = Infinity, yb = -Infinity;
    for (const i of ids) {
      x0 = Math.min(x0, X(i));
      x1 = Math.max(x1, X(i));
      ya = Math.min(ya, Yv(i));
      yb = Math.max(yb, Yv(i));
    }
    return (x1 - x0) * (yb - ya);
  };
  const refArea = sectionArea(hindZ + 0.25 * L);
  let zRear = hindZ;
  for (let z = hindZ + 0.1 * L; z > minZ; z -= 0.006) {
    if (sectionArea(z) < 0.3 * refArea) {
      zRear = z;
      break;
    }
  }
  const tailRoot: V3 = [cx, backY(zRear + 0.03) - 0.018, zRear + 0.022];
  const tailIds: number[] = [];
  for (let i = 0; i < n; i++) if (Zv(i) < zRear - 0.004 && Yv(i) > 0.3 * hw) tailIds.push(i);
  let tail: V3[];
  if (tailIds.length > 30) {
    // hlavní směr ocasu: od kořene k těžišti, zpřesněný k nejvzdálenějšímu bodu
    const c: V3 = [0, 0, 0];
    for (const i of tailIds) {
      c[0] += X(i);
      c[1] += Yv(i);
      c[2] += Zv(i);
    }
    const u = norm(sub(mul(c, 1 / tailIds.length), tailRoot));
    let maxPr = 0;
    for (const i of tailIds) maxPr = Math.max(maxPr, dot(sub([X(i), Yv(i), Zv(i)], tailRoot), u));
    const bins = 13;
    const acc: Array<[number, number, number, number]> = Array.from({ length: bins }, () => [0, 0, 0, 0]);
    let tip: V3 = tailRoot;
    let tipPr = -1;
    for (const i of tailIds) {
      const p: V3 = [X(i), Yv(i), Zv(i)];
      const pr = dot(sub(p, tailRoot), u);
      if (pr < 0) continue;
      const b = Math.min(bins - 1, Math.floor((pr / maxPr) * bins));
      acc[b][0] += p[0];
      acc[b][1] += p[1];
      acc[b][2] += p[2];
      acc[b][3]++;
      if (pr > tipPr) {
        tipPr = pr;
        tip = p;
      }
    }
    const line: V3[] = [tailRoot];
    for (const b of acc) if (b[3] > 3) line.push([b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
    const lastP = line[line.length - 1];
    line.push(lerp3(lastP, tip, 0.8));
    tail = resample(line, 7);
  } else {
    tail = Array.from({ length: 8 }, (_, i) => add(tailRoot, [0, 0.01 * i, -0.04 * i]));
  }

  // --- nohy
  const yBins = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (Yv(i) > 0.7 * hw) continue;
    const k = Math.round(Yv(i) / 0.006);
    let arr = yBins.get(k);
    if (!arr) yBins.set(k, (arr = []));
    arr.push(i);
  }
  const trackLeg = (px: number, pz: number): Track => {
    const pts: Array<{ p: V3; zmin: number; zmax: number }> = [];
    let cxl = px;
    let czl = pz;
    let baseN = -1;
    for (let y = 0.006; y < 0.62 * hw; y += 0.008) {
      let sx = 0, sz = 0, cnt = 0, wide = 0, zmin = Infinity, zmax = -Infinity;
      for (let k = Math.round((y - 0.006) / 0.006); k <= Math.round((y + 0.006) / 0.006); k++) {
        const arr = yBins.get(k);
        if (!arr) continue;
        for (const i of arr) {
          if (Math.abs(Yv(i) - y) >= 0.006) continue;
          const d = Math.hypot(X(i) - cxl, Zv(i) - czl);
          if (d < 0.085) wide++;
          if (d < 0.04) {
            sx += X(i);
            sz += Zv(i);
            cnt++;
            zmin = Math.min(zmin, Zv(i));
            zmax = Math.max(zmax, Zv(i));
          }
        }
      }
      if (cnt < 4) break;
      if (baseN < 0 && y > 0.05) baseN = wide;
      if (baseN > 0 && wide > baseN * 2.6) break;
      cxl = sx / cnt;
      czl = sz / cnt;
      pts.push({ p: [cxl, y, czl], zmin, zmax });
    }
    return new Track(pts);
  };
  const chain = (sgn: number, px: number, pz: number, isFront: boolean): V3[] => {
    const t = trackLeg(px, pz);
    const toe = add(t.at(0.012), [0, 0, 0.022]);
    const mp = add(t.at(0.024), [0, 0, 0.004]);
    if (isFront) {
      const wrist = t.at(0.2 * hw);
      const elbow = t.at(0.5 * hw);
      elbow[2] = Math.min(elbow[2], t.extent(0.5 * hw)[0] + 0.018);
      const top: V3 = [cx + (elbow[0] - cx) * 0.8, 0.72 * hw, elbow[2] + 0.03];
      return [top, elbow, wrist, mp, toe];
    }
    const hock = t.at(0.27 * hw);
    hock[2] = Math.min(hock[2], t.extent(0.27 * hw)[0] + 0.014);
    const knee = t.at(0.53 * hw);
    knee[2] = Math.max(knee[2], t.extent(0.53 * hw)[1] - 0.02);
    const top: V3 = [cx + sgn * 0.036, 0.78 * hw, spine[0][2] - 0.012];
    return [top, knee, hock, mp, toe];
  };
  const symmetrize = (A: V3[], B: V3[]) => {
    for (let i = 0; i < A.length - 1; i++) {
      const la = len(sub(A[i + 1], A[i]));
      const lb = len(sub(B[i + 1], B[i]));
      const target = (la + lb) / 2;
      for (const [pts, l] of [[A, la], [B, lb]] as Array<[V3[], number]>) {
        const d = mul(sub(pts[i + 1], pts[i]), 1 / Math.max(l, 1e-6));
        const shift = sub(add(pts[i], mul(d, target)), pts[i + 1]);
        for (let j = i + 1; j < pts.length; j++) pts[j] = add(pts[j], shift);
      }
    }
    for (const pts of [A, B]) {
      const dy = 0.012 - pts[pts.length - 1][1];
      pts[pts.length - 1][1] += dy;
      pts[pts.length - 2][1] = Math.max(0.02, pts[pts.length - 2][1] + dy);
    }
  };

  const bones: BoneDef[] = [];
  const addBone = (name: string, head: V3, tailP: V3, parent: string) => bones.push({ name, head: [...head] as V3, tail: [...tailP] as V3, parent });
  const names = ['hips', 'spine1', 'spine2', 'spine3', 'chest'];
  const neckBase = add(spine[4], [0, 0.012, 0.035]);
  const sp = [...spine, neckBase];
  addBone('hips', sp[0], sp[1], 'root');
  for (let i = 1; i < 5; i++) addBone(names[i], sp[i], sp[i + 1], names[i - 1]);
  for (let i = 0; i < 7; i++) addBone(`tail${i + 1}`, tail[i], tail[i + 1], i === 0 ? 'hips' : `tail${i}`);
  for (const [isFront, pair, prefix, parent] of [[true, front, 'front', 'chest'], [false, hind, 'hind', 'hips']] as Array<[boolean, Array<[number, number]>, string, string]>) {
    const left = chain(1, pair[0][0], pair[0][1], isFront);
    const right = chain(-1, pair[1][0], pair[1][1], isFront);
    symmetrize(left, right);
    for (const [side, pts] of [['L', left], ['R', right]] as Array<[string, V3[]]>) {
      addBone(`${prefix}Upper${side}`, pts[0], pts[1], parent);
      addBone(`${prefix}Lower${side}`, pts[1], pts[2], `${prefix}Upper${side}`);
      addBone(`${prefix}Foot${side}`, pts[2], pts[3], `${prefix}Lower${side}`);
      addBone(`${prefix}Paw${side}`, pts[3], pts[4], `${prefix}Foot${side}`);
    }
  }

  // --- hlava (orientace podle špiček uší)
  const up: V3 = [0, 1, 0];
  const cloud: number[] = [];
  for (let i = 0; i < n; i++) if (Zv(i) > frontZ && Yv(i) > 0.62 * hw) cloud.push(i);
  if (cloud.length < 20) return null;
  const pt = (i: number): V3 => [X(i), Yv(i), Zv(i)];
  let e1 = cloud[0];
  for (const i of cloud) if (Yv(i) > Yv(e1)) e1 = i;
  const ear1 = pt(e1);
  let e2 = -1;
  for (const i of cloud) {
    if (Math.hypot(X(i) - ear1[0], Zv(i) - ear1[2]) <= 0.032 || Yv(i) < ear1[1] - 0.03) continue;
    if (e2 < 0 || Yv(i) > Yv(e2)) e2 = i;
  }
  const ear2: V3 = e2 >= 0 ? pt(e2) : add(ear1, [0.05, 0, 0]);
  let sideV = sub(ear1, ear2);
  sideV[1] = 0;
  sideV = norm(sideV);
  let fwd = cross(sideV, up);
  const earMid = lerp3(ear1, ear2, 0.5);
  if (dot(fwd, sub(earMid, spine[4])) < 0) fwd = mul(fwd, -1);
  sideV = cross(up, fwd);
  const center = add(add(earMid, mul(up, -0.066)), mul(fwd, 0.012));
  const [earL, earR] = dot(sub(ear1, center), sideV) > 0 ? [ear1, ear2] : [ear2, ear1];
  let nose = add(center, mul(fwd, 0.05));
  let bestAlong = 0;
  for (const i of cloud) {
    const rel = sub(pt(i), center);
    const along = dot(rel, fwd);
    if (Math.abs(dot(rel, sideV)) < 0.016 && rel[1] < 0.006 && rel[1] > -0.036 && along > bestAlong) {
      bestAlong = along;
      nose = pt(i);
    }
  }
  const headJoint = add(add(center, mul(fwd, -0.034)), mul(up, -0.004));
  const neckMid = add(lerp3(neckBase, headJoint, 0.5), mul(up, 0.004));
  addBone('neck1', neckBase, neckMid, 'chest');
  addBone('neck2', neckMid, headJoint, 'neck1');
  addBone('head', headJoint, add(add(center, mul(fwd, 0.03)), mul(up, 0.004)), 'neck2');
  addBone('jaw', add(add(center, mul(fwd, 0.004)), mul(up, -0.022)), add(add(nose, mul(up, -0.02)), mul(fwd, -0.008)), 'head');
  for (const [nm, tip] of [['earL', earL], ['earR', earR]] as Array<[string, V3]>) {
    const base = lerp3(center, tip, 0.5);
    addBone(nm, base, lerp3(base, tip, 0.92), 'head');
  }
  // vystředit na sagitální rovinu
  for (let i = 0; i < n; i++) N[i * 3] -= cx;
  for (const b of bones) {
    b.head[0] -= cx;
    b.tail[0] -= cx;
  }
  return { N, bones, headYawDeg: THREE.MathUtils.radToDeg(Math.atan2(fwd[0], fwd[2])), yaw };
}

/** Vzdálenost bodu od úsečky. */
function segDist(px: number, py: number, pz: number, a: V3, b: V3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const l2 = abx * abx + aby * aby + abz * abz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / l2)) : 0;
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

export function buildRuntimeRig(scene: THREE.Object3D): RuntimeRigResult | null {
  let src: THREE.Mesh | null = null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !src) src = m;
  });
  if (!src) return null;
  const mesh0 = src as THREE.Mesh;
  const geo = mesh0.geometry.clone();
  geo.applyMatrix4(mesh0.matrixWorld);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i);
    P[i * 3 + 1] = pos.getY(i);
    P[i * 3 + 2] = pos.getZ(i);
  }
  const res = analyze(P);
  if (!res) return null;
  const { N, bones, headYawDeg, yaw } = res;

  // --- geometrie v normalizovaném prostoru
  pos.array.set(N);
  pos.needsUpdate = true;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nrm) {
    const c = Math.cos(-yaw);
    const s = Math.sin(-yaw);
    for (let i = 0; i < n; i++) {
      const x = nrm.getX(i);
      const z = nrm.getZ(i);
      nrm.setXYZ(i, x * c + z * s, nrm.getY(i), -x * s + z * c);
    }
    nrm.needsUpdate = true;
  } else geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // --- kostra
  const root = new THREE.Bone();
  root.name = 'root';
  const map = new Map<string, THREE.Bone>([['root', root]]);
  const world = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>([['root', { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }]]);
  const Yax = new THREE.Vector3(0, 1, 0);
  for (const b of bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    const dir = new THREE.Vector3(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]).normalize();
    const wq = new THREE.Quaternion().setFromUnitVectors(Yax, dir);
    const wp = new THREE.Vector3(...b.head);
    const parent = world.get(b.parent)!;
    const pInv = parent.quat.clone().invert();
    bone.position.copy(wp).sub(parent.pos).applyQuaternion(pInv);
    bone.quaternion.copy(pInv).multiply(wq);
    map.get(b.parent)!.add(bone);
    map.set(b.name, bone);
    world.set(b.name, { pos: wp, quat: wq });
  }
  const boneList = bones.map((b) => map.get(b.name)!);

  // --- váhy: vzdálenost k úsečkám kostí, hladký útlum, max 4 vlivy
  const nb = bones.length;
  const isLeg = bones.map((b) => /^(front|hind)(Upper|Lower|Foot|Paw)/.test(b.name));
  const side = bones.map((b) => (b.name.endsWith('L') && isLeg[bones.indexOf(b)] ? 1 : b.name.endsWith('R') && isLeg[bones.indexOf(b)] ? -1 : 0));
  // poloměr vlivu podle typu kosti (větší kosti „drží“ větší objem)
  const radius = bones.map((b) => (/spine|hips|chest/.test(b.name) ? 1.35 : /Upper/.test(b.name) ? 1.0 : /head/.test(b.name) ? 1.2 : /ear|jaw/.test(b.name) ? 0.55 : 0.8));
  const W = new Float32Array(n * nb);
  for (let i = 0; i < n; i++) {
    const x = N[i * 3];
    const y = N[i * 3 + 1];
    const z = N[i * 3 + 2];
    for (let b = 0; b < nb; b++) {
      const d = segDist(x, y, z, bones[b].head, bones[b].tail) / radius[b];
      let w = 1 / (d * d + 2.5e-5) ** 2;
      if (side[b] !== 0) w *= THREE.MathUtils.smoothstep(side[b] * x, -0.006, 0.006);
      // ušní kosti jen nad hlavou
      if (bones[b].name.startsWith('ear') && y < bones[b].head[1] - 0.012) w = 0;
      W[i * nb + b] = w;
    }
  }
  // sousedé ve svařené síti (vrcholy na UV švech sdílí polohu)
  const key = (i: number) => `${Math.round(N[i * 3] * 2e4)},${Math.round(N[i * 3 + 1] * 2e4)},${Math.round(N[i * 3 + 2] * 2e4)}`;
  const weld = new Map<string, number>();
  const wid = new Int32Array(n);
  let wn = 0;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let id = weld.get(k);
    if (id === undefined) weld.set(k, (id = wn++));
    wid[i] = id;
  }
  const neigh: Array<Set<number>> = Array.from({ length: wn }, () => new Set<number>());
  const index = geo.index;
  const triCount = index ? index.count / 3 : n / 3;
  for (let t = 0; t < triCount; t++) {
    const ia = wid[index ? index.getX(t * 3) : t * 3];
    const ib = wid[index ? index.getX(t * 3 + 1) : t * 3 + 1];
    const ic = wid[index ? index.getX(t * 3 + 2) : t * 3 + 2];
    neigh[ia].add(ib).add(ic);
    neigh[ib].add(ia).add(ic);
    neigh[ic].add(ia).add(ib);
  }
  // normalizace + vyhlazení (2 průchody) ve svařeném prostoru
  let WW = new Float32Array(wn * nb);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let b = 0; b < nb; b++) s += W[i * nb + b];
    const o = wid[i] * nb;
    for (let b = 0; b < nb; b++) WW[o + b] = W[i * nb + b] / (s || 1);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(WW.length);
    for (let v = 0; v < wn; v++) {
      const o = v * nb;
      const ns = neigh[v];
      const k = ns.size;
      for (let b = 0; b < nb; b++) next[o + b] = WW[o + b] * 0.5;
      if (k === 0) {
        for (let b = 0; b < nb; b++) next[o + b] = WW[o + b];
        continue;
      }
      for (const u of ns) {
        const uo = u * nb;
        for (let b = 0; b < nb; b++) next[o + b] += (WW[uo + b] * 0.5) / k;
      }
    }
    WW = next;
  }
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const top: number[] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = wid[i] * nb;
    top.fill(-1);
    for (let k = 0; k < 4; k++) {
      let bi = -1;
      let bw = 0;
      for (let b = 0; b < nb; b++) {
        if (WW[o + b] > bw && !top.includes(b)) {
          bw = WW[o + b];
          bi = b;
        }
      }
      top[k] = bi;
    }
    let s = 0;
    for (let k = 0; k < 4; k++) if (top[k] >= 0) s += WW[o + top[k]];
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = top[k] >= 0 ? top[k] : 0;
      skinWeight[i * 4 + k] = top[k] >= 0 ? WW[o + top[k]] / (s || 1) : 0;
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const mat = (Array.isArray(mesh0.material) ? mesh0.material[0] : mesh0.material) as THREE.Material;
  const skinned = new THREE.SkinnedMesh(geo, mat);
  skinned.name = 'Tiger';
  const holder = new THREE.Group();
  holder.name = 'TigerRig';
  holder.add(root);
  holder.add(skinned);
  holder.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton(boneList));
  return { holder, mesh: skinned, headYawDeg };
}
