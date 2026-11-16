import * as THREE from 'three';
import { Physics, GROUPS } from '../core/Physics';
import type { CatController } from './CatController';
import { CatRig, LEGS, solveTwoBone, type LegChain, type LegName, type RigBone } from './CatRig';

/**
 * Procedurální animace Tigera.
 *
 * Všechno se počítá za běhu: krok/klus/běh s fázově posunutýma nohama a tlapkami ukotvenými ve
 * světě (foot IK s raycastem), ohyb páteře v zatáčce, přikrčení → odraz → let → dopad s pružinou,
 * sezení, plížení, švih tlapkou, čichání, olizování, dýchání, pružinový ocas, look-at hlavy, uši.
 */

export type CatAction = 'none' | 'sit' | 'lick' | 'sniff' | 'eat' | 'lie' | 'sleep';
export type TailMood = 'neutral' | 'happy' | 'annoyed' | 'alert';

interface Foot {
  leg: LegChain;
  /** Aktuální poloha kloubu tlapky ve světě. */
  pos: THREE.Vector3;
  planted: boolean;
  liftPos: THREE.Vector3;
  landPos: THREE.Vector3;
  /** 0..1 zdvih při přenášení. */
  lift: number;
  /** Průběh korekčního kroku ve stoje (−1 = neprobíhá). */
  step: number;
  groundY: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
/** Nejdelší krok integrace pružin (dip po dopadu, ocas). */
const SPRING_STEP = 1 / 120;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = THREE.MathUtils.clamp;
const frac = (v: number) => v - Math.floor(v);

// fázové posuny nohou: [přední L, přední P, zadní L, zadní P]
const GAIT_WALK = [0.25, 0.75, 0.0, 0.5];
const GAIT_TROT = [0.5, 0.0, 0.0, 0.5];
const GAIT_GALLOP = [0.58, 0.48, 0.0, 0.1];

export class CatAnimator {
  action: CatAction = 'none';
  tailMood: TailMood = 'neutral';
  /** Bod ve světě, na který se má hlava dívat (null = dopředu). */
  lookTarget: THREE.Vector3 | null = null;
  /** Otevření tlamy 0..1 (mňoukání). */
  mouth = 0;
  /** Rychlost dýchání (předení = rychlejší a hlubší). */
  breathRate = 1;
  /** Švih tlapkou: cíl ve světě. */
  private swipeT = -1;
  private swipeLeg: LegName = 'frontR';
  private swipeTarget = new THREE.Vector3();
  private swipeDuration = 0.36;
  /** Zdvižená tlapka k olizování. */
  private lickW = 0;
  private time = 0;
  private phase = 0;
  private feet: Record<LegName, Foot>;
  private crouchW = 0;
  private aimW = 0;
  private sitW = 0;
  private lieW = 0;
  private sleepW = 0;
  private sniffW = 0;
  private eatW = 0;
  private airW = 0;
  private dip = 0;
  private dipVel = 0;
  private bend = 0;
  private lean = 0;
  private headYaw = 0;
  private headPitch = 0;
  private bodyPitchSm = 0;
  private gaitW = 0; // 0 chůze, 1 klus, 2 cval
  private moveW = 0;
  private wasAir = false;
  private tailPitch: number[];
  private tailYaw: number[];
  private tailPitchV: number[];
  private tailYawV: number[];
  private lastYaw = 0;
  private yawRate = 0;
  private earTimer = [2, 3.4];
  private earTwitch = [0, 0];
  private readonly rootPos = new THREE.Vector3();
  private rootYaw = 0;
  private readonly bodyQuat = new THREE.Quaternion();
  private standHips: number;
  private standChest: number;
  private footPitchRest = { front: 0.5, hind: 0.4 };
  /** Poslední světové polohy pro efekty. */
  readonly headPos = new THREE.Vector3();
  readonly nosePos = new THREE.Vector3();
  readonly headForward = new THREE.Vector3(0, 0, 1);
  onFootstep: ((leg: LegName, pos: THREE.Vector3) => void) | null = null;

