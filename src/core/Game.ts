import * as THREE from 'three';
import { Physics } from './Physics';
import { Input, type Action } from './Input';
import { Renderer } from './Renderer';
import { settings } from './Settings';
import { bus } from './Events';
import { assets } from './Assets';
import { audio } from './Audio';
import { Save } from './Save';
import { Flow } from './Flow';
import { buildWorld, finalizeWorld } from '../world/World';
import { buildProps } from '../world/Props';
import type { WorldCtx } from '../world/Ctx';
import { Lighting } from '../world/Lighting';
import { Dust } from '../world/Dust';
import { updateHinge } from '../world/Room';
import { CatController } from '../cat/CatController';
import { CatCamera } from '../cat/CatCamera';
import { Tiger } from '../cat/Tiger';
import { Senses } from '../cat/Senses';
import { UI } from '../ui/UI';
import { Journal } from '../puzzles/Journal';
import { Interactions } from '../puzzles/Interact';
import { PuzzleGraph } from '../puzzles/PuzzleGraph';
import type { PuzzleCtx, GameStats } from '../puzzles/PuzzleCtx';
import { livingRoomSteps } from '../puzzles/rooms/livingRoom';
import { setKittenPhoto } from '../puzzles/steps/05_photo';

const _furC = new THREE.Vector3();

export type GameState = 'loading' | 'menu' | 'intro' | 'playing' | 'paused' | 'finale';
export type ModalEvent = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

