import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Pomocné funkce pro geometrii: zkosené kvádry, UV v metrech, rychlé skládání meshů. */

export type Axis = 'x' | 'y' | 'z';

/**
 * Přepíše UV tak, aby 1 jednotka UV = 1 metr (planární projekce podle dominantní osy
 * normály plochy). `grain` určuje osu, podél které běží V (léta dřeva).
 */
export function worldUV(geo: THREE.BufferGeometry, grain?: Axis, offset = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const pts = [a, b, c];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    let uAxis: Axis;
    let vAxis: Axis;
    if (ax >= ay && ax >= az) {
      uAxis = 'z';
      vAxis = 'y';
    } else if (ay >= ax && ay >= az) {
      uAxis = 'x';
      vAxis = 'z';
    } else {
      uAxis = 'x';
      vAxis = 'y';
    }
    if (grain && grain === uAxis) {
      const t = uAxis;
      uAxis = vAxis;
      vAxis = t;
    }
    for (let k = 0; k < 3; k++) {
      uv[(i + k) * 2] = pts[k][uAxis] + offset;
      uv[(i + k) * 2 + 1] = pts[k][vAxis] + offset * 0.37;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Kvádr se zkosenými (zaoblenými) hranami a UV v metrech. */
export function rbox(w: number, h: number, d: number, r = 0.006, grain?: Axis, seg = 2): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const g = rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
  return worldUV(g, grain, (w * 13.7 + h * 7.3 + d * 3.1) % 1);
}

export interface MeshOpts {
  cast?: boolean;
  receive?: boolean;
  name?: string;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, opts: MeshOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  if (opts.name) m.name = opts.name;
  return m;
}

/** Zkosený kvádr zadaný středem. */
export function boxAt(
  parent: THREE.Object3D, mat: THREE.Material, cx: number, cy: number, cz: number, w: number, h: number, d: number,
  r = 0.006, grain?: Axis, opts: MeshOpts = {},
): THREE.Mesh {
  const m = mesh(rbox(w, h, d, r, grain), mat, cx, cy, cz, opts);
  parent.add(m);
  return m;
}

/** Zkosený kvádr zadaný rozsahem min/max. */
export function boxSpan(
  parent: THREE.Object3D, mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  r = 0.006, grain?: Axis, opts: MeshOpts = {},
): THREE.Mesh {
  return boxAt(parent, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), r, grain, opts);
}

/** Rovina s UV v metrech (normála +Y po otočení). */
export function floorPlane(w: number, d: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  return g;
}

/** Svislá stěna s UV v metrech; šířka podél X, normála +Z. */
export function wallPlane(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
  return g;
}

/** Rotační těleso z profilu [r, y]. */
export function lathe(profile: Array<[number, number]>, segments = 32): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  g.computeVertexNormals();
  return g;
}

export function cylinder(rTop: number, rBottom: number, h: number, seg = 24, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
}

/** Světový AABB objektu. */
export function boundsOf(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj);
}

/** Posune objekt tak, aby jeho spodek ležel na `y` a střed XZ na zadaném místě. */
export function placeOnFloor(obj: THREE.Object3D, x: number, y: number, z: number): THREE.Box3 {
  const b = boundsOf(obj);
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  obj.position.x += x - cx;
  obj.position.y += y - b.min.y;
  obj.position.z += z - cz;
  return boundsOf(obj);
}
