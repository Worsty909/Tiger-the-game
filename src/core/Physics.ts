import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export type Surface = 'wood' | 'carpet' | 'tile' | 'fabric' | 'metal' | 'stone' | 'plastic' | 'glass';

/** Skupiny kolizí (16 bitů členství, 16 bitů filtr). */
export const G = {
  STATIC: 1 << 0,
  DYNAMIC: 1 << 1,
  CAT: 1 << 2,
  DEBRIS: 1 << 3, // drobnosti (pamlsky, střepy) – s kočkou nekolidují
  PLATFORM: 1 << 4, // kinematické plošiny (vysavač, police, svítidlo, dveře)
  CAMERA_BLOCK: 1 << 5, // co blokuje kameru (stěny, velký nábytek)
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const GROUPS = {
  static: groups(G.STATIC | G.CAMERA_BLOCK, G.DYNAMIC | G.CAT | G.DEBRIS | G.PLATFORM),
  staticNoCam: groups(G.STATIC, G.DYNAMIC | G.CAT | G.DEBRIS | G.PLATFORM),
  dynamic: groups(G.DYNAMIC, G.STATIC | G.DYNAMIC | G.CAT | G.DEBRIS | G.PLATFORM),
  debris: groups(G.DEBRIS, G.STATIC | G.DYNAMIC | G.DEBRIS | G.PLATFORM),
  platform: groups(G.PLATFORM, G.DYNAMIC | G.CAT | G.DEBRIS),
  cat: groups(G.CAT, G.STATIC | G.DYNAMIC | G.PLATFORM),
  /** Dotazy kočky na pevnou zem (statika + dynamika + plošiny). */
  queryGround: groups(0xffff, G.STATIC | G.DYNAMIC | G.PLATFORM),
  queryStatic: groups(0xffff, G.STATIC | G.PLATFORM),
  queryCamera: groups(0xffff, G.CAMERA_BLOCK),
  queryAll: groups(0xffff, G.STATIC | G.DYNAMIC | G.PLATFORM | G.DEBRIS),
} as const;

export interface ColliderInfo {
  surface: Surface;
  tag?: string;
  object?: THREE.Object3D;
  /** Plošina, která kočku unáší (rychlost se čte z tělesa). */
  carries?: boolean;
}

export interface BodyEntry {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  tag?: string;
  /** Posun vizuálu vůči těžišti tělesa (v lokálním prostoru tělesa). */
  offset?: THREE.Vector3;
  onImpact?: (speed: number) => void;
  lastSpeed: number;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
  info: ColliderInfo | undefined;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export class Physics {
  world!: RAPIER.World;
  readonly fixedDt = 1 / 60;
  readonly infos = new Map<number, ColliderInfo>();
  readonly bodies: BodyEntry[] = [];
  private staticBody!: RAPIER.RigidBody;
  private ray!: RAPIER.Ray;

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.fixedDt;
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  step(): void {
    this.world.step();
    for (const e of this.bodies) {
      const b = e.body;
      if (b.isSleeping() && !b.isKinematic()) continue;
      const t = b.translation();
      const r = b.rotation();
      e.object.quaternion.set(r.x, r.y, r.z, r.w);
      e.object.position.set(t.x, t.y, t.z);
      if (e.offset) e.object.position.add(_v.copy(e.offset).applyQuaternion(e.object.quaternion));
      if (e.onImpact) {
        const lv = b.linvel();
        const speed = Math.hypot(lv.x, lv.y, lv.z);
        // prudké zpomalení = náraz
        if (e.lastSpeed - speed > 1.2) e.onImpact(e.lastSpeed);
        e.lastSpeed = speed;
      }
    }
  }

  info(c: RAPIER.Collider | null | undefined): ColliderInfo | undefined {
    return c ? this.infos.get(c.handle) : undefined;
  }

  /** Statický kvádr (střed, poloviční rozměry). */
  addStaticBox(
    cx: number, cy: number, cz: number, hx: number, hy: number, hz: number,
    info: ColliderInfo = { surface: 'wood' },
    opts: { rotY?: number; quat?: THREE.Quaternion; camera?: boolean; friction?: number } = {},
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(Math.max(hx, 0.002), Math.max(hy, 0.002), Math.max(hz, 0.002))
      .setTranslation(cx, cy, cz)
      .setFriction(opts.friction ?? 0.8)
      .setCollisionGroups(opts.camera === false ? GROUPS.staticNoCam : GROUPS.static);
    if (opts.quat) desc.setRotation(opts.quat);
    else if (opts.rotY) desc.setRotation(_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, opts.rotY));
    const c = this.world.createCollider(desc, this.staticBody);
    this.infos.set(c.handle, info);
    return c;
  }

  /** Statický kvádr zadaný rozsahem min/max. */
  addStaticAABB(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    info: ColliderInfo = { surface: 'wood' }, opts: { camera?: boolean; friction?: number } = {},
  ): RAPIER.Collider {
    return this.addStaticBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2, info, opts);
  }

  addStaticCylinder(cx: number, cy: number, cz: number, halfH: number, radius: number, info: ColliderInfo = { surface: 'wood' }, camera = true): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfH, radius)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(camera ? GROUPS.static : GROUPS.staticNoCam);
    const c = this.world.createCollider(desc, this.staticBody);
    this.infos.set(c.handle, info);
    return c;
  }

  addStaticCollider(desc: RAPIER.ColliderDesc, info: ColliderInfo = { surface: 'wood' }, camera = true): RAPIER.Collider {
    desc.setCollisionGroups(camera ? GROUPS.static : GROUPS.staticNoCam);
    const c = this.world.createCollider(desc, this.staticBody);
    this.infos.set(c.handle, info);
    return c;
  }

  /** Dynamické těleso svázané s Object3D (pozice objektu = těžiště tělesa + offset). */
  addDynamic(
    object: THREE.Object3D,
    colliders: RAPIER.ColliderDesc[],
    opts: {
      info?: ColliderInfo; tag?: string; linDamp?: number; angDamp?: number; ccd?: boolean;
      debris?: boolean; canSleep?: boolean; offset?: THREE.Vector3; onImpact?: (speed: number) => void;
      lockRot?: boolean; gravityScale?: number;
    } = {},
  ): BodyEntry {
    object.updateWorldMatrix(true, false);
    const pos = object.getWorldPosition(new THREE.Vector3());
    const quat = object.getWorldQuaternion(new THREE.Quaternion());
    if (opts.offset) pos.sub(_v.copy(opts.offset).applyQuaternion(quat));
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(quat)
      .setLinearDamping(opts.linDamp ?? 0.25)
      .setAngularDamping(opts.angDamp ?? 0.6)
      .setCcdEnabled(!!opts.ccd)
      .setCanSleep(opts.canSleep ?? true);
    if (opts.gravityScale !== undefined) desc.setGravityScale(opts.gravityScale);
    if (opts.lockRot) desc.lockRotations();
    const body = this.world.createRigidBody(desc);
    const info = opts.info ?? { surface: 'wood' };
    for (const cd of colliders) {
      cd.setCollisionGroups(opts.debris ? GROUPS.debris : GROUPS.dynamic);
      const c = this.world.createCollider(cd, body);
      this.infos.set(c.handle, { ...info, object, tag: opts.tag ?? info.tag });
    }
    const entry: BodyEntry = { body, object, tag: opts.tag, offset: opts.offset, onImpact: opts.onImpact, lastSpeed: 0 };
    this.bodies.push(entry);
    return entry;
  }

  /** Kinematické těleso (plošina) svázané s Object3D. */
  addKinematic(object: THREE.Object3D, colliders: RAPIER.ColliderDesc[], info: ColliderInfo = { surface: 'wood' }, sync = false): BodyEntry {
    object.updateWorldMatrix(true, false);
    const pos = object.getWorldPosition(new THREE.Vector3());
    const quat = object.getWorldQuaternion(new THREE.Quaternion());
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation(quat),
    );
    for (const cd of colliders) {
      cd.setCollisionGroups(GROUPS.platform);
      const c = this.world.createCollider(cd, body);
      this.infos.set(c.handle, { ...info, object });
    }
    const entry: BodyEntry = { body, object, lastSpeed: 0 };
    if (sync) this.bodies.push(entry);
    return entry;
  }

  /** Posune kinematické těleso podle světové transformace objektu. */
  moveKinematic(entry: BodyEntry, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    entry.body.setNextKinematicTranslation(pos);
    entry.body.setNextKinematicRotation(quat);
  }

  removeBody(entry: BodyEntry): void {
    const i = this.bodies.indexOf(entry);
    if (i >= 0) this.bodies.splice(i, 1);
    for (let k = 0; k < entry.body.numColliders(); k++) this.infos.delete(entry.body.collider(k).handle);
    this.world.removeRigidBody(entry.body);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.infos.delete(c.handle);
    this.world.removeCollider(c, true);
  }

  raycast(
    origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filterGroups: number = GROUPS.queryGround,
    exclude?: RAPIER.Collider, predicate?: (c: RAPIER.Collider) => boolean,
  ): RayHit | null {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filterGroups, exclude, undefined, predicate);
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: d,
      collider: hit.collider,
      info: this.infos.get(hit.collider.handle),
    };
  }

  /** Rychlý test vzdálenosti dolů (bez alokací) – vrací výšku povrchu nebo -Infinity. */
  groundHeight(x: number, y: number, z: number, maxDist: number, filterGroups: number = GROUPS.queryGround, exclude?: RAPIER.Collider): number {
    this.ray.origin.x = x;
    this.ray.origin.y = y;
    this.ray.origin.z = z;
    this.ray.dir.x = 0;
    this.ray.dir.y = -1;
    this.ray.dir.z = 0;
    const hit = this.world.castRay(this.ray, maxDist, true, undefined, filterGroups, exclude);
    return hit ? y - hit.timeOfImpact : -Infinity;
  }

  /** Spherecast – vrací čas dopadu (vzdálenost) nebo null. */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDist: number, filterGroups: number, exclude?: RAPIER.Collider): number | null {
    const shape = new RAPIER.Ball(radius);
    const hit = this.world.castShape(origin, IDENTITY, dir, shape, 0, maxDist, true, undefined, filterGroups, exclude);
    return hit ? hit.time_of_impact : null;
  }

  /** Je daný tvar na pozici volný? */
  overlaps(shape: RAPIER.Shape, pos: THREE.Vector3, quat: { x: number; y: number; z: number; w: number } = IDENTITY, filterGroups: number = GROUPS.queryGround, exclude?: RAPIER.Collider): boolean {
    return this.world.intersectionWithShape(pos, quat, shape, undefined, filterGroups, exclude) !== null;
  }
}