  constructor(private rig: CatRig, private controller: CatController, private physics: Physics) {
    const mk = (leg: LegChain): Foot => ({
      leg, pos: new THREE.Vector3(), planted: true, liftPos: new THREE.Vector3(), landPos: new THREE.Vector3(), lift: 0, step: -1, groundY: 0,
    });
    this.feet = { frontL: mk(rig.legs.frontL), frontR: mk(rig.legs.frontR), hindL: mk(rig.legs.hindL), hindR: mk(rig.legs.hindR) };
    const n = rig.tail.length;
    this.tailPitch = new Array(n).fill(0);
    this.tailYaw = new Array(n).fill(0);
    this.tailPitchV = new Array(n).fill(0);
    this.tailYawV = new Array(n).fill(0);
    this.standHips = rig.get('hips').restPos.y;
    this.standChest = rig.get('chest').restPos.y;
    // klidový sklon nártu (průměr L/P)
    const pitchOf = (b: RigBone) => Math.atan2(b.restDir.z, -b.restDir.y);
    this.footPitchRest.front = (pitchOf(rig.legs.frontL.foot) + pitchOf(rig.legs.frontR.foot)) / 2;
    this.footPitchRest.hind = (pitchOf(rig.legs.hindL.foot) + pitchOf(rig.legs.hindR.foot)) / 2;
    this.snapFeet();
  }

  /** Švihnutí tlapkou po cíli (světové souřadnice). */
  swipe(target: THREE.Vector3, duration = 0.36): void {
    this.toModel(target, _a);
    this.swipeLeg = _a.x >= 0 ? 'frontL' : 'frontR';
    this.swipeTarget.copy(target);
    this.swipeT = 0;
    this.swipeDuration = duration;
  }

  get swiping(): boolean {
    return this.swipeT >= 0;
  }

  /** Okamžitě postaví tlapky do výchozích poloh (teleport, dopad). */
  snapFeet(): void {
    this.rootPos.copy(this.controller.position);
    this.rootYaw = this.controller.yaw;
    for (const leg of LEGS) {
      const f = this.feet[leg];
      this.homeWorld(f, _a);
      f.groundY = this.groundAt(_a, this.rootPos.y);
      f.pos.set(_a.x, f.groundY + this.rig.pawHeight, _a.z);
      f.planted = true;
      f.lift = 0;
      f.step = -1;
    }
  }

  private toWorld(m: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.rootYaw);
    const c = Math.cos(this.rootYaw);
    return out.set(m.x * c + m.z * s + this.rootPos.x, m.y + this.rootPos.y, -m.x * s + m.z * c + this.rootPos.z);
  }

  private toModel(w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const s = Math.sin(this.rootYaw);
    const c = Math.cos(this.rootYaw);
    const x = w.x - this.rootPos.x;
    const z = w.z - this.rootPos.z;
    return out.set(x * c - z * s, w.y - this.rootPos.y, x * s + z * c);
  }

  /** Výchozí poloha tlapky ve světě (závisí na póze). */
  private homeWorld(f: Foot, out: THREE.Vector3): THREE.Vector3 {
    const h = f.leg.home;
    let x = h.x;
    let z = h.z;
    if (f.leg.front) {
      z += -0.035 * this.sitW + 0.03 * this.crouchW + 0.05 * this.lieW;
      x *= 1 + 0.25 * this.crouchW;
    } else {
      z += 0.115 * this.sitW - 0.01 * this.crouchW + 0.1 * this.lieW;
      x *= 1 + 0.35 * this.sitW + 0.3 * this.crouchW + 0.25 * this.lieW;
    }
    return this.toWorld(_e.set(x, 0, z), out);
  }

  private groundAt(p: THREE.Vector3, baseY: number): number {
    const y = this.physics.groundHeight(p.x, baseY + 0.16, p.z, 0.34, GROUPS.queryGround, this.controller.collider);
    // mimo hranu (pod tlapkou nic není) → držet úroveň těla
    if (y === -Infinity || y < baseY - 0.11) return baseY - 0.012;
    return y;
  }

