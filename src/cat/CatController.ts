import * as THREE from 'three';
import { Physics, RAPIER, GROUPS, type Surface } from '../core/Physics';
import type { Input } from '../core/Input';
import { JUMP } from '../world/Layout';

/**
 * Kinematický controller Tigera.
 *
 * - Pohyb po zemi relativně ke kameře (chůze / klus / sprint / plížení), auto-step, přichycení k zemi.
 * - Skok: krátký stisk = skok vpřed s kočičí asistencí (sám si najde hranu před sebou),
 *   podržení = mířený skok s obloukem a značkou dopadu.
 * - Let je přesná balistika s kolizemi, dopad se hlásí animátoru.
 * - Unášení pohyblivými plošinami (vysavač, houpající se svítidlo, naklápěcí police).
 */

export type CatMode = 'ground' | 'air' | 'scripted';

export interface JumpArc {
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  time: number;
  target: THREE.Vector3;
  valid: boolean;
  /** Body oblouku pro vykreslení. */
  points: THREE.Vector3[];
}

export interface CatEvents {
  onJump?: (arc: JumpArc | null, power: number) => void;
  onLand?: (impact: number, surface: Surface) => void;
  onStep?: (surface: Surface, speed: number) => void;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export const CAT = {
  radius: 0.095,
  standHalf: 0.045, // výška kapsle 0,28 m
  crouchRadius: 0.07,
  crouchHalf: 0.004, // výška ~0,148 m
  walkSpeed: 1.0,
  trotSpeed: 2.0,
  sprintSpeed: 4.2,
  sneakSpeed: 0.55,
  bodyAhead: 0.24, // jak daleko před středem je čenich
};

export class CatController {
  /** Poloha tlapek (střed těla na zemi). */
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Směr pohledu těla (rad, 0 = +Z). */
  yaw = 0;
  mode: CatMode = 'ground';
  grounded = true;
  crouching = false;
  sprinting = false;
  /** Míří skok (drží mezerník). */
  aiming = false;
  aimArc: JumpArc | null = null;
  /** Horizontální rychlost vůči podložce (pro animaci). */
  speed = 0;
  /** Požadovaný směr pohybu (jednotkový, nebo nula). */
  readonly wishDir = new THREE.Vector3();
  turnRate = 0;
  surface: Surface = 'wood';
  groundCollider: RAPIER.Collider | null = null;
  groundTag: string | undefined;
  /** Doba ve vzduchu / od dopadu (pro animace). */
  airTime = 0;
  sinceLand = 10;
  lastImpact = 0;
  /** Zamrazení vstupů (cutscény, urážení…). */
  inputLocked = false;
  /** Jak moc je čenich zatlačen překážkou (m) – animátor posune tělo dozadu. */
  noseBlock = 0;
  /** Rychlost plošiny pod tlapkami. */
  readonly platformVelocity = new THREE.Vector3();
  events: CatEvents = {};
  /** Směr kamery (yaw) pro pohyb relativní ke kameře. */
  cameraYaw = 0;
  /** Bod, kam míří střed obrazovky (nastavuje kamera při míření). */
  aimPoint: THREE.Vector3 | null = null;
  aimNormal: THREE.Vector3 | null = null;

  readonly collider: RAPIER.Collider;
  private body: RAPIER.RigidBody;
  private kcc: RAPIER.KinematicCharacterController;
  private standShape: RAPIER.Capsule;
  private crouchShape: RAPIER.Capsule;
  private usingCrouchShape = false;
  private jumpHeld = 0;
  private jumpBuffered = false;
  private coyote = 0;
  private stepDist = 0;
  private flightArc: JumpArc | null = null;
  private platformBody: RAPIER.RigidBody | null = null;
  private platformPrevPos = new THREE.Vector3();
  private platformPrevRot = new THREE.Quaternion();
  private slideOff = new THREE.Vector3();
  private probeBall = new RAPIER.Ball(0.07);
  private arcBall = new RAPIER.Ball(0.08);

