import * as THREE from 'three';
import { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { settings } from '../core/Settings';
import { bus } from '../core/Events';
import type { WorldCtx } from './Ctx';
import { Sky } from './Sky';
import { ROOM, SUN_HEADING, KITCHEN, PENDANT } from './Layout';

/**
 * Osvětlení a západ slunce.
 *
 * Fáze 0–7 odpovídají počtu vyřešených kroků; `finale` (8) je modrá hodinka během titulků.
 * Každá fáze má výšku slunce, barevnou teplotu, intenzitu, prolnutí oblohy a stav lamp.
 * Přechod mezi fázemi je plynulý (několik sekund) a během něj se přepočítává GI.
 */

export interface PhaseDef {
  elev: number; // výška slunce ve stupních
  kelvin: number;
  sun: number; // intenzita přímého světla
  skyMix: number; // 0 západ, 1 růžový soumrak, 2 modrá hodinka
  skyExp: number;
  exposure: number; // expozice tone mappingu
  floorLamp: number;
  pendant: number;
  strip: number; // podsvícení linky
  city: number; // okna města
}

export const PHASES: PhaseDef[] = [
  { elev: 13.0, kelvin: 4500, sun: 6.8, skyMix: 0.0, skyExp: 1.55, exposure: 3.1, floorLamp: 0, pendant: 0, strip: 0, city: 0 },
  { elev: 11.8, kelvin: 4200, sun: 6.5, skyMix: 0.0, skyExp: 1.5, exposure: 3.1, floorLamp: 0, pendant: 0, strip: 0, city: 0 },
  { elev: 10.6, kelvin: 3850, sun: 6.1, skyMix: 0.05, skyExp: 1.45, exposure: 3.0, floorLamp: 0, pendant: 0, strip: 0, city: 0 },
  { elev: 9.4, kelvin: 3450, sun: 5.6, skyMix: 0.15, skyExp: 1.3, exposure: 2.85, floorLamp: 0.35, pendant: 0, strip: 0, city: 0.05 },
  { elev: 8.3, kelvin: 3000, sun: 4.9, skyMix: 0.3, skyExp: 1.1, exposure: 2.6, floorLamp: 0.6, pendant: 0, strip: 0.4, city: 0.15 },
  { elev: 7.3, kelvin: 2500, sun: 3.9, skyMix: 0.5, skyExp: 0.9, exposure: 2.35, floorLamp: 0.8, pendant: 0, strip: 0.7, city: 0.3 },
  { elev: 6.4, kelvin: 2150, sun: 2.7, skyMix: 0.75, skyExp: 0.58, exposure: 2.1, floorLamp: 1, pendant: 0.6, strip: 1, city: 0.5 },
  { elev: 5.6, kelvin: 1900, sun: 1.5, skyMix: 1.0, skyExp: 0.38, exposure: 1.9, floorLamp: 1, pendant: 1, strip: 1, city: 0.7 },
  // finále – slunce zapadne za střechy a přijde modrá hodinka (během závěrečných titulků)
  { elev: -5.0, kelvin: 1800, sun: 0.0, skyMix: 2.0, skyExp: 0.22, exposure: 2.3, floorLamp: 1, pendant: 1, strip: 1, city: 1 },
];

export function kelvinToColor(k: number, target = new THREE.Color()): THREE.Color {
  // aproximace Tanner Helland, výsledek v lineárním prostoru
  const t = k / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return target.setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

function lerpPhase(a: PhaseDef, b: PhaseDef, t: number): PhaseDef {
  const out = {} as PhaseDef;
  for (const k of Object.keys(a) as Array<keyof PhaseDef>) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Úprava shaderu: uvnitř mřížky sond se nepoužívá difuzní IBL (jinak by se světlo sčítalo dvakrát). */
let patched = false;
function patchShaderChunks(): void {
  if (patched) return;
  patched = true;
  const key = 'lights_fragment_maps';
  const src = THREE.ShaderChunk[key];
  const needle = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
  if (src.includes(needle)) {
    THREE.ShaderChunk[key] = src.replace(
      needle,
      `#if NUM_LIGHT_PROBE_GRIDS > 0
				if ( probeGrid < 0 ) iblIrradiance += getIBLIrradiance( geometryNormal );
			#else
				iblIrradiance += getIBLIrradiance( geometryNormal );
			#endif`,
    );
  }
}

export class Lighting {
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly sunDir = new THREE.Vector3(); // směr paprsků (od slunce)
  readonly toSun = new THREE.Vector3();
  readonly sunColor = new THREE.Color();
  /** Aktuální (interpolovaný) stav. */
  state: PhaseDef = { ...PHASES[0] };
  phase = 0;
  private from: PhaseDef = { ...PHASES[0] };
  private to: PhaseDef = { ...PHASES[0] };
  private t = 1;
  private duration = 5;

  private fill: THREE.HemisphereLight;
  private ambient: THREE.AmbientLight;
  private floorLamp: THREE.PointLight;
  private pendantLight: THREE.SpotLight;
  private strip: THREE.RectAreaLight;
  /** Dvě mřížky sond: přední svítí, do zadní se zapéká; po dokončení se prohodí (bez probliknutí). */
  private grid: LightProbeGridWebGL | null = null;
  private gridBack: LightProbeGridWebGL | null = null;
  private gridTotal = 0;
  private bounces = settings.preset.giBounces;
  private bakeCursor = 0;
  private bakePass = 0;
  private bakePassesWanted = 0;
  private bakeQueued = false;
  private pmrem: THREE.PMREMGenerator;
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envDirty = 0;
  /** Objekty skryté při zapékání (kočka, srst, částice…). */
  readonly hideOnBake: THREE.Object3D[] = [];
  /** 0..1 – jak moc je scéna „ve tmě“ (pro noční vidění a tapetum). */
  darkness = 0;
  /** Násobitel expozice (venku je mnohem víc světla než v pokoji). */
  exposureScale = 1;
  private lampFrame = 0;
  /** Zisk vyvážení bílé pro grading. */
  readonly whiteBalance = new THREE.Vector3(1, 1, 1);

  constructor(private ctx: WorldCtx, private renderer: THREE.WebGLRenderer) {
    patchShaderChunks();
    const q = settings.preset;
    this.sky = new Sky(ctx);

    // slunce
    this.sun = new THREE.DirectionalLight(0xffffff, 10);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(q.shadowMap, q.shadowMap);
    s.camera.left = -4.6;
    s.camera.right = 4.6;
    s.camera.top = 4.2;
    s.camera.bottom = -4.2;
    s.camera.near = 2;
    s.camera.far = 40;
    s.bias = -0.00035;
    s.normalBias = 0.018;
    s.radius = q.shadowRadius;
    ctx.scene.add(this.sun);
    ctx.scene.add(this.sun.target);
    this.sun.target.position.set(-0.4, 1.0, 0);

    // slabé vyplňovací světlo – jen když není GI mřížka (nízká kvalita)
    this.fill = new THREE.HemisphereLight(0xffe2c0, 0x6a5a48, 0);
    ctx.scene.add(this.fill);

    // nepatrné všesměrové světlo = aproximace vyšších odrazů (aby stíny nebyly úplně černé)
    this.ambient = new THREE.AmbientLight(0xfff0e0, 0.08);
    ctx.scene.add(this.ambient);

    // stojací lampa
    const fl = ctx.refs.floorLamp;
    this.floorLamp = new THREE.PointLight(0xffb974, 0, 7, 2);
    this.floorLamp.position.copy(fl ? fl.pos : new THREE.Vector3(0.3, 1.5, 0.4));
    this.floorLamp.castShadow = q.lampShadows;
    this.floorLamp.shadow.mapSize.set(512, 512);
    this.floorLamp.shadow.bias = -0.002;
    this.floorLamp.shadow.camera.near = 0.2;
    this.floorLamp.shadow.camera.far = 7;
    // bodové světlo = 6 stínových průchodů; lampa i většina scény stojí, takže stačí každý 4. snímek
    this.floorLamp.shadow.autoUpdate = false;
    this.floorLamp.visible = false;
    ctx.scene.add(this.floorLamp);

    // závěsné svítidlo nad poloostrovem (svítí dolů, houpe se s ním)
    this.pendantLight = new THREE.SpotLight(0xffd2a0, 0, 5, 1.05, 0.6, 2);
    const pend = ctx.refs.pendant;
    if (pend) {
      this.pendantLight.position.set(0, -pend.drop - pend.shadeH + 0.03, 0);
      pend.pivot.add(this.pendantLight);
      this.pendantLight.target.position.set(0, -pend.drop - 1.2, 0);
      pend.pivot.add(this.pendantLight.target);
    } else {
      this.pendantLight.position.set(PENDANT.x, PENDANT.topY - 0.1, PENDANT.z);
      ctx.scene.add(this.pendantLight);
    }
    this.pendantLight.visible = false;

    // LED pásek pod horní skříňkou (podsvícení linky)
    RectAreaLightUniformsLib.init();
    const sw = KITCHEN.upperX1 - KITCHEN.upperX0 - 0.06;
    this.strip = new THREE.RectAreaLight(0xffe6c4, 0, sw, 0.03);
    this.strip.position.set((KITCHEN.upperX0 + KITCHEN.upperX1) / 2, KITCHEN.upperY0 - 0.004, ROOM.minZ + 0.22);
    this.strip.rotation.x = -Math.PI / 2;
    this.strip.visible = false;
    ctx.scene.add(this.strip);
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2bd, emissiveIntensity: 0 });
    const stripMesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.012), stripMat);
    stripMesh.rotation.x = Math.PI / 2;
    stripMesh.position.copy(this.strip.position).setY(KITCHEN.upperY0 - 0.001);
    ctx.root.add(stripMesh);
    ctx.refs.stripMat = stripMat;

    // odrazová sonda místnosti
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(q.envSize, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(0.05, 1200, this.cubeRT);
    this.cubeCam.position.set(-0.4, 1.25, -0.35);
    ctx.scene.add(this.cubeCam);

    // GI mřížka sond
    // testy mohou GI přepsat: ?gi=off|coarse|full&bounces=1
    const url = new URLSearchParams(location.search);
    const gi = (url.get('gi') as typeof q.gi | null) ?? q.gi;
    if (url.has('bounces')) this.bounces = Number(url.get('bounces'));
    if (gi !== 'off') {
      const res = gi === 'full' ? [13, 6, 11] : [9, 4, 7];
      const make = (priority: number) => {
        const grid = new LightProbeGridWebGL(ROOM.maxX - ROOM.minX, ROOM.h, ROOM.maxZ - ROOM.minZ, res[0], res[1], res[2]);
        grid.position.set(0, ROOM.h / 2, 0);
        grid.priority = priority;
        ctx.scene.add(grid);
        return grid;
      };
      this.grid = make(1);
      this.gridBack = make(0);
      this.gridTotal = res[0] * res[1] * res[2];
    }
  }

  async load(): Promise<void> {
    await this.sky.load();
    this.apply(PHASES[0]);
  }

  /** Okamžité nastavení fáze (načtení hry, debug). */
  setPhaseImmediate(phase: number): void {
    this.phase = THREE.MathUtils.clamp(phase, 0, PHASES.length - 1);
    this.from = this.to = { ...PHASES[this.phase] };
    this.t = 1;
    this.apply(this.to);
    this.requestBake();
    bus.emit('sunsetPhase', { phase: this.phase });
  }

  /** Plynulý přechod do fáze. */
  goToPhase(phase: number, duration = 6): void {
    phase = THREE.MathUtils.clamp(phase, 0, PHASES.length - 1);
    if (phase === this.phase && this.t >= 1) return;
    this.from = { ...this.state };
    this.to = { ...PHASES[phase] };
    this.phase = phase;
    this.t = 0;
    this.duration = duration;
    bus.emit('sunsetPhase', { phase });
  }

  get transitioning(): boolean {
    return this.t < 1;
  }

  update(dt: number): void {
    if (this.floorLamp.castShadow && this.floorLamp.visible && (this.lampFrame++ & 3) === 0) this.floorLamp.shadow.needsUpdate = true;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const e = this.t * this.t * (3 - 2 * this.t);
      this.apply(lerpPhase(this.from, this.to, e));
      this.envDirty += dt;
      if (this.t >= 1) this.requestBake();
      else if (this.envDirty > 1.2) this.requestBake();
    }
  }

  private apply(p: PhaseDef): void {
    // bez GI mřížky (předvolba Nízká) svítí difuzní IBL silněji → nižší expozice
    this.state = this.grid ? p : { ...p, exposure: p.exposure * 0.55 };
    const el = THREE.MathUtils.degToRad(p.elev);
    const hl = Math.hypot(SUN_HEADING.x, SUN_HEADING.z);
    this.sunDir.set((SUN_HEADING.x / hl) * Math.cos(el), -Math.sin(el), (SUN_HEADING.z / hl) * Math.cos(el)).normalize();
    this.toSun.copy(this.sunDir).negate();
    kelvinToColor(p.kelvin, this.sunColor);
    // nízké slunce: atmosféra ho ztlumí a zčervená; pod obzorem zhasne
    const horizonFade = THREE.MathUtils.smoothstep(p.elev, -0.6, 1.2);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = p.sun * horizonFade;
    this.sun.visible = this.sun.intensity > 0.01;
    // u velmi nízkého slunce držíme stínovou kameru nad obzorem (jinak by stíny byly nekonečné)
    const shadowEl = Math.max(el, THREE.MathUtils.degToRad(1.2));
    const sd = new THREE.Vector3((SUN_HEADING.x / hl) * Math.cos(shadowEl), -Math.sin(shadowEl), (SUN_HEADING.z / hl) * Math.cos(shadowEl)).normalize();
    this.sun.position.copy(this.sun.target.position).addScaledVector(sd, -20);

    const glow = this.sunColor.clone().lerp(new THREE.Color(1.0, 0.35, 0.12), THREE.MathUtils.clamp(1 - p.elev / 6, 0, 1) * 0.6);
    this.sky.set(p.skyMix, p.skyExp, this.toSun, p.elev, glow, THREE.MathUtils.smoothstep(p.elev, -1.5, 0.5));
    this.sky.setCityLights(p.city);
    // teplý nádech oblohy kolem západu (HDRI samo je spíš růžovobílé), po západu zase vyprchá
    const warmth = THREE.MathUtils.clamp((4500 - p.kelvin) / 2000, 0, 1) * horizonFade;
    this.sky.uniforms.tint.value.setRGB(1, THREE.MathUtils.lerp(1, 0.74, warmth * 0.8), THREE.MathUtils.lerp(1, 0.5, warmth * 0.8));

    const hasGrid = this.grid !== null;
    this.fill.intensity = hasGrid ? 0 : 0.35 * p.skyExp;
    this.fill.color.copy(this.sunColor).lerp(new THREE.Color(0.75, 0.82, 1), 0.5);
    this.ambient.intensity = 0.1 * p.skyExp + 0.03 * p.floorLamp;

    // lampy
    const refs = this.ctx.refs;
    this.floorLamp.intensity = 6.5 * p.floorLamp;
    this.floorLamp.visible = p.floorLamp > 0.01;
    if (refs.floorLamp) {
      refs.floorLamp.shadeMat.emissiveIntensity = 1.5 * p.floorLamp;
      refs.floorLamp.bulbMat.emissiveIntensity = 14 * p.floorLamp;
    }
    this.pendantLight.intensity = 34 * p.pendant;
    this.pendantLight.visible = p.pendant > 0.01;
    if (refs.pendant) refs.pendant.diffMat.emissiveIntensity = 14 * p.pendant;
    this.strip.intensity = 14 * p.strip;
    this.strip.visible = p.strip > 0.01;
    if (refs.stripMat) refs.stripMat.emissiveIntensity = 10 * p.strip;
    if (refs.hoodLed) refs.hoodLed.material.emissiveIntensity = 0;

    // částečné vyvážení bílé: kompenzuje nádech slunce jen do té míry, do jaké slunce scéně dominuje
    // (po setmění převládá chladná obloha a lampy – tam by kompenzace udělala obraz tyrkysový)
    const dominance = Math.pow(THREE.MathUtils.clamp((p.sun * horizonFade) / 6.8, 0, 1), 0.7);
    // čím teplejší (nižší) barevná teplota, tím méně se kompenzuje – západ má zůstat oranžový
    const wbK = 0.62 * dominance * THREE.MathUtils.clamp((p.kelvin - 2000) / 2500, 0.12, 1);
    const sc = this.sunColor;
    const mean = (sc.r + sc.g + sc.b) / 3;
    this.whiteBalance.set(
      THREE.MathUtils.lerp(1, mean / Math.max(sc.r, 0.05), wbK),
      THREE.MathUtils.lerp(1, mean / Math.max(sc.g, 0.05), wbK),
      THREE.MathUtils.lerp(1, Math.min(2.2, mean / Math.max(sc.b, 0.05)), wbK),
    );
    this.sky.uniforms.saturation.value = THREE.MathUtils.clamp(0.5 + (4500 - p.kelvin) / 4000, 0.5, 1);

    this.darkness = THREE.MathUtils.clamp(1 - (p.sun * horizonFade) / 4 - p.skyExp * 0.22, 0, 1);
  }

  // ------------------------------------------------------------------ GI + odrazy

  /** Naplánuje přepočet sond a odrazové mapy (inkrementálně v dalších snímcích). */
  requestBake(): void {
    this.envDirty = 0;
    this.bakeQueued = true;
  }

  get baking(): boolean {
    return this.bakeQueued || this.bakePassesWanted > 0;
  }

  private setHidden(hidden: boolean): void {
    this.ctx.detail.visible = !hidden;
    for (const o of this.hideOnBake) o.visible = !hidden;
  }

  private bakeRange(grid: LightProbeGridWebGL, start: number, count: number, pass: number): void {
    // během zapékání musí „vyhrát“ zapékaná mřížka (odrazy čtou její předchozí průchod)
    const prev = grid.priority;
    grid.priority = 10;
    this.setHidden(true);
    try {
      grid.bake(this.renderer, this.ctx.scene, { cubemapSize: 8, near: 0.04, far: 1200, start, count, pass });
    } finally {
      this.setHidden(false);
      grid.priority = prev;
    }
  }

  /** Úplné zapečení (při načítání). Vrací promise kvůli průběhu načítání. */
  async bakeAll(onProgress?: (f: number) => void): Promise<void> {
    if (this.grid && this.gridBack) {
      const bounces = this.bounces;
      const chunk = 40;
      const total = this.gridTotal * (bounces + 1);
      let done = 0;
      for (let pass = 0; pass <= bounces; pass++) {
        for (let start = 0; start < this.gridTotal; start += chunk) {
          const count = Math.min(chunk, this.gridTotal - start);
          this.bakeRange(this.grid, start, count, pass);
          done += count;
          onProgress?.(done / total);
          // nechat prohlížeč vykreslit průběh
          if (start % (chunk * 4) === 0) await new Promise((r) => setTimeout(r, 0));
        }
      }
      // zadní mřížka potřebuje jen existující texturu (počet mřížek v shaderu se pak už nemění)
      this.bakeRange(this.gridBack, 0, 1, 0);
    }
    this.updateEnvironment();
    this.bakeQueued = false;
    this.bakePassesWanted = 0;
  }

  /** Inkrementální přepočet do zadní mřížky – volat každý snímek s rozpočtem sond. */
  bakeStep(budget = 24): void {
    if (this.bakeQueued && this.bakePassesWanted === 0) {
      this.bakeQueued = false;
      if (this.gridBack) {
        this.bakePassesWanted = this.bounces + 1;
        this.bakePass = 0;
        this.bakeCursor = 0;
      } else {
        this.updateEnvironment();
      }
    }
    if (!this.grid || !this.gridBack || this.bakePassesWanted === 0) return;
    const count = Math.min(budget, this.gridTotal - this.bakeCursor);
    this.bakeRange(this.gridBack, this.bakeCursor, count, this.bakePass);
    this.bakeCursor += count;
    if (this.bakeCursor >= this.gridTotal) {
      this.bakeCursor = 0;
      this.bakePass++;
      if (this.bakePass >= this.bakePassesWanted) {
        this.bakePassesWanted = 0;
        // prohození: čerstvě zapečená mřížka jde dopředu
        const front = this.grid;
        this.grid = this.gridBack;
        this.gridBack = front;
        this.grid.priority = 1;
        this.gridBack.priority = 0;
        this.updateEnvironment();
      }
    }
  }

  /** Zachytí místnost do krychlové mapy → PMREM → scene.environment (odrazy). */
  updateEnvironment(): void {
    const scene = this.ctx.scene;
    this.setHidden(true);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.shadowMap.needsUpdate = true;
    this.cubeCam.update(this.renderer, scene);
    this.setHidden(false);
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture);
    scene.environment = rt.texture;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.renderer.setRenderTarget(prevTarget);
  }
}
