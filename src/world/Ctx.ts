import * as THREE from 'three';
import type { Physics, BodyEntry } from '../core/Physics';
import type { MaterialLib } from './Materials';

/** Sdílený kontext stavby světa. */
export interface WorldCtx {
  scene: THREE.Scene;
  physics: Physics;
  mats: MaterialLib;
  /** Statická architektura a velký nábytek (zahrnuto do výpočtu GI). */
  root: THREE.Group;
  /** Drobné rekvizity – při zapékání světelných sond se skrývají. */
  detail: THREE.Group;
  /** Vše venku (balkon, město, obloha). */
  exterior: THREE.Group;
  /** Pojmenované objekty pro hádanky a efekty. */
  refs: Refs;
}

export interface Hinged {
  pivot: THREE.Object3D;
  body: BodyEntry | null;
  angle: number;
  target: number;
  speed: number;
}

export interface Refs {
  [key: string]: any;
}
