import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import type { CatController } from './CatController';
import { loadCatModel, type CatModel } from './CatModel';
import { CatAnimator } from './CatAnimator';
import { Fur } from './Fur';

/** Tiger: model + rig + procedurální animace (+ srst). Sleduje controller. */
export class Tiger {
  readonly root = new THREE.Group();
  model!: CatModel;
  anim!: CatAnimator;
  fur!: Fur;
  private readonly renderPos = new THREE.Vector3();

  constructor(private controller: CatController, private physics: Physics) {
    this.root.name = 'tiger';
  }

  async load(): Promise<void> {
    this.model = await loadCatModel();
    this.root.add(this.model.root);
    const mesh = this.model.mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.fur = new Fur(this.model);
    this.anim = new CatAnimator(this.model.rig, this.controller, this.physics);
  }

  /** Po teleportu: tlapky hned na místo. */
  snap(): void {
    this.renderPos.copy(this.controller.position);
    this.anim.snapFeet();
  }

  update(dt: number, alpha: number): void {
    const c = this.controller;
    this.renderPos.lerpVectors(c.prevPosition, c.position, alpha);
    this.root.position.copy(this.renderPos);
    this.root.rotation.y = c.yaw;
    this.anim.update(dt, this.renderPos);
  }
}