/** Hlavní třída hry: inicializace, smyčka s pevným krokem, stavy, propojení systémů. */
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
  ui!: UI;
  readonly journal = new Journal();
  interact!: Interactions;
  senses!: Senses;
  graph!: PuzzleGraph;
  flow!: Flow;
  pc!: PuzzleCtx;
  readonly stats: GameStats = { hints: 0, wrongCodes: 0, golden: false };
  readonly flags: Record<string, boolean | number> = {};
  state: GameState = 'loading';
  /** Čas hraní v sekundách (jen při hraní). */
  playTime = 0;
  time = 0;
  frame = 0;
  fps = 0;
  ready = false;
  /** Když je nastaven, směrové klávesy a potvrzení jdou sem (kódový zámek). */
  modalHandler: ((ev: ModalEvent) => void) | null = null;
  /** Hustota „vzduchu“ pro volumetrické paprsky. */
  volumetricDensity = 0.014;
  /** Když je true, smyčka nerenderuje (testy řídí kroky ručně). */
  manualStepping = false;
  readonly errors: string[] = [];
  onLoadProgress: ((label: string, f: number) => void) | null = null;
  private last = 0;
  private acc = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private running = false;
  private timers: Array<{ t: number; fn: () => void }> = [];
  private prevDir = { x: 0, y: 0 };
  private readonly camFwd = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, private uiRoot: HTMLElement) {
    this.input = new Input(canvas);
    this.gfx = new Renderer(canvas, this.scene);
    window.addEventListener('error', (e) => this.errors.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(String(e.reason)));
    this.input.onAction((a) => this.onAction(a));
  }

  async init(): Promise<void> {
    const progress = (label: string, f: number) => this.onLoadProgress?.(label, f);
    progress('Fyzika…', 0.02);
    await this.physics.init();
    progress('Místnost…', 0.08);
    assets.onProgress = (done, total) => progress('Assety…', 0.08 + 0.42 * (done / Math.max(total, 1)));
    this.ctx = await buildWorld(this.scene, this.physics);
    await buildProps(this.ctx);
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
    if (this.ctx.refs.dynamicGroup) this.lighting.hideOnBake.push(this.ctx.refs.dynamicGroup);
    this.camera = new CatCamera(this.gfx.camera, this.physics, this.input, this.cat);
    assets.onProgress = null;

    // --- UI, hádanky, smysly
    this.flow = new Flow(this);
    this.ui = new UI(this.uiRoot, this.journal, {
      newGame: () => this.flow.newGame(),
      continueGame: () => this.flow.continueGame(),
      resume: () => this.flow.resume(),
      toMenu: () => this.flow.toMenu(),
      hasSave: () => Save.has(),
      sound: (name) => audio.play(name, { volume: 0.7 }),
    });
    this.interact = new Interactions(this, this.ui);
    this.senses = new Senses(this);
    this.graph = new PuzzleGraph(livingRoomSteps);
    this.pc = {
      game: this,
      world: this.ctx,
      refs: this.ctx.refs,
      cat: this.cat,
      tiger: this.tiger,
      senses: this.senses,
      ui: this.ui,
      journal: this.journal,
      interact: this.interact,
      graph: this.graph,
      stats: this.stats,
      flags: this.flags,
      say: (text, duration) => this.ui.say(text, duration),
      sfx: (name, pos, volume, pitch) => audio.play(name, { pos, volume, pitch }),
      discover: (id, after) => this.flow.openReader(id, after),
      later: (seconds, fn) => this.later(seconds, fn),
    };
    this.graph.init(this.pc);
    this.hookAudio();

    // fyzika se musí jednou „usadit“, než se zapeče světlo
    this.cat.teleport(new THREE.Vector3(-0.9, 0.02, -0.45), -Math.PI / 2);
    this.tiger.snap();
    for (let i = 0; i < 40; i++) {
      this.cat.fixedUpdate(this.physics.fixedDt);
      this.physics.step();
    }

    progress('Světlo…', 0.6);
    this.gfx.setExposure(this.lighting.state.exposure);
    // první snímek zkompiluje shadery a vyrenderuje stíny
    this.tiger.update(0.016, 1);
    this.gfx.render(0);
    await this.lighting.bakeAll((f) => progress('Světlo…', 0.6 + 0.36 * f));
    progress('Vzpomínky…', 0.97);
    this.snapshotKitten();
    progress('Hotovo', 1);
    this.ready = true;
    bus.on('settingsChanged', ({ key }) => {
      if (key === 'fov') this.gfx.setFov(settings.data.fov);
      if (key === 'fur') this.tiger.fur.setEnabled(settings.data.fur);
    });

    // --- start: menu, nebo rovnou hra (?autostart=new|continue, ?test=1)
    const q = new URLSearchParams(location.search);
    const auto = q.get('autostart');
    if (q.has('test')) this.flow.startDirect();
    else if (auto === 'continue' && Save.has()) this.flow.continueGame();
    else if (auto === 'new') this.flow.newGame();
    else this.flow.showMenu();
  }

  /** Zvuky navázané na pohyb Tigera. */
  private hookAudio(): void {
    const c = this.cat;
    c.events.onStep = (surface, speed) => {
      audio.play('step', { pos: c.position, surface, volume: 0.35 + Math.min(1, speed / 4) * 0.8, pitch: 0.9 + Math.random() * 0.25 });
    };
    c.events.onLand = (impact, surface) => {
      audio.play('land', { pos: c.position, volume: Math.min(1.3, 0.25 + impact * 0.2) });
      audio.play('step', { pos: c.position, surface, volume: 1 });
      if (impact > 3.5) this.camera.addShake(Math.min(0.02, impact * 0.003));
    };
    c.events.onJump = () => audio.play('jump', { pos: c.position, volume: 0.8 });
  }

  /** „Fotka koťátka“: momentka zmenšeného Tigera sedícího na gauči, vyrenderovaná ze scény. */
  private snapshotKitten(): void {
    try {
      const sofa = this.ctx.refs.sofa;
      const W = 512;
      const H = 400;
      const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: true });
      this.cat.teleport(new THREE.Vector3(sofa.cx + 0.1, sofa.seatY + 0.01, sofa.cz + 0.1), 0.35);
      this.cat.mode = 'scripted';
      this.tiger.anim.action = 'sit';
      this.tiger.snap();
      for (let i = 0; i < 90; i++) this.tiger.update(1 / 60, 1);
      this.tiger.root.scale.setScalar(0.62);
      const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
      const p = this.cat.position;
      cam.position.set(p.x + 0.22, p.y + 0.2, p.z + 0.62);
      cam.lookAt(p.x, p.y + 0.11, p.z);
      this.scene.updateMatrixWorld(true);
      const r = this.gfx.renderer;
      const prev = r.getRenderTarget();
      r.shadowMap.needsUpdate = true;
      r.setRenderTarget(rt);
      r.clear();
      r.render(this.scene, cam);
      const buf = new Float32Array(W * H * 4);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      r.setRenderTarget(prev);
      rt.dispose();
      this.tiger.root.scale.setScalar(1);
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const g2 = canvas.getContext('2d')!;
      const img = g2.createImageData(W, H);
      const exposure = this.lighting.state.exposure * 0.85;
      let sum = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const s = ((H - 1 - y) * W + x) * 4;
          const d = (y * W + x) * 4;
          for (let c = 0; c < 3; c++) {
            const v = buf[s + c] * exposure;
            const tm = v / (1 + v); // jednoduchý tone mapping
            const out = Math.pow(Math.max(0, tm), 1 / 2.2) * 255 * (c === 2 ? 0.92 : 1.04);
            img.data[d + c] = out;
            sum += out;
          }
          img.data[d + 3] = 255;
        }
      }
      // prázdný snímek (např. chybějící float buffer) → ponechat kreslenou náhradu
      if (sum / (W * H * 3) > 12) {
        g2.putImageData(img, 0, 0);
        // lehká viněta a datumovka jako ze staré fotky
        const vg = g2.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(40,20,0,0.35)');
        g2.fillStyle = vg;
        g2.fillRect(0, 0, W, H);
        setKittenPhoto(this.pc, canvas);
      }
    } catch (e) {
      console.info('Momentku Tigera se nepodařilo pořídit, použije se kreslená fotka.', e);
      this.tiger.root.scale.setScalar(1);
    }
    this.tiger.anim.action = 'none';
  }

  setState(s: GameState): void {
    if (this.state === s) return;
    this.state = s;
    this.input.gameplayEnabled = s === 'playing';
    bus.emit('stateChanged', { state: s });
  }

  /** Spustí funkci za `seconds` herního času. */
  later(seconds: number, fn: () => void): void {
    this.timers.push({ t: seconds, fn });
  }

  /** Jednorázové stisky (i mimo gameplay). */
  private onAction(a: Action): void {
    audio.unlock();
    if (!this.ready) return;
    if (this.ui.modal !== 'none') {
      this.ui.handleAction(a);
      return;
    }
    if (this.state === 'intro') {
      if (a === 'confirm' || a === 'pause' || a === 'jump') this.flow.skipIntro();
      return;
    }
    if (this.state !== 'playing') return;
    if (this.modalHandler) {
      if (a === 'paw' || a === 'confirm') this.modalHandler('confirm');
      else if (a === 'pause' || a === 'back') this.modalHandler('back');
      return;
    }
    if (a === 'pause') this.flow.pause();
    else if (a === 'journal') this.flow.openJournal();
    else if (a === 'hint') this.flow.hint();
  }

  /** Hrany směrových kláves: menu a kódový zámek. */
  private handleDirections(): void {
    const d = this.input.rawDir;
    const ex = d.x !== this.prevDir.x ? d.x : 0;
    const ey = d.y !== this.prevDir.y ? d.y : 0;
    this.prevDir.x = d.x;
    this.prevDir.y = d.y;
    if (this.ui.modal !== 'none') {
      if (ey !== 0) this.ui.navigate(-ey);
      return;
    }
    if (this.modalHandler && this.state === 'playing') {
      if (ex > 0) this.modalHandler('right');
      else if (ex < 0) this.modalHandler('left');
      if (ey > 0) this.modalHandler('up');
      else if (ey < 0) this.modalHandler('down');
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    const loop = (t: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      // časová značka rAF může být (hlavně při pomalých snímcích) starší než minulý snímek
      const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
      this.last = Math.max(this.last, t);
      if (this.manualStepping) return;
      this.tick(dt);
    };
    requestAnimationFrame(loop);
  }

  /** Běží simulace? (v pauze a při čtení stojí) */
  private get simulating(): boolean {
    return this.state === 'playing' || this.state === 'intro' || this.state === 'finale' || this.state === 'menu';
  }

  /** Jeden snímek: pevné kroky + vykreslení. */
  tick(dt: number, render = true): void {
    this.time += dt;
    this.frame++;
    this.input.update(dt);
    this.handleDirections();
    let steps = 0;
    if (this.simulating) {
      this.acc += dt;
      const fdt = this.physics.fixedDt;
      while (this.acc >= fdt && steps < 5) {
        this.fixedUpdate(fdt);
        this.acc -= fdt;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }
    const alpha = this.simulating ? this.acc / this.physics.fixedDt : 1;
    this.update(dt, alpha);
    if (render) this.gfx.render(dt);
    if (steps > 0 || !this.simulating) this.input.endFrame();
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
    // časovače
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    // míření skoku: kam se dívá kamera
    if (this.cat.aiming || this.input.isHeld('jump')) {
      const aim = this.camera.aimRay();
      this.cat.aimPoint = aim ? aim.point : null;
      this.cat.aimNormal = aim ? aim.normal : null;
    }
    this.cat.fixedUpdate(dt);
    if (this.state === 'playing') {
      this.interact.update();
      this.graph.update(dt);
    } else if (this.state === 'finale' || this.state === 'intro' || this.state === 'menu') {
      // houpání svítidla, police apod. běží i mimo hraní
      this.graph.update(dt);
      this.ui.setPrompt(null);
    }
    const refs = this.ctx.refs;
    if (refs.balconyDoor) updateHinge(refs.balconyDoor, dt, -1);
    if (refs.treatDoor) updateHinge(refs.treatDoor, dt, -1);
    this.physics.step();
  }

  private update(dt: number, alpha: number): void {
    const L = this.lighting;
    L.update(dt);
    if (this.ready) L.bakeStep(settings.data.quality === 'ultra' ? 40 : 24);
    if (this.simulating) this.tiger.update(dt, alpha);
    this.flow.update(dt);
    this.camera.update(dt);
    this.senses.update(dt);
    this.ui.update(dt);
    this.ui.setSenses(this.senses.amount);
    // tapetum lucidum: ve tmě oči svítí, nejvíc v nočním vidění
    this.tiger.fur.setTapetum(Math.min(1, this.senses.nightVision * 0.9 + L.darkness * 0.35));
    _furC.copy(this.cat.position);
    _furC.y += 0.2;
    // ve filmových záběrech (intro, detaily, finále) vždy plná srst; LOD je jen pro kameru přitlačenou ke kočce
    this.tiger.fur.setViewDistance(this.camera.inShot ? 10 : this.gfx.camera.position.distanceTo(_furC));
    this.gfx.setExposure(L.state.exposure * L.exposureScale * (1 + this.senses.nightVision * 0.6));
    this.gfx.setVolumetric(L.sun, L.toSun, this.volumetricDensity);
    const wb = L.whiteBalance;
    this.gfx.setWhiteBalance(wb.x, wb.y, wb.z);
    this.dust.update(dt, L.toSun, L.sun, this.gfx.size.y, this.gfx.camera.fov);
    this.gfx.camera.getWorldDirection(this.camFwd);
    audio.setListener(this.gfx.camera.position, this.camFwd);
  }

  /** Synchronní simulace bez vykreslování (automatické testy). */
  simulate(seconds: number): void {
    const fdt = this.physics.fixedDt;
    const n = Math.round(seconds / fdt);
    for (let i = 0; i < n; i++) {
      this.time += fdt;
      this.input.update(fdt);
      this.handleDirections();
      if (this.simulating) {
        this.fixedUpdate(fdt);
        this.tiger.update(fdt, 1);
      }
      this.lighting.update(fdt);
      this.flow.update(fdt);
      this.camera.update(fdt);
      this.senses.update(fdt);
      this.ui.update(fdt);
      this.input.endFrame();
    }
  }
}
