import * as THREE from 'three';

/**
 * Obal nad kostrou Tigera. Animátor pracuje v „prostoru modelu“ (počátek na zemi pod středem těla,
 * +Z dopředu, +Y nahoru, +X doleva): nastavuje světové orientace kostí a CatRig je převádí na lokální.
 */

export const LEGS = ['frontL', 'frontR', 'hindL', 'hindR'] as const;
export type LegName = (typeof LEGS)[number];

export const SPINE = ['spine1', 'spine2', 'spine3', 'chest'] as const;
export const TAIL = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6', 'tail7'] as const;

export const REQUIRED_BONES = [
  'root', 'hips', ...SPINE, 'neck1', 'neck2', 'head', 'jaw', 'earL', 'earR', ...TAIL,
  ...LEGS.flatMap((l) => {
    const p = l.startsWith('front') ? 'front' : 'hind';
    const s = l.endsWith('L') ? 'L' : 'R';
    return [`${p}Upper${s}`, `${p}Lower${s}`, `${p}Foot${s}`, `${p}Paw${s}`];
  }),
];

export class RigBone {
  parent: RigBone | null = null;
  children: RigBone[] = [];
  readonly restLocalPos = new THREE.Vector3();
  readonly restLocalQuat = new THREE.Quaternion();
  /** Klidová poloha/orientace v prostoru modelu. */
  readonly restPos = new THREE.Vector3();
  readonly restQuat = new THREE.Quaternion();
  /** Jednotkový směr kosti (hlava → konec) v klidu, prostor modelu. */
  readonly restDir = new THREE.Vector3(0, 1, 0);
  length = 0.03;
  /** Aktuální póza v prostoru modelu. */
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  /** Byla orientace v tomto snímku nastavena explicitně? */
  posed = false;

  constructor(readonly name: string, readonly bone: THREE.Bone) {}
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export interface LegChain {
  name: LegName;
  front: boolean;
  side: number; // +1 levá, −1 pravá
  upper: RigBone;
  lower: RigBone;
  foot: RigBone;
  paw: RigBone;
  /** Klidová poloha „bříška“ tlapky (kloub prstů) v prostoru modelu. */
  home: THREE.Vector3;
}

export class CatRig {
  readonly bones = new Map<string, RigBone>();
  readonly order: RigBone[] = [];
  readonly legs = {} as Record<LegName, LegChain>;
  readonly spine: RigBone[] = [];
  readonly tail: RigBone[] = [];
  /** O kolik stupňů je hlava v klidové póze modelu otočená (kolem Y). */
  headYaw = 0;
  /** Výška kloubu tlapky nad zemí v klidu. */
  pawHeight = 0.024;

