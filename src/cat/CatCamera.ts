import * as THREE from 'three';
import { Physics, GROUPS } from '../core/Physics';
import type { Input } from '../core/Input';
import type { CatController } from './CatController';
import { settings } from '../core/Settings';

/**
 * Kamera třetí osoby: obíhá kolem Tigera, spherecast řeší kolize, v nízkých prostorech
 * (pod gaučem) se plynule přiblíží a sníží. Umí i filmové záběry (intro, detaily, finále).
 */

export interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov?: number;
}

const _dir = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CatCamera {
  yaw = Math.PI; // směr pohledu kamery (0 = +Z)
  pitch = 0.2; // kladný = kamera nad kočkou
  distance = 1.15;
  private curDist = 1.15;
  private pivotY = 0.24;
  private readonly smoothPivot = new THREE.Vector3();
  private initialized = false;
  private shot: Shot | null = null;
  private shotBlend = 0; // 0 = sledování, 1 = záběr
  private shotSpeed = 2;
  private readonly shotPos = new THREE.Vector3();
  private readonly shotTarget = new THREE.Vector3();
  private shotFov = 50;
  private readonly followPos = new THREE.Vector3();
  private readonly followTarget = new THREE.Vector3();
  /** Pomalé otáčení v menu. */
  menuOrbit = false;
  private menuT = 0;
  /** Otřes (dopad). */
  private shake = 0;

  constructor(private camera: THREE.PerspectiveCamera, private physics: Physics, private input: Input, private cat: CatController) {}

  /** Přepne na filmový záběr (null = zpět za kočku). */
  setShot(shot: Shot | null, speed = 2.2): void {
    if (shot) {
      this.shot = shot;
      this.shotSpeed = speed;
    } else {
      this.shot = null;
      this.shotSpeed = speed;
    }
  }

  cutToShot(shot: Shot): void {
    this.shot = shot;
    this.shotBlend = 1;
    this.shotPos.copy(shot.position);
    this.shotTarget.copy(shot.target);
    this.shotFov = shot.fov ?? 50;
  }

  get inShot(): boolean {
    return this.shot !== null || this.shotBlend > 0.01;
  }

  addShake(amount: number): void {
    this.shake = Math.min(0.05, this.shake + amount);
  }

  /** Nastaví kameru za kočku. */
  resetBehind(): void {
    this.yaw = this.cat.yaw;
    this.pitch = 0.2;
    this.initialized = false;
  }

  update(dt: number): void {
    dt = Math.min(0.1, Math.max(0, dt));
    const cat = this.cat;
    const inp = this.input;
    // --- ovládání
    if (!this.shot) {
      this.yaw -= inp.look.x;
      this.pitch = THREE.MathUtils.clamp(this.pitch + inp.look.y, -0.42, 1.25);
      if (inp.wheel !== 0 && inp.gameplayEnabled) this.distance = THREE.MathUtils.clamp(this.distance + inp.wheel * 0.12, 0.6, 2.0);
    }
    if (this.menuOrbit) {
      this.menuT += dt;
    }

    // --- sledovací kamera
    const ceiling = cat.ceilingAbove(0.7);
    const tight = ceiling < 0.5 ? 1 - (ceiling - 0.2) / 0.3 : 0;
    const tightK = THREE.MathUtils.clamp(tight, 0, 1);
    const wantPivotY = THREE.MathUtils.lerp(cat.crouching ? 0.17 : 0.25, 0.09, tightK);
    this.pivotY += (wantPivotY - this.pivotY) * (1 - Math.exp(-dt * 8));
    // interpolovaná poloha kočky dodá hladký pohyb
    _pivot.set(cat.position.x, cat.position.y + this.pivotY, cat.position.z);
    if (!this.initialized) {
      this.smoothPivot.copy(_pivot);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt * 14);
    this.smoothPivot.x += (_pivot.x - this.smoothPivot.x) * k;
    this.smoothPivot.z += (_pivot.z - this.smoothPivot.z) * k;
    this.smoothPivot.y += (_pivot.y - this.smoothPivot.y) * (1 - Math.exp(-dt * (cat.mode === 'air' ? 7 : 12)));

    const pitch = THREE.MathUtils.lerp(this.pitch, Math.min(this.pitch, 0.06), tightK);
    const wantDist = THREE.MathUtils.lerp(this.distance, 0.5, tightK) * (cat.aiming ? 1.12 : 1);
    // směr od pivotu ke kameře
    _dir.set(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch)).normalize();
    let dist = wantDist;
    const hit = this.physics.sphereCast(this.smoothPivot, _dir, 0.09, wantDist, GROUPS.queryCamera, cat.collider);
    if (hit !== null) dist = Math.max(0.16, hit - 0.02);
    // přiblížit hned, oddálit pozvolna
    if (dist < this.curDist) this.curDist = dist;
    else this.curDist += (dist - this.curDist) * (1 - Math.exp(-dt * 4));
    this.followPos.copy(this.smoothPivot).addScaledVector(_dir, this.curDist);
    // při míření se dívá trochu přes rameno
    _look.copy(this.smoothPivot);
    _look.y += 0.05;
    this.followTarget.copy(_look);
    cat.cameraYaw = this.yaw;

    // --- filmový záběr
    const wantBlend = this.shot ? 1 : 0;
    const bs = 1 - Math.exp(-dt * this.shotSpeed);
    this.shotBlend += (wantBlend - this.shotBlend) * bs;
    if (Math.abs(wantBlend - this.shotBlend) < 0.002) this.shotBlend = wantBlend;
    if (this.shot) {
      this.shotPos.lerp(this.shot.position, 1 - Math.exp(-dt * 6));
      this.shotTarget.lerp(this.shot.target, 1 - Math.exp(-dt * 6));
      this.shotFov += ((this.shot.fov ?? 50) - this.shotFov) * (1 - Math.exp(-dt * 4));
    }

    const b = this.shotBlend * this.shotBlend * (3 - 2 * this.shotBlend);
    _want.copy(this.followPos).lerp(this.shotPos, b);
    _look.copy(this.followTarget).lerp(this.shotTarget, b);
    if (this.shake > 0.0005) {
      _want.x += (Math.random() - 0.5) * this.shake;
      _want.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.position.copy(_want);
    this.camera.lookAt(_look);
    const baseFov = settings.data.fov;
    const fov = THREE.MathUtils.lerp(baseFov, this.shotFov, b);
    if (Math.abs(fov - this.camera.fov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Bod, kam míří střed obrazovky (pro mířený skok). */
  aimRay(maxDist = 7): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    this.camera.getWorldDirection(_dir);
    const origin = _pivot.copy(this.camera.position).addScaledVector(_dir, this.curDist * 0.6);
    const hit = this.physics.raycast(origin, _dir, maxDist, GROUPS.queryGround, this.cat.collider);
    return hit ? { point: hit.point, normal: hit.normal } : null;
  }
}
