import * as THREE from 'three';
import { Physics } from './Physics';
import { Input } from './Input';
import { Renderer } from './Renderer';
import { settings } from './Settings';
import { bus } from './Events';
import { assets } from './Assets';
import { buildWorld, finalizeWorld } from '../world/World';
import type { WorldCtx } from '../world/Ctx';
import { Lighting } from '../world/Lighting';
import { Dust } from '../world/Dust';
import { updateHinge } from '../world/Room';
import { CatController } from '../cat/CatController';
import { CatCamera } from '../cat/CatCamera';
import { Tiger } from '../cat/Tiger';

export type GameState = 'loading' | 'menu' | 'intro' | 'playing' | 'paused' | 'finale';

/** Hlavní třída hry: inicializace, smyčka s pevným krokem, stavy. */
export class Game {
  readonly scene = new THREE.Scene();
  readonly physics = new Physics();
  readonly input: Input;
  readonly gfx: Renderer;
  ctx!: WorldCtx;
  lighting!: Lighting;
  dust!: Dust;
  cat!: CatController;
  tiger!: Tiger;
  camera!: CatCamera;
  state: GameState = 'loading';
  /** Čas hry v sekundách (jen při hraní). */
  playTime = 0;
  time = 0;
  frame = 0;
  fps = 0;
  ready = false;
  /** Callbacky pro další systémy (hádanky, UI, zvuk). */
  readonly fixedHooks: Array<(dt: number) => void> = [];
  readonly frameHooks: Array<(dt: number, alpha: number) => void> = [];
  onLoadProgress: ((label: string, f: number) => void) | null = null;
  private last = 0;
  private acc = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private running = false;
  /** Když je true, smyčka nerenderuje (testy řídí kroky ručně). */
  manualStepping = false;
  readonly errors: string[] = [];
  /** Hustota „vzduchu“ pro volumetrické paprsky. */
  volumetricDensity = 0.018;

  constructor(canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
    this.gfx = new Renderer(canvas, this.scene);
    window.addEventListener('error', (e) => this.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(String(e.reason)));
  }

  async init(): Promise<void> {
    const progress = (label: string, f: number) => this.onLoadProgress?.(label, f);
    progress('Fyzika…', 0.02);
    await this.physics.init();
    progress('Místnost…', 0.08);
    assets.onProgress = (done, total) => progress('Assety…', 0.08 + 0.42 * (done / Math.max(total, 1)));
    this.ctx = await buildWorld(this.scene, this.physics);
    finalizeWorld(this.ctx);
    this.lighting = new Lighting(this.ctx, this.gfx.renderer);
    await this.lighting.load();
    this.dust = new Dust();
    this.scene.add(this.dust.points);
    this.lighting.hideOnBake.push(this.dust.points);

    progress('Tiger…', 0.55);
    this.cat = new CatController(this.physics, this.input);
    this.tiger = new Tiger(this.cat, this.physics);
    await this.tiger.load();
    this.scene.add(this.tiger.root);
    this.lighting.hideOnBake.push(this.tiger.root);
    this.camera = new CatCamera(this.gfx.camera, this.physics, this.input, this.cat);
    this.cat.teleport(new THREE.Vector3(-0.6, 0.02, -0.75), Math.PI * 0.75);
    this.tiger.snap();
    this.camera.resetBehind();
    assets.onProgress = null;

    // fyzika se musí jednou „usadit“, než se zapeče světlo
    for (let i = 0; i < 30; i++) this.fixedUpdate(this.physics.fixedDt);

    progress('Světlo…', 0.6);
    this.gfx.setExposure(this.lighting.state.exposure);
    // první snímek zkompiluje shadery a vyrenderuje stíny
    this.gfx.render(0);
    await this.lighting.bakeAll((f) => progress('Světlo…', 0.6 + 0.38 * f));
    progress('Hotovo', 1);
    this.ready = true;
    bus.on('settingsChanged', ({ key }) => {
      if (key === 'fov') this.gfx.setFov(settings.data.fov);
      if (key === 'fur') this.tiger.fur.setEnabled(settings.data.fur);
    });
  }

  setState(s: GameState): void {
    if (this.state === s) return;
    this.state = s;
    this.input.gameplayEnabled = s === 'playing';
    bus.emit('stateChanged', { state: s });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      if (this.manualStepping) return;
      this.tick(dt);
    };
    requestAnimationFrame(loop);
  }

  /** Jeden snímek: pevné kroky + vykreslení. */
  tick(dt: number, render = true): void {
    this.time += dt;
    this.frame++;
    this.input.update(dt);
    const simulate = this.state === 'playing' || this.state === 'intro' || this.state === 'finale' || this.state === 'menu';
    let steps = 0;
    if (simulate) {
      this.acc += dt;
      const fdt = this.physics.fixedDt;
      while (this.acc >= fdt && steps < 5) {
        this.fixedUpdate(fdt);
        this.acc -= fdt;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }
    const alpha = simulate ? this.acc / this.physics.fixedDt : 1;
    this.update(dt, alpha);
    if (render) this.gfx.render(dt);
    if (steps > 0 || !simulate) this.input.endFrame();
    // FPS
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  fixedUpdate(dt: number): void {
    if (this.state === 'playing') this.playTime += dt;
    // míření skoku: kam se dívá kamera
    if (this.cat.aiming || this.input.isHeld('jump')) {
      const aim = this.camera.aimRay();
      this.cat.aimPoint = aim ? aim.point : null;
      this.cat.aimNormal = aim ? aim.normal : null;
    }
    this.cat.fixedUpdate(dt);
    for (const h of this.fixedHooks) h(dt);
    const refs = this.ctx.refs;
    if (refs.balconyDoor) updateHinge(refs.balconyDoor, dt, -1);
    if (refs.treatDoor) updateHinge(refs.treatDoor, dt, -1);
    this.physics.step();
  }

  private update(dt: number, alpha: number): void {
    this.lighting.update(dt);
    if (this.ready) this.lighting.bakeStep(settings.data.quality === 'ultra' ? 40 : 24);
    this.tiger.update(dt, alpha);
    this.camera.update(dt);
    for (const h of this.frameHooks) h(dt, alpha);
    const L = this.lighting;
    this.gfx.setExposure(L.state.exposure);
    this.gfx.setVolumetric(L.sun, L.toSun, this.volumetricDensity);
    const wb = L.whiteBalance;
    this.gfx.setWhiteBalance(wb.x, wb.y, wb.z);
    this.dust.update(dt, L.toSun, L.sun, this.gfx.size.y, this.gfx.camera.fov);
  }

  /** Synchronní simulace bez vykreslování (automatické testy). */
  simulate(seconds: number): void {
    const fdt = this.physics.fixedDt;
    const n = Math.round(seconds / fdt);
    for (let i = 0; i < n; i++) {
      this.input.update(fdt);
      this.fixedUpdate(fdt);
      this.time += fdt;
      for (const h of this.frameHooks) h(fdt, 1);
      this.lighting.update(fdt);
      this.tiger.update(fdt, 1);
      this.input.endFrame();
    }
  }
}