  constructor(private physics: Physics, private input: Input) {
    const w = physics.world;
    this.standShape = new RAPIER.Capsule(CAT.standHalf, CAT.radius);
    this.crouchShape = new RAPIER.Capsule(CAT.crouchHalf, CAT.crouchRadius);
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(CAT.standHalf, CAT.radius).setCollisionGroups(GROUPS.cat).setFriction(0),
      this.body,
    );
    this.kcc = w.createCharacterController(0.012);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.07, 0.04, false);
    this.kcc.enableSnapToGround(0.07);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(4.5);
    this.kcc.setSlideEnabled(true);
  }

  private get halfHeight(): number {
    return this.usingCrouchShape ? CAT.crouchHalf + CAT.crouchRadius : CAT.standHalf + CAT.radius;
  }

  /** Výška těla (pro kameru a animace). */
  get bodyHeight(): number {
    return this.halfHeight * 2;
  }

  teleport(pos: THREE.Vector3, yaw?: number): void {
    this.position.copy(pos);
    this.prevPosition.copy(pos);
    if (yaw !== undefined) this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.mode = 'ground';
    this.flightArc = null;
    this.aiming = false;
    this.aimArc = null;
    this.platformBody = null;
    this.syncBody(true);
  }

  private syncBody(immediate = false): void {
    const p = { x: this.position.x, y: this.position.y + this.halfHeight + 0.004, z: this.position.z };
    if (immediate) this.body.setTranslation(p, true);
    else this.body.setNextKinematicTranslation(p);
  }

  private setCrouchShape(on: boolean): void {
    if (on === this.usingCrouchShape) return;
    if (!on) {
      // vstát jde jen tam, kde je místo
      _a.set(this.position.x, this.position.y + CAT.standHalf + CAT.radius + 0.01, this.position.z);
      if (this.physics.overlaps(this.standShape, _a, undefined, GROUPS.queryGround, this.collider)) return;
    }
    this.usingCrouchShape = on;
    this.collider.setShape(on ? this.crouchShape : this.standShape);
    this.syncBody(true);
  }

  /** Je nad kočkou nízký strop? (pro kameru) */
  ceilingAbove(max = 0.6): number {
    _a.set(this.position.x, this.position.y + 0.1, this.position.z);
    const hit = this.physics.raycast(_a, UP, max, GROUPS.queryStatic, this.collider);
    return hit ? hit.distance + 0.1 : Infinity;
  }

  // ------------------------------------------------------------------ hlavní krok
  fixedUpdate(dt: number): void {
    this.prevPosition.copy(this.position);
    if (this.mode === 'scripted') {
      this.velocity.set(0, 0, 0);
      this.speed = 0;
      this.syncBody();
      return;
    }
    const inp = this.input;
    const locked = this.inputLocked;

    // --- vstup → požadovaný směr (relativně ke kameře)
    const mx = locked ? 0 : inp.move.x;
    const my = locked ? 0 : inp.move.y;
    const mag = Math.min(1, Math.hypot(mx, my));
    if (mag > 0.05) {
      const sin = Math.sin(this.cameraYaw);
      const cos = Math.cos(this.cameraYaw);
      // kamera se dívá ve směru (sin, cos) → dopředu = tento směr
      this.wishDir.set(sin * my + cos * -mx, 0, cos * my - sin * -mx).normalize();
    } else {
      this.wishDir.set(0, 0, 0);
    }

    const wantCrouch = !locked && inp.isHeld('crouch');
    this.setCrouchShape(wantCrouch); // vstát jde jen tam, kde je místo
    this.crouching = this.usingCrouchShape;
    this.sprinting = !locked && inp.isHeld('sprint') && !this.crouching && mag > 0.3;

    this.carryByPlatform();

    if (this.mode === 'ground') this.updateGround(dt, mag, locked);
    else this.updateAir(dt);

    // --- čenich před překážkou
    this.updateNoseProbe();
    this.syncBody();
    this.sinceLand += dt;
  }

  private updateGround(dt: number, mag: number, locked: boolean): void {
    const inp = this.input;
    // --- míření skoku
    if (!locked && inp.wasPressed('jump') && (this.grounded || this.coyote > 0)) {
      this.jumpHeld = 0.0001;
      this.jumpBuffered = true;
    }
    if (this.jumpBuffered) {
      if (inp.isHeld('jump') && !locked) {
        this.jumpHeld += dt;
        if (this.jumpHeld > 0.2 && !this.crouching) {
          this.aiming = true;
          this.aimArc = this.computeAimArc();
        }
      } else {
        // puštěno
        const wasAiming = this.aiming;
        const arc = wasAiming ? this.aimArc : this.computeAssistHop();
        this.aiming = false;
        this.aimArc = null;
        this.jumpBuffered = false;
        this.jumpHeld = 0;
        if (!this.usingCrouchShape || this.ceilingAbove(0.5) > 0.45) {
          this.launch(arc);
          return;
        }
      }
    }

    // --- rychlost
    let target = 0;
    if (mag > 0.05 && !this.aiming) {
      if (this.crouching) target = CAT.sneakSpeed * Math.max(0.6, mag);
      else if (this.sprinting) target = CAT.sprintSpeed;
      else target = mag < 0.6 ? CAT.walkSpeed * (mag / 0.6) + 0.15 : CAT.walkSpeed + (CAT.trotSpeed - CAT.walkSpeed) * ((mag - 0.6) / 0.4);
    }
    // otáčení těla ke směru pohybu
    let wantYaw = this.yaw;
    if (this.aiming && this.aimArc) {
      const d = _a.subVectors(this.aimArc.target, this.position);
      if (d.x * d.x + d.z * d.z > 0.01) wantYaw = Math.atan2(d.x, d.z);
    } else if (mag > 0.05) {
      wantYaw = Math.atan2(this.wishDir.x, this.wishDir.z);
    }
    let dy = wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const maxTurn = (this.speed > 2.8 ? 5.5 : 9.5) * dt;
    const turn = THREE.MathUtils.clamp(dy, -maxTurn, maxTurn);
    this.yaw += turn;
    this.turnRate = THREE.MathUtils.lerp(this.turnRate, turn / dt, 1 - Math.exp(-dt * 12));
    // při velké odchylce nejdřív zatočit, pak zrychlit
    const align = Math.max(0, Math.cos(dy));
    target *= 0.25 + 0.75 * align * align;

    const fwd = _b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const cur = this.velocity.x * fwd.x + this.velocity.z * fwd.z;
    const accel = target > cur ? (this.sprinting ? 9 : 7) : 12;
    const next = cur + THREE.MathUtils.clamp(target - cur, -accel * dt, accel * dt);
    this.velocity.x = fwd.x * next;
    this.velocity.z = fwd.z * next;
    this.velocity.y = -1.5; // přítlak k zemi (snap)

    // sklouznutí z ploch, na kterých se nedá stát
    if (this.slideOff.lengthSq() > 0) {
      this.velocity.x += this.slideOff.x;
      this.velocity.z += this.slideOff.z;
    }

    this.move(dt);
    this.speed = Math.hypot(this.position.x - this.prevPosition.x - this.platformVelocity.x * dt, this.position.z - this.prevPosition.z - this.platformVelocity.z * dt) / dt;

    if (!this.grounded) {
      this.coyote -= dt;
      if (this.coyote <= 0) {
        // spadl z hrany
        this.mode = 'air';
        this.airTime = 0;
        this.velocity.y = 0;
        this.velocity.x += this.platformVelocity.x;
        this.velocity.z += this.platformVelocity.z;
        this.flightArc = null;
        this.aiming = false;
        this.aimArc = null;
        this.jumpBuffered = false;
      }
    } else {
      this.coyote = 0.1;
      // kroky (zvuk)
      this.stepDist += this.speed * dt;
      const stride = this.speed > 3 ? 0.55 : this.speed > 1.3 ? 0.3 : 0.2;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.events.onStep?.(this.surface, this.speed);
      }
    }
  }

  private updateAir(dt: number): void {
    this.airTime += dt;
    const g = JUMP.gravity;
    // přesná balistika: Δp = v·dt − ½·g·dt²
    const vy0 = this.velocity.y;
    this.velocity.y -= g * dt;
    // mírné řízení ve vzduchu (jen u volného pádu / skoku bez cíle)
    if (!this.flightArc && this.wishDir.lengthSq() > 0) {
      this.velocity.x += this.wishDir.x * 2.2 * dt;
      this.velocity.z += this.wishDir.z * 2.2 * dt;
    }
    const delta = _a.set(this.velocity.x * dt, vy0 * dt - 0.5 * g * dt * dt, this.velocity.z * dt);
    const before = _c.copy(this.position);
    this.kcc.disableSnapToGround();
    this.kcc.computeColliderMovement(this.collider, delta, undefined, GROUPS.cat);
    this.kcc.enableSnapToGround(0.07);
    const m = this.kcc.computedMovement();
    this.position.x += m.x;
    this.position.y += m.y;
    this.position.z += m.z;
    const grounded = this.kcc.computedGrounded();
    // náraz do stěny: ztráta vodorovné rychlosti
    const hx = (this.position.x - before.x) / dt;
    const hz = (this.position.z - before.z) / dt;
    if (Math.abs(hx - this.velocity.x) > 0.5 || Math.abs(hz - this.velocity.z) > 0.5) {
      this.velocity.x = hx * 0.6;
      this.velocity.z = hz * 0.6;
      this.flightArc = null;
    }
    // náraz hlavou do stropu
    if (vy0 > 0 && m.y < delta.y * 0.5) this.velocity.y = Math.min(this.velocity.y, 0);
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.speed > 0.6) {
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += THREE.MathUtils.clamp(dy, -6 * dt, 6 * dt);
    }
    if (grounded && this.velocity.y <= 0.01 && this.airTime > 0.05) {
      this.land(Math.abs(this.velocity.y));
    }
    // záchrana při pádu mimo svět
    if (this.position.y < -5) this.teleport(new THREE.Vector3(-1, 0.02, -0.8), 0);
  }

  private land(impact: number): void {
    this.mode = 'ground';
    this.grounded = true;
    this.lastImpact = impact;
    this.sinceLand = 0;
    this.flightArc = null;
    this.refreshGround();
    // zachovat část dopředné rychlosti
    const keep = this.wishDir.lengthSq() > 0 ? 0.55 : 0.25;
    this.velocity.x = (this.velocity.x - this.platformVelocity.x) * keep;
    this.velocity.z = (this.velocity.z - this.platformVelocity.z) * keep;
    this.velocity.y = 0;
    this.events.onLand?.(impact, this.surface);
  }

  private move(dt: number): void {
    const delta = _a.set(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    this.kcc.computeColliderMovement(this.collider, delta, undefined, GROUPS.cat);
    const m = this.kcc.computedMovement();
    this.position.x += m.x;
    this.position.y += m.y;
    this.position.z += m.z;
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded) this.refreshGround();
    else {
      this.groundCollider = null;
      this.slideOff.set(0, 0, 0);
    }
  }

  private refreshGround(): void {
    _a.set(this.position.x, this.position.y + 0.08, this.position.z);
    const hit = this.physics.raycast(_a, DOWN, 0.25, GROUPS.queryGround, this.collider);
    this.slideOff.set(0, 0, 0);
    if (!hit) {
      this.groundCollider = null;
      this.groundTag = undefined;
      return;
    }
    this.groundCollider = hit.collider;
    const info = hit.info;
    this.groundTag = info?.tag;
    if (info) this.surface = info.surface;
    if (info?.tag === 'noStand') {
      // odsunout od středu kolideru
      const t = hit.collider.translation();
      this.slideOff.set(this.position.x - t.x, 0, this.position.z - t.z);
      if (this.slideOff.lengthSq() < 1e-4) this.slideOff.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.slideOff.normalize().multiplyScalar(1.6);
    }
  }

  /** Unášení kinematickou plošinou (vysavač, svítidlo, police). */
  private carryByPlatform(): void {
    this.platformVelocity.set(0, 0, 0);
    const col = this.mode === 'ground' && this.grounded ? this.groundCollider : null;
    const body = col ? col.parent() : null;
    if (!body || !body.isKinematic() || body === this.body) {
      this.platformBody = null;
      return;
    }
    const t = body.translation();
    const r = body.rotation();
    if (this.platformBody === body) {
      // posun bodu pod tlapkami mezi minulým a současným krokem
      const local = _a.copy(this.position).sub(this.platformPrevPos).applyQuaternion(_q.copy(this.platformPrevRot).invert());
      const now = _b.copy(local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_c.set(t.x, t.y, t.z));
      const dx = now.x - this.position.x;
      const dy = now.y - this.position.y;
      const dz = now.z - this.position.z;
      if (dx * dx + dy * dy + dz * dz < 0.25) {
        this.position.x += dx;
        this.position.y += dy;
        this.position.z += dz;
        this.platformVelocity.set(dx, dy, dz).divideScalar(this.physics.fixedDt);
        // otočení plošiny otočí i kočku
        const yawDelta = yawOf(_q.set(r.x, r.y, r.z, r.w)) - yawOf(this.platformPrevRot);
        if (Math.abs(yawDelta) < 0.5) this.yaw += yawDelta;
        this.syncBody(true);
      }
    }
    this.platformBody = body;
    this.platformPrevPos.set(t.x, t.y, t.z);
    this.platformPrevRot.set(r.x, r.y, r.z, r.w);
  }

  private updateNoseProbe(): void {
    const fwd = _b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _a.set(this.position.x, this.position.y + (this.crouching ? 0.09 : 0.2), this.position.z);
    const reach = CAT.bodyAhead + 0.02;
    const t = this.physics.world.castShape(_a, { x: 0, y: 0, z: 0, w: 1 }, fwd, this.probeBall, 0, reach, true, undefined, GROUPS.queryStatic, this.collider);
    const block = t ? Math.max(0, reach - t.time_of_impact - 0.07) : 0;
    this.noseBlock += (block - this.noseBlock) * 0.25;
  }

  // ------------------------------------------------------------------ skoky

  private launch(arc: JumpArc | null): void {
    const fwd = _b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (arc && arc.valid) {
      this.velocity.copy(arc.velocity);
      this.yaw = Math.atan2(arc.velocity.x, arc.velocity.z) || this.yaw;
      this.flightArc = arc;
    } else if (arc) {
      // nedosažitelný cíl: skok plnou silou tím směrem (spadne dřív)
      this.velocity.copy(arc.velocity);
      this.flightArc = null;
    } else {
      // obyčejný skok vpřed
      const run = Math.min(this.speed, CAT.sprintSpeed);
      this.velocity.set(fwd.x * (1.5 + run * 0.6), 2.5 + run * 0.12, fwd.z * (1.5 + run * 0.6));
      this.flightArc = null;
    }
    this.velocity.x += this.platformVelocity.x;
    this.velocity.z += this.platformVelocity.z;
    this.velocity.y += Math.max(0, this.platformVelocity.y);
    this.mode = 'air';
    this.grounded = false;
    this.airTime = 0;
    this.platformBody = null;
    this.setCrouchShape(false);
    const power = Math.min(1, this.velocity.length() / JUMP.maxSpeed);
    this.events.onJump?.(arc, power);
  }

  /** Vynucený skok daným obloukem (debug API, automatický průchod). */
  jumpTo(target: THREE.Vector3): boolean {
    const arc = this.solveArc(this.position, target, true);
    if (!arc.valid) return false;
    this.launch(arc);
    return true;
  }

  /** Mířený skok: bod, kam míří střed obrazovky → přichycení k hraně → oblouk. */
  private computeAimArc(): JumpArc | null {
    let target: THREE.Vector3;
    if (this.aimPoint) {
      target = this.snapLanding(this.aimPoint, this.aimNormal);
    } else {
      target = _c.set(this.position.x + Math.sin(this.yaw) * 1.2, this.position.y, this.position.z + Math.cos(this.yaw) * 1.2).clone();
    }
    return this.solveArc(this.position, target, true);
  }

  /**
   * Kočičí asistence: z bodu, na který hráč míří, najde nejbližší použitelnou dopadovou plochu.
   * Pokud paprsek trefil svislou stěnu nábytku, hledá horní hranu nad ním a posune se kousek dovnitř.
   */
  snapLanding(point: THREE.Vector3, normal: THREE.Vector3 | null): THREE.Vector3 {
    const p = point.clone();
    if (normal && normal.y < 0.6) {
      // svislá plocha: vystoupat k horní hraně
      const inward = _a.set(-normal.x, 0, -normal.z).normalize();
      for (const inset of [0.13, 0.2, 0.08]) {
        const top = this.physics.groundHeight(point.x + inward.x * inset, point.y + 0.75, point.z + inward.z * inset, 0.75 + 0.02, GROUPS.queryGround, this.collider);
        if (top > -Infinity && top >= point.y - 0.02) {
          p.set(point.x + inward.x * inset, top, point.z + inward.z * inset);
          return this.settleOnSurface(p);
        }
      }
      // žádná hrana → dopad na zem pod bodem
      const fl = this.physics.groundHeight(point.x + normal.x * 0.15, point.y + 0.05, point.z + normal.z * 0.15, 4, GROUPS.queryGround, this.collider);
      if (fl > -Infinity) p.set(point.x + normal.x * 0.15, fl, point.z + normal.z * 0.15);
      return p;
    }
    return this.settleOnSurface(p);
  }

  /** Posune bod dopadu od okrajů plochy, aby se na ni tělo vešlo. */
  private settleOnSurface(p: THREE.Vector3): THREE.Vector3 {
    const r = 0.1;
    const y = p.y + 0.12;
    let sx = 0;
    let sz = 0;
    let missing = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ox = Math.cos(a) * r;
      const oz = Math.sin(a) * r;
      const h = this.physics.groundHeight(p.x + ox, y, p.z + oz, 0.2, GROUPS.queryGround, this.collider);
      if (h === -Infinity || Math.abs(h - p.y) > 0.05) {
        sx -= ox;
        sz -= oz;
        missing++;
      }
    }
    if (missing > 0 && missing < 8) {
      const l = Math.hypot(sx, sz) || 1;
      p.x += (sx / l) * 0.09;
      p.z += (sz / l) * 0.09;
    }
    return p;
  }

  /** Lze na bodě stát? (dost místa nad hlavou, plocha není „noStand“) */
  canStandAt(p: THREE.Vector3): boolean {
    _a.set(p.x, p.y + 0.1, p.z);
    const hit = this.physics.raycast(_a, DOWN, 0.2, GROUPS.queryGround, this.collider);
    if (!hit || hit.info?.tag === 'noStand') return false;
    _a.set(p.x, p.y + CAT.crouchHalf + CAT.crouchRadius + 0.03, p.z);
    return !this.physics.overlaps(this.crouchShape, _a, undefined, GROUPS.queryGround, this.collider);
  }

  /** Krátký stisk: skok vpřed; když je před kočkou hrana (gauč, stolek…), skočí na ni. */
  private computeAssistHop(): JumpArc | null {
    const fwd = _b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).clone();
    const origin = this.position;
    let best: JumpArc | null = null;
    let bestScore = -Infinity;
    const maxRise = (JUMP.maxSpeed * JUMP.maxSpeed) / (2 * JUMP.gravity);
    for (const dist of [0.45, 0.6, 0.8, 1.0, 1.25]) {
      const x = origin.x + fwd.x * dist;
      const z = origin.z + fwd.z * dist;
      const top = this.physics.groundHeight(x, origin.y + maxRise + 0.05, z, maxRise + 0.6, GROUPS.queryGround, this.collider);
      if (top === -Infinity) continue;
      const rise = top - origin.y;
      if (rise < 0.12 || rise > maxRise) continue; // jen výskoky na vyšší plochy
      const target = this.settleOnSurface(new THREE.Vector3(x, top, z));
      if (!this.canStandAt(target)) continue;
      const arc = this.solveArc(origin, target, true);
      if (!arc.valid) continue;
      const score = rise * 1.5 - dist * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = arc;
      }
    }
    return best;
  }

  /**
   * Balistický oblouk ze `start` do `target` s rychlostí ≤ maxSpeed.
   * Zkouší několik rychlostí a oba úhly, vybere první bezkolizní. `checkCollisions` = test průletu.
   */
  solveArc(start: THREE.Vector3, target: THREE.Vector3, checkCollisions: boolean, extraVel?: THREE.Vector3): JumpArc {
    const g = JUMP.gravity;
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    const d = Math.max(0.05, Math.hypot(dx, dz));
    const h = target.y - start.y;
    const dirX = dx / d;
    const dirZ = dz / d;
    const vmax = JUMP.maxSpeed;
    const vminSq = g * (h + Math.hypot(h, d));
    const result: JumpArc = { start: start.clone(), velocity: new THREE.Vector3(), time: 0, target: target.clone(), valid: false, points: [] };
    const ev = extraVel ?? this.platformVelocity;
    const candidates: Array<[number, number]> = []; // [vHoriz, vVert]
    if (vminSq <= vmax * vmax && vminSq > 0) {
      const vmin = Math.sqrt(vminSq);
      for (const f of [1.04, 1.12, 1.22, 1.35, 99]) {
        const v = Math.min(vmax, vmin * f);
        const v2 = v * v;
        const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        // nízký a vysoký úhel
        for (const sign of [-1, 1]) {
          const tan = (v2 + sign * sq) / (g * d);
          const cos = 1 / Math.sqrt(1 + tan * tan);
          const vh = v * cos;
          const vv = v * cos * tan;
          // vrchol musí převýšit cíl (dopad shora)
          const apex = (vv * vv) / (2 * g);
          if (h > 0.05 && apex < h + JUMP.clearance) continue;
          candidates.push([vh, vv]);
        }
        if (v >= vmax) break;
      }
    }
    for (const [vh, vv] of candidates) {
      const time = d / vh;
      const vel = new THREE.Vector3(dirX * vh, vv, dirZ * vh);
      const pts = this.sampleArc(start, vel, time, ev);
      if (!checkCollisions || this.arcIsClear(pts)) {
        result.velocity.copy(vel);
        result.time = time;
        result.valid = true;
        result.points = pts;
        return result;
      }
    }
    // nedosažitelné: ukázat oblouk plnou silou pod 50°
    const ang = THREE.MathUtils.degToRad(h > 0.3 ? 62 : 45);
    result.velocity.set(dirX * vmax * Math.cos(ang), vmax * Math.sin(ang), dirZ * vmax * Math.cos(ang));
    result.time = Math.min(1.2, d / (vmax * Math.cos(ang)));
    result.points = this.sampleArc(start, result.velocity, result.time, ev);
    // oříznout oblouk v místě prvního nárazu
    for (let i = 1; i < result.points.length; i++) {
      const a = result.points[i - 1];
      const b = result.points[i];
      const dir = _a.subVectors(b, a);
      const len = dir.length();
      if (len < 1e-5) continue;
      dir.divideScalar(len);
      const hit = this.physics.raycast(a, dir, len, GROUPS.queryGround, this.collider);
      if (hit && i > 1) {
        result.points.length = i;
        result.points.push(hit.point);
        break;
      }
    }
    result.target.copy(result.points[result.points.length - 1]);
    return result;
  }

  private sampleArc(start: THREE.Vector3, vel: THREE.Vector3, time: number, extra: THREE.Vector3): THREE.Vector3[] {
    const n = 22;
    const pts: THREE.Vector3[] = [];
    const g = JUMP.gravity;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * time;
      pts.push(new THREE.Vector3(
        start.x + (vel.x + extra.x) * t,
        start.y + (vel.y + Math.max(0, extra.y)) * t - 0.5 * g * t * t,
        start.z + (vel.z + extra.z) * t,
      ));
    }
    return pts;
  }

  private arcIsClear(pts: THREE.Vector3[]): boolean {
    // koule o poloměru 8 cm se středem 11 cm nad tlapkami
    const n = pts.length;
    for (let i = 1; i < n - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dir = _a.subVectors(b, a);
      const len = dir.length();
      if (len < 1e-5) continue;
      dir.divideScalar(len);
      _c.set(a.x, a.y + 0.11, a.z);
      // poslední úsek končí těsně nad cílem
      const maxLen = i >= n - 2 ? len - 0.04 : len;
      if (maxLen <= 0) continue;
      const hit = this.physics.world.castShape(_c, { x: 0, y: 0, z: 0, w: 1 }, dir, this.arcBall, 0, maxLen, true, undefined, GROUPS.queryGround, this.collider);
      if (hit) return false;
    }
    return true;
  }

  /** Aktuální oblouk letu (pro animaci natažení těla). */
  get flight(): JumpArc | null {
    return this.flightArc;
  }
}

const _q = new THREE.Quaternion();
function yawOf(q: THREE.Quaternion): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}
