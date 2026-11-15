import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Sloučí statické sítě se stejným materiálem do jedné (výrazně méně draw calls –
 * důležité pro stíny, zapékání sond i běžné vykreslování).
 * Podstromy uvedené v `exclude` (pohyblivé díly) a instancované/skinované sítě se nechají být.
 */
export function mergeStatic(root: THREE.Object3D, exclude: Set<THREE.Object3D>): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; items: THREE.Mesh[] }>();
  const collect = (o: THREE.Object3D) => {
    if (exclude.has(o) || !o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !(m as unknown as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m.material)) {
      const mat = m.material as THREE.Material;
      if (!mat.transparent && m.renderOrder === 0 && m.children.length === 0) {
        const attrs = Object.keys(m.geometry.attributes).sort().join(',');
        const key = `${mat.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}|${attrs}|${m.geometry.index ? 'i' : 'n'}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { material: mat, cast: m.castShadow, receive: m.receiveShadow, items: [] }));
        g.items.push(m);
        return;
      }
    }
    for (const c of o.children) collect(c);
  };
  collect(root);
  let before = 0;
  let after = 0;
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const mtx = new THREE.Matrix4();
  for (const g of groups.values()) {
    before += g.items.length;
    if (g.items.length < 2) {
      after += g.items.length;
      continue;
    }
    const geos: THREE.BufferGeometry[] = [];
    for (const m of g.items) {
      const geo = m.geometry.clone();
      mtx.multiplyMatrices(rootInv, m.matrixWorld);
      geo.applyMatrix4(mtx);
      // zrcadlené transformace by obrátily orientaci trojúhelníků
      if (mtx.determinant() < 0 && geo.index) {
        const idx = geo.index;
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i);
          idx.setX(i, idx.getX(i + 2));
          idx.setX(i + 2, a);
        }
      }
      geos.push(geo);
    }
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) {
      after += g.items.length;
      continue;
    }
    for (const m of g.items) m.parent?.remove(m);
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.name = 'merged:' + (g.material.name || g.material.type);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    after++;
  }
  return { before, after };
}
