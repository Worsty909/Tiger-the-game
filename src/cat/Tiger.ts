import * as THREE from 'three';
import { assets } from '../core/Assets';
import type { CatController } from './CatController';

/**
 * Vizuál Tigera. V milníku M1 jde o provizorní (nerigovaný) model, který se jen posouvá
 * a natáčí podle controlleru; v M2 ho nahradí rig, procedurální animace a srst.
 */
export class Tiger {
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private readonly renderPos = new THREE.Vector3();

  constructor(private controller: CatController) {
    this.root.name = 'tiger';
  }

  async load(): Promise<void> {
    const gltf = await assets.gltf('models/tiger.glb');
    if (gltf) {
      const model = gltf.scene;
      // normalizace: délka těla ~0,46 m, tlapky na Y = 0
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = 0.36 / size.y;
      model.scale.setScalar(scale);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x * scale, -box.min.y * scale, -c.z * scale + 0.06);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissive.set(0x000000);
          mat.emissiveMap = null;
          mat.side = THREE.FrontSide;
        }
      });
      this.model = model;
      this.root.add(model);
    } else {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 6, 12), new THREE.MeshStandardMaterial({ color: 0xc98a4b, roughness: 0.8 }));
      body.rotation.x = Math.PI / 2;
      body.position.y = 0.2;
      body.castShadow = true;
      this.root.add(body);
    }
  }

  update(dt: number, alpha: number): void {
    const c = this.controller;
    this.renderPos.lerpVectors(c.prevPosition, c.position, alpha);
    this.root.position.copy(this.renderPos);
    this.root.rotation.y = c.yaw;
    if (this.model) {
      const squash = c.crouching ? 0.55 : 1;
      this.model.scale.y += (this.model.scale.x * squash - this.model.scale.y) * (1 - Math.exp(-dt * 12));
    }
  }
}