  // ---------------------------------------------------------------------------- hlavní aktualizace
  update(dt: number, renderPos: THREE.Vector3): void {
    if (dt <= 0) return;
    const c = this.controller;
    const rig = this.rig;
    this.time += dt;
    this.rootPos.copy(renderPos);
    this.rootYaw = c.yaw;
    let dyaw = c.yaw - this.lastYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.lastYaw = c.yaw;
    this.yawRate = damp(this.yawRate, dyaw / dt, 10, dt);

    const inAir = c.mode === 'air';
    const act = this.action;
    const speed = inAir ? 0 : c.speed;
    const moving = speed > 0.08;
    // --- váhy stavů
    this.crouchW = damp(this.crouchW, c.crouching ? 1 : 0, 9, dt);
    this.aimW = damp(this.aimW, c.aiming ? 1 : 0, 10, dt);
    const sitting = (act === 'sit' || act === 'lick') && !moving && !inAir;
    this.sitW = damp(this.sitW, sitting ? 1 : 0, 5, dt);
    this.lieW = damp(this.lieW, (act === 'lie' || act === 'sleep') && !moving && !inAir ? 1 : 0, 3.5, dt);
    this.sleepW = damp(this.sleepW, act === 'sleep' ? 1 : 0, 3, dt);
    this.sniffW = damp(this.sniffW, act === 'sniff' && !inAir ? 1 : 0, 6, dt);
    this.eatW = damp(this.eatW, act === 'eat' && !inAir ? 1 : 0, 6, dt);
    this.lickW = damp(this.lickW, act === 'lick' && this.sitW > 0.8 ? 1 : 0, 5, dt);
    this.airW = damp(this.airW, inAir ? 1 : 0, inAir ? 22 : 16, dt);
    this.moveW = damp(this.moveW, moving ? 1 : 0, 8, dt);
    const gaitTarget = speed < 1.25 ? 0 : speed < 3.0 ? 1 : 2;
    this.gaitW = damp(this.gaitW, gaitTarget, 6, dt);
    const trotW = clamp(this.gaitW, 0, 1);
    const gallopW = clamp(this.gaitW - 1, 0, 1);

    // dopad: pružina podřepu
    if (this.wasAir && !inAir) {
      this.dipVel -= Math.min(2.2, 0.25 + c.lastImpact * 0.22);
      this.snapFeet();
    }
    this.wasAir = inAir;
    // Pružiny se integrují po malých krocích: při pomalých snímcích (dt až 0,1 s) by jeden velký
    // krok kmital a tělo by se samo přikrčovalo a zase narovnávalo.
    const sub = Math.max(1, Math.ceil(dt / SPRING_STEP));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.dipVel += (-this.dip * 190 - this.dipVel * 17) * h;
      this.dip = clamp(this.dip + this.dipVel * h, -0.09, 0.03);
    }

