import * as THREE from 'three';
import type { Physics } from '../core/Physics';
import type { WorldCtx } from './Ctx';
import { createMaterials } from './Materials';
import { buildRoom } from './Room';
import { buildKitchen } from './Kitchen';
import { buildFurniture } from './Furniture';
import { mergeStatic } from './Merge';

/** Postaví celou místnost a vrátí kontext s odkazy pro hádanky. */
export async function buildWorld(scene: THREE.Scene, physics: Physics): Promise<WorldCtx> {
  const mats = await createMaterials();
  const root = new THREE.Group();
  root.name = 'room';
  const detail = new THREE.Group();
  detail.name = 'detail';
  const exterior = new THREE.Group();
  exterior.name = 'exterior';
  scene.add(root, detail, exterior);
  const ctx: WorldCtx = { scene, physics, mats, root, detail, exterior, refs: {} };
  buildRoom(ctx);
  buildKitchen(ctx);
  await buildFurniture(ctx);
  return ctx;
}

/** Sloučení statické geometrie – volat až po postavení všech rekvizit (hádanky si přidávají své). */
export function finalizeWorld(ctx: WorldCtx): void {
  const refs = ctx.refs;
  const exclude = new Set<THREE.Object3D>();
  for (const key of ['balconyDoor', 'treatDoor']) if (refs[key]) exclude.add(refs[key].pivot);
  for (const key of ['hangShelf', 'pendant']) if (refs[key]) exclude.add(refs[key].pivot);
  if (refs.taburet) exclude.add(refs.taburet.object);
  for (const o of refs.noMerge ?? []) exclude.add(o);
  for (const g of [ctx.root, ctx.exterior, ctx.detail]) {
    const r = mergeStatic(g, exclude);
    if (import.meta.env.DEV) console.info(`[world] ${g.name}: ${r.before} → ${r.after} sítí`);
  }
  ctx.scene.updateMatrixWorld(true);
}
