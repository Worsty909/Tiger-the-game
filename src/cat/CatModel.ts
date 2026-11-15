import * as THREE from 'three';
import { assets } from '../core/Assets';
import { CatRig } from './CatRig';
import { buildRuntimeRig } from './RuntimeRig';

/**
 * Načtení Tigera.
 *  - Varianta A: `public/models/tiger_rigged.glb` (rig z Blenderu, tools/rig_tiger.py).
 *  - Varianta B: `public/models/tiger.glb` bez kostry → rig se postaví za běhu (RuntimeRig).
 * URL parametr `?rig=runtime` vynutí variantu B (testování).
 */
export interface CatModel {
  /** Kořen modelu – jeho lokální prostor je „prostor modelu“ (tlapky na Y = 0, čumák +Z). */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  rig: CatRig;
  variant: 'blender' | 'runtime' | 'placeholder';
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && !found) found = m;
  });
  return found;
}

export async function loadCatModel(): Promise<CatModel> {
  const forceRuntime = new URLSearchParams(location.search).get('rig') === 'runtime';
  const root = new THREE.Group();
  root.name = 'tigerModel';

  if (!forceRuntime) {
    const gltf = await assets.gltf('models/tiger_rigged.glb');
    const mesh = gltf ? findSkinned(gltf.scene) : null;
    if (gltf && mesh && CatRig.hasAllBones(mesh.skeleton, gltf.scene)) {
      root.add(gltf.scene);
      root.updateMatrixWorld(true);
      const rig = new CatRig(root, mesh.skeleton);
      let meta: { headYawDeg?: number } = {};
      gltf.scene.traverse((o) => {
        const raw = o.userData?.tiger_meta;
        if (typeof raw === 'string') {
          try {
            meta = JSON.parse(raw);
          } catch {
            /* ignore */
          }
        }
      });
      rig.headYaw = meta.headYawDeg ?? 0;
      return { root, mesh, rig, variant: 'blender' };
    }
    console.info('tiger_rigged.glb není k dispozici nebo nemá očekávanou kostru – rig se postaví za běhu.');
  }

  const gltf = await assets.gltf('models/tiger.glb');
  if (gltf) {
    const built = buildRuntimeRig(gltf.scene);
    if (built) {
      root.add(built.holder);
      root.updateMatrixWorld(true);
      const rig = new CatRig(root, built.mesh.skeleton);
      rig.headYaw = built.headYawDeg;
      return { root, mesh: built.mesh, rig, variant: 'runtime' };
    }
  }
  throw new Error('Model Tigera se nepodařilo načíst (public/models/tiger.glb).');
}