    // --- krokový cyklus
    const freq = 1.15 + 0.78 * speed;
    if (moving) this.phase += freq * dt;
    const duty = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.66, 0.52, trotW), 0.38, gallopW);
    const stepH = (0.022 + 0.014 * trotW + 0.03 * gallopW) * (1 - 0.45 * this.crouchW);

    // --- tlapky
    if (this.airW < 0.5) this.updateFeet(dt, moving, freq, duty, stepH, trotW, gallopW);

    // --- tělo
    const bob = moving ? Math.sin(this.phase * Math.PI * 4) * (0.003 + 0.004 * trotW) * (1 - gallopW) : 0;
    const gallopRock = moving ? Math.sin(this.phase * Math.PI * 2 + 0.6) * gallopW : 0;
    const breath = Math.sin(this.time * 1.9 * this.breathRate) * (0.0022 + 0.002 * this.sleepW + 0.0015 * (this.breathRate - 1));
    let hipsY = this.standHips;
    let chestY = this.standChest;
    let hipsZ = rig.get('hips').restPos.z;
    let chestZ = rig.get('chest').restPos.z;
    const low = 0.112;
    hipsY = THREE.MathUtils.lerp(hipsY, low + 0.004, this.crouchW);
    chestY = THREE.MathUtils.lerp(chestY, low, this.crouchW);
    hipsY -= 0.05 * this.aimW;
    chestY -= 0.028 * this.aimW;
    // sed: zadek dolů a dozadu, hruď zůstane nahoře
    hipsY = THREE.MathUtils.lerp(hipsY, 0.098, this.sitW);
    chestY = THREE.MathUtils.lerp(chestY, 0.232, this.sitW);
    hipsZ += 0.012 * this.sitW;
    chestZ -= 0.035 * this.sitW;
    // leh (sfinga)
    hipsY = THREE.MathUtils.lerp(hipsY, 0.078, this.lieW);
    chestY = THREE.MathUtils.lerp(chestY, 0.088 - 0.012 * this.sleepW, this.lieW);
    // čichání / žraní: hruď níž
    chestY -= 0.035 * this.sniffW + 0.03 * this.eatW;
    hipsY += bob + this.dip * 0.85 + gallopRock * 0.018;
    chestY += bob + this.dip + breath - gallopRock * 0.022;
    // výška podle terénu pod tlapkami
    const F = this.feet;
    const base = this.rootPos.y;
    const frontG = (F.frontL.groundY + F.frontR.groundY) / 2 - base;
    const hindG = (F.hindL.groundY + F.hindR.groundY) / 2 - base;
    const groundW = 1 - this.airW;
    hipsY += clamp(hindG, -0.06, 0.1) * groundW;
    chestY += clamp(frontG, -0.06, 0.1) * groundW;
    // čenich opřený o překážku → tělo kousek dozadu
    const back = c.noseBlock * (1 - this.airW);
    hipsZ -= back;
    chestZ -= back;

    // ohyb páteře v zatáčce a náklon
    this.bend = damp(this.bend, clamp(this.yawRate * 0.085, -0.55, 0.55) * (inAir ? 0.3 : 1), 7, dt);
    this.lean = damp(this.lean, clamp(-this.yawRate * speed * 0.018, -0.2, 0.2), 6, dt);

    // let: náklon těla podle směru letu
    let airPitch = 0;
    if (this.airW > 0.01) {
      const vh = Math.hypot(c.velocity.x, c.velocity.z);
      airPitch = clamp(Math.atan2(c.velocity.y, Math.max(vh, 0.6)) * 0.8, -0.95, 0.95);
    }
    this.bodyPitchSm = damp(this.bodyPitchSm, airPitch, 12, dt);
    const half = (chestZ - hipsZ) / 2;
    const airHipsY = 0.2 - Math.sin(this.bodyPitchSm) * half;
    const airChestY = 0.2 + Math.sin(this.bodyPitchSm) * half;
    hipsY = THREE.MathUtils.lerp(hipsY, airHipsY, this.airW);
    chestY = THREE.MathUtils.lerp(chestY, airChestY, this.airW);

    rig.begin();
    const hips = rig.get('hips');
    const chest = rig.get('chest');
    // osa páteře
    _a.subVectors(chest.restPos, hips.restPos).normalize();
    _b.set(0, chestY - hipsY, chestZ - hipsZ).normalize();
    this.bodyQuat.setFromUnitVectors(_a, _b);
    const bodyPitch = Math.atan2(_b.y, _b.z);
    // náklon (roll) kolem osy těla
    _q.setFromAxisAngle(_b, this.lean);
    this.bodyQuat.premultiply(_q);
    // pánev se v zatáčce vytočí ven
    _q.setFromAxisAngle(Y, -this.bend * 0.5);
    _q2.copy(this.bodyQuat).premultiply(_q);
    hips.pos.set(Math.sin(this.phase * Math.PI * 2) * 0.004 * this.moveW * (1 - gallopW), hipsY, hipsZ);
    rig.setFromRest(hips, _q2, true);
    // páteř: boční ohyb + prohnutí při cvalu
    const arch = Math.sin(this.phase * Math.PI * 2 + 0.6) * 0.14 * gallopW - 0.05 * this.aimW + 0.1 * this.sitW;
    for (let i = 0; i < rig.spine.length; i++) {
      _q.setFromAxisAngle(Y, this.bend * 0.25);
      _q3.setFromAxisAngle(X, arch * 0.25);
      _q.multiply(_q3);
      rig.setModelDelta(rig.spine[i], _q);
    }

    // --- nohy
    for (const leg of LEGS) this.solveLeg(this.feet[leg], dt, gallopW);

    // --- krk a hlava
    this.updateHead(dt, bodyPitch);

    // --- ocas
    this.updateTail(dt, speed, inAir);

    // --- uši a tlama
    this.updateEars(dt);
    const jaw = rig.get('jaw');
    const chew = this.eatW * (0.5 + 0.5 * Math.sin(this.time * 14)) * 0.5 + this.lickW * (0.35 + 0.25 * Math.sin(this.time * 9));
    const open = clamp(this.mouth + chew, 0, 1);
    if (open > 0.002) {
      _q.setFromAxisAngle(_a.set(1, 0, 0).applyQuaternion(rig.get('head').quat).normalize(), open * 0.5);
      rig.setModelDelta(jaw, _q);
    }

    rig.apply();

    // švih tlapkou – čas
    if (this.swipeT >= 0) {
      this.swipeT += dt / this.swipeDuration;
      if (this.swipeT >= 1) this.swipeT = -1;
    }
  }

  // ---------------------------------------------------------------------------- tlapky na zemi
  private updateFeet(dt: number, moving: boolean, freq: number, duty: number, stepH: number, trotW: number, gallopW: number): void {
    const c = this.controller;
    const offs = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const wt = THREE.MathUtils.lerp(GAIT_WALK[i], GAIT_TROT[i], trotW);
      offs[i] = THREE.MathUtils.lerp(wt, GAIT_GALLOP[i], gallopW);
    }
    const vx = c.position.x - c.prevPosition.x;
    const vz = c.position.z - c.prevPosition.z;
    const fdt = this.physics.fixedDt;
    const velX = vx / fdt;
    const velZ = vz / fdt;
    let stepping = false;
    for (const leg of LEGS) if (this.feet[leg].step >= 0) stepping = true;

    LEGS.forEach((name, i) => {
      const f = this.feet[name];
      const home = this.homeWorld(f, _a);
      if (moving) {
        f.step = -1;
        const ph = frac(this.phase + offs[i]);
        if (ph < duty) {
          // opora: tlapka stojí ve světě
          if (!f.planted) {
            f.planted = true;
            f.lift = 0;
            f.pos.copy(f.landPos);
            this.onFootstep?.(name, f.pos);
          }
          // pojistka proti přetažení (prudká změna směru)
          const dx = f.pos.x - home.x;
          const dz = f.pos.z - home.z;
          if (dx * dx + dz * dz > 0.2 * 0.2) {
            f.pos.x = home.x + dx * 0.5;
            f.pos.z = home.z + dz * 0.5;
          }
        } else {
          const u = (ph - duty) / (1 - duty);
          if (f.planted) {
            f.planted = false;
            f.liftPos.copy(f.pos);
          }
          const tRemain = ((1 - u) * (1 - duty)) / freq;
          const stanceT = duty / freq;
          const lead = tRemain + stanceT * 0.5;
          f.landPos.set(home.x + velX * lead, 0, home.z + velZ * lead);
          f.groundY = this.groundAt(f.landPos, this.rootPos.y);
          f.landPos.y = f.groundY + this.rig.pawHeight;
          const s = smooth(u);
          f.pos.lerpVectors(f.liftPos, f.landPos, s);
          f.lift = Math.sin(Math.PI * u);
          f.pos.y += stepH * f.lift * (f.leg.front ? 1 : 0.85);
        }
      } else {
        // stání: korekční krůčky, když je tlapka daleko od výchozí polohy
        if (!f.planted && f.step < 0) {
          f.planted = true;
          f.lift = 0;
          f.groundY = this.groundAt(f.pos, this.rootPos.y);
          f.pos.y = f.groundY + this.rig.pawHeight;
        }
        if (f.step >= 0) {
          f.step += dt / 0.16;
          const u = Math.min(1, f.step);
          f.pos.lerpVectors(f.liftPos, f.landPos, smooth(u));
          f.lift = Math.sin(Math.PI * u);
          f.pos.y += 0.02 * f.lift;
          if (u >= 1) {
            f.step = -1;
            f.planted = true;
            f.lift = 0;
          }
        } else {
          const dx = f.pos.x - home.x;
          const dz = f.pos.z - home.z;
          const err = Math.hypot(dx, dz);
          const tol = this.sitW > 0.3 || this.lieW > 0.3 || this.crouchW > 0.3 ? 0.02 : 0.035;
          if (err > 0.16) {
            // příliš daleko (teleport, sklouznutí) → přesadit hned
            f.groundY = this.groundAt(home, this.rootPos.y);
            f.pos.set(home.x, f.groundY + this.rig.pawHeight, home.z);
          } else if (err > tol && !stepping) {
            stepping = true;
            f.step = 0;
            f.planted = false;
            f.liftPos.copy(f.pos);
            f.groundY = this.groundAt(home, this.rootPos.y);
            f.landPos.set(home.x, f.groundY + this.rig.pawHeight, home.z);
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------------------- IK nohy
  private solveLeg(f: Foot, dt: number, gallopW: number): void {
    const rig = this.rig;
    const leg = f.leg;
    const c = this.controller;
    rig.updatePos(leg.upper);
    const hip = leg.upper.pos;
    // cíl kloubu tlapky v prostoru modelu
    const P = this.toModel(f.pos, _a);
    let lift = f.lift;
    let pitch = leg.front ? this.footPitchRest.front : this.footPitchRest.hind;
    let poleX = leg.side * 0.12;
    let poleY = leg.front ? 0 : 0.15;

    if (this.airW > 0.01) {
      // póza ve vzduchu: odraz → let → příprava na dopad
      const t = c.airTime;
      const flight = c.flight;
      const total = flight ? flight.time : 0.6;
      const toLand = Math.max(0, total - t);
      const launch = clamp(1 - t / 0.14, 0, 1);
      const prep = c.velocity.y < 0 ? clamp(1 - toLand / 0.2, 0, 1) : 0;
      const A = _b;
      if (leg.front) {
        A.set(leg.side * 0.034, 0.1, 0.25); // natažené dopředu
        A.lerp(_c.set(leg.side * 0.03, 0.15, 0.2), launch); // při odrazu pokrčené u hrudi
        A.lerp(_c.set(leg.side * 0.038, -0.03, 0.23), prep); // před dopadem dolů a vpřed
      } else {
        A.set(leg.side * 0.042, 0.07, -0.25); // vlají vzadu
        A.lerp(_c.set(leg.side * 0.045, -0.035, -0.27), launch); // odraz: plně natažené
        A.lerp(_c.set(leg.side * 0.048, 0.0, -0.06), prep); // před dopadem pod tělo
      }
      // natočit podle sklonu těla
      A.y += Math.sin(this.bodyPitchSm) * A.z * 0.8;
      P.lerp(A, this.airW);
      lift = THREE.MathUtils.lerp(lift, 0.9 - 0.9 * prep, this.airW);
      // světovou polohu držet v souladu (pro dopad)
      this.toWorld(P, f.pos);
    }

    // švih tlapkou
    if (this.swipeT >= 0 && leg.name === this.swipeLeg) {
      const u = this.swipeT;
      const w = Math.sin(Math.PI * Math.min(1, u * 1.15));
      const T = this.toModel(this.swipeTarget, _b);
      // dosah omezit na délku nohy
      _c.subVectors(T, hip);
      const maxReach = leg.upper.length + leg.lower.length + leg.foot.length * 0.9;
      if (_c.length() > maxReach) T.copy(hip).addScaledVector(_c.normalize(), maxReach);
      // oblouk: nejdřív nahoru a ven, pak přes cíl
      T.x += leg.side * 0.05 * Math.cos(Math.PI * u);
      T.y += 0.03 * (1 - u);
      P.lerp(T, w);
      lift = Math.max(lift, w);
    }

    // olizování: tlapka k tlamě
    if (this.lickW > 0.01 && leg.name === 'frontR') {
      const T = this.toModel(this.nosePos, _b);
      T.y -= 0.03 + Math.sin(this.time * 9) * 0.012;
      T.z -= 0.012;
      T.x += 0.004;
      P.lerp(T, this.lickW);
      lift = Math.max(lift, this.lickW);
    }

    // sklon nártu
    if (leg.front) {
      pitch = THREE.MathUtils.lerp(pitch, -0.75, clamp(lift, 0, 1));
      pitch = THREE.MathUtils.lerp(pitch, 1.3, this.lieW); // předloktí leží na zemi
      poleX += leg.side * (0.5 * this.crouchW + 0.25 * this.lieW);
      poleY += 0.35 * this.crouchW;
    } else {
      pitch = THREE.MathUtils.lerp(pitch, -0.35, clamp(lift, 0, 1) * (1 - this.airW * 0.5));
      pitch = THREE.MathUtils.lerp(pitch, 1.32, Math.max(this.sitW, this.lieW)); // nárt leží na zemi
      poleX += leg.side * (0.7 * this.sitW + 0.45 * this.crouchW + 0.6 * this.lieW);
      poleY += 0.3 * this.sitW + 0.2 * this.crouchW;
    }
    // při ležení/sezení je kloub tlapky níž (tlapka leží)
    const fdir = _c.set(0, -Math.cos(pitch), Math.sin(pitch));
    // kotník / zápěstí
    const ankle = _d.copy(P).addScaledVector(fdir, -leg.foot.length);
    // koleno dopředu, loket dozadu
    const pole = _e.set(poleX, poleY, leg.front ? -1 : 1);
    if (leg.front && this.lieW > 0.3) pole.set(leg.side * 0.4, 0.8, -0.4);
    solveTwoBone(hip, ankle, leg.upper.length, leg.lower.length, pole, _mid, _end);
    // namířit kosti
    const bq = this.bodyQuat;
    rig.aim(leg.upper, _b.subVectors(_mid, hip).normalize(), bq);
    rig.aim(leg.lower, _b.subVectors(_end, _mid).normalize(), bq);
    // nárt: z dosaženého kotníku k cíli (když je noha natažená naplno, cíl se nedosáhne)
    _b.copy(fdir);
    rig.aim(leg.foot, _b, bq);
    // prsty: na zemi naplocho, ve vzduchu svěšené
    const droop = clamp(lift, 0, 1);
    _b.set(0, -0.42 - 0.5 * droop, 0.9 - 0.55 * droop).normalize();
    if (!leg.front && this.sitW > 0.5) _b.set(0, -0.15, 1).normalize();
    rig.aim(leg.paw, _b, bq);
    void dt;
    void gallopW;
  }

  // ---------------------------------------------------------------------------- hlava
  private updateHead(dt: number, bodyPitch: number): void {
    const rig = this.rig;
    const neck1 = rig.get('neck1');
    const neck2 = rig.get('neck2');
    const head = rig.get('head');
    rig.updatePos(neck1);
    // cílový směr pohledu v prostoru modelu
    let wantYaw = 0;
    let wantPitch = 0;
    if (this.lookTarget && this.sleepW < 0.3) {
      const t = this.toModel(this.lookTarget, _a);
      const hp = this.toModel(this.headPos, _b);
      const dx = t.x - hp.x;
      const dy = t.y - hp.y;
      const dz = t.z - hp.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05 || Math.abs(dy) > 0.05) {
        wantYaw = clamp(Math.atan2(dx, dz), -1.25, 1.25);
        wantPitch = clamp(Math.atan2(dy, Math.max(dist, 0.08)), -0.75, 0.7);
        // cíl za zády → nedívat se
        if (dz < -0.15 && Math.abs(wantYaw) > 1.2) {
          wantYaw = 0;
          wantPitch = 0;
        }
      }
    }
    // zatáčka: hlava vede pohyb
    wantYaw += clamp(this.yawRate * 0.12, -0.5, 0.5) * this.moveW;
    this.headYaw = damp(this.headYaw, wantYaw, 7, dt);
    this.headPitch = damp(this.headPitch, wantPitch, 7, dt);

    // základ: vyrovnat natočení hlavy z klidové pózy modelu
    const unturn = THREE.MathUtils.degToRad(-rig.headYaw);
    const yawTotal = unturn + this.headYaw;
    // sklon: hlava drží horizont i když se tělo naklání
    const sniff = Math.max(this.sniffW, this.eatW);
    const nod = Math.sin(this.time * 11) * 0.03 * this.sniffW + Math.sin(this.time * 7) * 0.05 * this.eatW + Math.sin(this.time * 9) * 0.04 * this.lickW;
    const level = -bodyPitch * 0.85;
    // plížení: krk vodorovně dopředu
    const neckDown = -0.8 * this.crouchW - 0.25 * this.aimW - 1.05 * sniff - 0.55 * this.lieW - 0.5 * this.lickW - 0.35 * this.sleepW;
    const headUp = 0.62 * this.crouchW + 0.2 * this.aimW + 0.25 * sniff + 0.4 * this.lieW - 0.45 * this.sleepW - 0.2 * this.lickW;
    const neckPitch = level * 0.5 + neckDown + this.headPitch * 0.35;
    const headPitch = level * 0.5 + headUp + this.headPitch * 0.65 + nod;

    const set = (b: RigBone, yaw: number, pitch: number) => {
      // otočení kolem svislé osy, pak sklon kolem příčné osy hlavy
      _q.setFromAxisAngle(Y, yaw);
      _a.copy(X).applyQuaternion(_q2.setFromAxisAngle(Y, yawTotal));
      _q3.setFromAxisAngle(_a, -pitch);
      _q3.multiply(_q);
      rig.setModelDelta(b, _q3);
    };
    set(neck1, yawTotal * 0.3, neckPitch * 0.55);
    set(neck2, yawTotal * 0.3, neckPitch * 0.45);
    set(head, yawTotal * 0.4, headPitch);

    // světové polohy pro efekty
    const hq = head.quat;
    _a.copy(head.restDir).applyQuaternion(_q.copy(hq).multiply(_q2.copy(head.restQuat).invert())).normalize();
    this.headForward.copy(_a).applyAxisAngle(Y, this.rootYaw);
    _b.copy(head.pos).addScaledVector(_a, 0.035);
    this.toWorld(_b, this.headPos);
    _b.copy(head.pos).addScaledVector(_a, 0.082);
    _b.y -= 0.018;
    this.toWorld(_b, this.nosePos);
  }

  // ---------------------------------------------------------------------------- ocas
  private updateTail(dt: number, speed: number, inAir: boolean): void {
    const rig = this.rig;
    const n = rig.tail.length;
    const t = this.time;
    // cílový tvar: součet sklonů po článcích (klidová póza modelu má ocas zvednutý)
    let pitchTotal = -0.55 - 0.25 * Math.min(1, speed / 2);
    let curl = 0.5; // špička nahoru
    let yawTotal = 0;
    let sway = Math.sin(t * 1.3) * 0.12 + Math.sin(this.phase * Math.PI * 2) * 0.1 * this.moveW;
    if (speed > 2.8) {
      pitchTotal = -0.95;
      curl = 0.15;
    }
    pitchTotal = THREE.MathUtils.lerp(pitchTotal, -1.25, this.crouchW);
    pitchTotal = THREE.MathUtils.lerp(pitchTotal, -1.05, this.aimW);
    if (this.aimW > 0.5) sway += Math.sin(t * 13) * 0.14; // chvění před skokem
    // sed / leh: ocas položený kolem těla
    const wrap = Math.max(this.sitW, this.lieW);
    pitchTotal = THREE.MathUtils.lerp(pitchTotal, -1.5, wrap);
    yawTotal = THREE.MathUtils.lerp(yawTotal, 2.3, wrap);
    curl = THREE.MathUtils.lerp(curl, 0.1, wrap);
    if (inAir) {
      pitchTotal = -0.4 + this.bodyPitchSm * 0.5;
      curl = 0.2;
    }
    switch (this.tailMood) {
      case 'happy':
        pitchTotal = THREE.MathUtils.lerp(pitchTotal, 0.25, 1 - wrap);
        curl = 0.9;
        break;
      case 'annoyed':
        sway += Math.sin(t * 9.5) * 0.75;
        break;
      case 'alert':
        pitchTotal = THREE.MathUtils.lerp(pitchTotal, -0.2, 1 - wrap);
        sway += Math.sin(t * 4) * 0.2;
        break;
    }
    const k = 70;
    const cdamp = 9;
    const sub = Math.max(1, Math.ceil(dt / SPRING_STEP));
    const h = dt / sub;
    for (let i = 0; i < n; i++) {
      const w = (i + 1) / n;
      const tp = (pitchTotal / n) * (1.5 - w) * 1.2 + (curl / n) * w * 2.2 * (i > n / 2 ? 1 : 0.2);
      const ty = yawTotal / n + (sway / n) * (0.5 + w) * Math.cos(t * 2.1 - i * 0.55 + (this.tailMood === 'annoyed' ? t * 7 : 0)) * (this.tailMood === 'annoyed' ? 1 : 1) + (sway / n) * 0.6;
      // setrvačnost: při otáčení těla se ocas opožďuje
      const inertiaY = -this.yawRate * 0.9 * w;
      const inertiaP = -this.dipVel * 2.5 * w;
      for (let s = 0; s < sub; s++) {
        this.tailYawV[i] += ((ty - this.tailYaw[i]) * k - this.tailYawV[i] * cdamp + inertiaY * 6) * h;
        this.tailPitchV[i] += ((tp - this.tailPitch[i]) * k - this.tailPitchV[i] * cdamp + inertiaP * 6) * h;
        this.tailYaw[i] = clamp(this.tailYaw[i] + this.tailYawV[i] * h, -0.9, 0.9);
        this.tailPitch[i] = clamp(this.tailPitch[i] + this.tailPitchV[i] * h, -0.8, 0.8);
      }
      _q.setFromAxisAngle(X, this.tailPitch[i]);
      _q2.setFromAxisAngle(Y, this.tailYaw[i]);
      _q2.multiply(_q);
      rig.setModelDelta(rig.tail[i], _q2);
    }
  }

  // ---------------------------------------------------------------------------- uši
  private updateEars(dt: number): void {
    const rig = this.rig;
    const flat = Math.max(this.crouchW * 0.8, this.aimW * 0.7, this.tailMood === 'annoyed' ? 0.6 : 0, this.sleepW * 0.3);
    ['earL', 'earR'].forEach((name, i) => {
      this.earTimer[i] -= dt;
      if (this.earTimer[i] <= 0) {
        this.earTimer[i] = 1.8 + Math.random() * 4.5;
        this.earTwitch[i] = 1;
      }
      this.earTwitch[i] = Math.max(0, this.earTwitch[i] - dt * 5);
      const tw = Math.sin(this.earTwitch[i] * Math.PI) * 0.45;
      const ear = rig.get(name);
      const head = rig.get('head');
      // osy hlavy: příčná a svislá
      _a.set(1, 0, 0).applyQuaternion(_q.copy(head.quat).multiply(_q2.copy(head.restQuat).invert()));
      _q3.setFromAxisAngle(_a, -flat * 0.9); // sklopení dozadu
      _b.set(0, 1, 0);
      _q.setFromAxisAngle(_b, (i === 0 ? 1 : -1) * (tw + flat * 0.4));
      _q3.premultiply(_q);
      rig.setModelDelta(ear, _q3);
    });
  }

  /** Světová poloha tlapky (pro efekty a interakce). */
  pawPosition(leg: LegName, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.feet[leg].pos);
  }

  get sitAmount(): number {
    return this.sitW;
  }
}