  /**
   * @param modelRoot objekt, jehož lokální prostor je „prostor modelu“ (rodič armatury)
   */
  constructor(readonly modelRoot: THREE.Object3D, readonly skeleton: THREE.Skeleton) {
    modelRoot.updateMatrixWorld(true);
    const inv = _m.copy(modelRoot.matrixWorld).invert();
    const byBone = new Map<THREE.Bone, RigBone>();
    for (const b of skeleton.bones) {
      const rb = new RigBone(b.name, b);
      this.bones.set(b.name, rb);
      byBone.set(b, rb);
    }
    // kořenová kost nemusí být ve skinu (nedeformuje) – dohledat podle jména
    modelRoot.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone && !byBone.has(b)) {
        const rb = new RigBone(b.name, b);
        this.bones.set(b.name, rb);
        byBone.set(b, rb);
      }
    });
    for (const rb of byBone.values()) {
      const p = rb.bone.parent as THREE.Bone | null;
      if (p && byBone.has(p)) {
        rb.parent = byBone.get(p)!;
        rb.parent.children.push(rb);
      }
      rb.restLocalPos.copy(rb.bone.position);
      rb.restLocalQuat.copy(rb.bone.quaternion);
      const mw = new THREE.Matrix4().multiplyMatrices(inv, rb.bone.matrixWorld);
      mw.decompose(rb.restPos, rb.restQuat, _v);
      rb.pos.copy(rb.restPos);
      rb.quat.copy(rb.restQuat);
    }
    // pořadí rodič → potomek
    const visit = (rb: RigBone) => {
      this.order.push(rb);
      for (const c of rb.children) visit(c);
    };
    for (const rb of byBone.values()) if (!rb.parent) visit(rb);

    // směry a délky kostí
    const chainNext: Record<string, string> = {
      hips: 'spine1', spine1: 'spine2', spine2: 'spine3', spine3: 'chest', chest: 'neck1', neck1: 'neck2', neck2: 'head',
    };
    for (let i = 0; i < TAIL.length - 1; i++) chainNext[TAIL[i]] = TAIL[i + 1];
    for (const p of ['front', 'hind']) {
      for (const s of ['L', 'R']) {
        chainNext[`${p}Upper${s}`] = `${p}Lower${s}`;
        chainNext[`${p}Lower${s}`] = `${p}Foot${s}`;
        chainNext[`${p}Foot${s}`] = `${p}Paw${s}`;
      }
    }
    for (const rb of this.order) {
      const next = chainNext[rb.name] ? this.bones.get(chainNext[rb.name]) : undefined;
      if (next) {
        rb.restDir.subVectors(next.restPos, rb.restPos);
        rb.length = rb.restDir.length();
        rb.restDir.divideScalar(rb.length || 1);
      } else {
        rb.restDir.set(0, 1, 0).applyQuaternion(rb.restQuat).normalize();
        rb.length = rb.name.includes('Paw') ? 0.026 : 0.03;
      }
    }
    for (const n of SPINE) this.spine.push(this.get(n));
    for (const n of TAIL) this.tail.push(this.get(n));
    for (const leg of LEGS) {
      const p = leg.startsWith('front') ? 'front' : 'hind';
      const s = leg.endsWith('L') ? 'L' : 'R';
      const paw = this.get(`${p}Paw${s}`);
      this.legs[leg] = {
        name: leg,
        front: p === 'front',
        side: s === 'L' ? 1 : -1,
        upper: this.get(`${p}Upper${s}`),
        lower: this.get(`${p}Lower${s}`),
        foot: this.get(`${p}Foot${s}`),
        paw,
        home: paw.restPos.clone(),
      };
    }
    // symetrické „domovské“ polohy tlapek (klidová póza modelu má nohy v nákroku)
    for (const [a, b] of [['frontL', 'frontR'], ['hindL', 'hindR']] as const) {
      const A = this.legs[a].home;
      const B = this.legs[b].home;
      const x = (Math.abs(A.x) + Math.abs(B.x)) / 2;
      const z = (A.z + B.z) / 2;
      const y = (A.y + B.y) / 2;
      A.set(x, y, z);
      B.set(-x, y, z);
    }
    this.pawHeight = (this.legs.frontL.home.y + this.legs.hindL.home.y) / 2;
  }

  static hasAllBones(skeleton: THREE.Skeleton, root: THREE.Object3D): boolean {
    const names = new Set<string>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) names.add(o.name);
    });
    for (const b of skeleton.bones) names.add(b.name);
    return REQUIRED_BONES.every((n) => names.has(n));
  }

  get(name: string): RigBone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`Rig: chybí kost ${name}`);
    return b;
  }

  /** Začátek snímku: nic není napózováno. */
  begin(): void {
    for (const b of this.order) b.posed = false;
  }

  /** Nastaví polohu kořene řetězce (pánev). */
  setPosition(b: RigBone, pos: THREE.Vector3): void {
    b.pos.copy(pos);
  }

  /** Přepočítá polohu kosti z rodiče (klidový lokální posun). */
  updatePos(b: RigBone): void {
    if (b.parent) b.pos.copy(b.restLocalPos).applyQuaternion(b.parent.quat).add(b.parent.pos);
  }

  /** Orientace = klidová lokální orientace × delta (v lokálním prostoru kosti). */
  setLocalDelta(b: RigBone, delta?: THREE.Quaternion): void {
    this.updatePos(b);
    if (b.parent) b.quat.copy(b.parent.quat).multiply(b.restLocalQuat);
    else b.quat.copy(b.restLocalQuat);
    if (delta) b.quat.multiply(delta);
    b.posed = true;
  }

  /** Orientace = rotace (v prostoru modelu) aplikovaná na „přirozenou“ orientaci z rodiče. */
  setModelDelta(b: RigBone, deltaModel: THREE.Quaternion): void {
    this.updatePos(b);
    if (b.parent) b.quat.copy(b.parent.quat).multiply(b.restLocalQuat);
    else b.quat.copy(b.restLocalQuat);
    b.quat.premultiply(deltaModel);
    b.posed = true;
  }

  /** Orientace = rotace v prostoru modelu aplikovaná na KLIDOVOU orientaci (nezávisle na rodiči). */
  setFromRest(b: RigBone, rotModel: THREE.Quaternion, keepPos = false): void {
    if (!keepPos) this.updatePos(b);
    b.quat.copy(rotModel).multiply(b.restQuat);
    b.posed = true;
  }

  /**
   * Namíří kost daným směrem (prostor modelu). Vychází z orientace `base` (výchozí: klidová otočená
   * stejně jako tělo), aby se kost zbytečně nepřetáčela kolem své osy.
   */
  aim(b: RigBone, dir: THREE.Vector3, bodyQuat: THREE.Quaternion): void {
    this.updatePos(b);
    // klidový směr a orientace po otočení tělem
    _v.copy(b.restDir).applyQuaternion(bodyQuat);
    _q.setFromUnitVectors(_v, dir);
    b.quat.copy(bodyQuat).multiply(b.restQuat).premultiply(_q);
    b.posed = true;
  }

  /** Konec kosti (kde začíná další) v prostoru modelu. */
  tip(b: RigBone, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(b.restDir).applyQuaternion(_q.copy(b.quat).multiply(_q2.copy(b.restQuat).invert())).multiplyScalar(b.length).add(b.pos);
  }

  /** Zapíše pózu do kostí Three.js. Nenapózované kosti dědí klidovou lokální orientaci. */
  apply(): void {
    for (const b of this.order) {
      if (!b.posed) {
        this.updatePos(b);
        if (b.parent) b.quat.copy(b.parent.quat).multiply(b.restLocalQuat);
        else b.quat.copy(b.restLocalQuat);
      }
      if (b.parent) {
        _q.copy(b.parent.quat).invert();
        b.bone.quaternion.copy(_q).multiply(b.quat);
        if (b.name === 'hips') {
          b.bone.position.copy(b.pos).sub(b.parent.pos).applyQuaternion(_q);
        } else {
          b.bone.position.copy(b.restLocalPos);
        }
      } else {
        b.bone.quaternion.copy(b.quat);
        b.bone.position.copy(b.pos);
      }
    }
  }
}

/**
 * Analytické IK pro dvě kosti: vrátí polohu středního kloubu (koleno/loket).
 * @param pole směr, kam má kloub mířit (nemusí být kolmý)
 */
export function solveTwoBone(
  a: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3,
): number {
  const dir = _v.subVectors(target, a);
  let d = dir.length();
  if (d < 1e-5) {
    dir.set(0, -1, 0);
    d = 1e-5;
  } else dir.divideScalar(d);
  const reach = l1 + l2 - 0.0015;
  const minD = Math.abs(l1 - l2) + 0.004;
  const dc = Math.min(Math.max(d, minD), reach);
  const along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // složka pólu kolmá na osu
  const p = outMid.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(dir, -dir.z);
  p.normalize();
  outEnd.copy(a).addScaledVector(dir, dc);
  outMid.multiplyScalar(h).addScaledVector(dir, along).add(a);
  return dc / reach; // míra natažení
}
