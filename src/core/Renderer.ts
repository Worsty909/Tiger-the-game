import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, NoiseEffect, BlendFunction, DepthOfFieldEffect, Effect, Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { settings } from './Settings';
import { ROOM } from '../world/Layout';

/**
 * Renderer a post-processing:
 * scéna → N8AO → volumetrické paprsky → (DOF) → bloom + AgX + grading/kočičí smysly → překryv smyslů → SMAA + vinětace + zrno.
 */

// ------------------------------------------------------------------ god rays
const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const MARCH_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
uniform sampler2D depthBuffer;
uniform sampler2DShadow shadowMap;
uniform mat4 shadowMatrix;
uniform mat4 invViewProj;
uniform vec3 camPos;
uniform vec3 toSun;
uniform float time;
uniform vec3 boxMin;
uniform vec3 boxMax;
varying vec2 vUv;

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void main() {
  float depth = texture2D(depthBuffer, vUv).r;
  vec4 wp = invViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 world = wp.xyz / wp.w;
  vec3 dir = world - camPos;
  float maxT = length(dir);
  dir /= maxT;
  // ořez paprsku na vzduch uvnitř místnosti
  vec3 inv = 1.0 / dir;
  vec3 t0 = (boxMin - camPos) * inv;
  vec3 t1 = (boxMax - camPos) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float tf = min(min(tmax.x, tmax.y), min(tmax.z, maxT));
  if (tf <= tn) { gl_FragColor = vec4(0.0); return; }
  float stepLen = (tf - tn) / float(STEPS);
  float jitter = ign(gl_FragCoord.xy + fract(time * 7.13) * 64.0);
  float cosT = dot(dir, toSun);
  // Henyey–Greenstein: dopředný rozptyl (paprsky září při pohledu proti světlu)
  float g = 0.35;
  float phase = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
  phase = phase * 0.85 + 0.012;
  float acc = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = camPos + dir * (tn + (float(i) + jitter) * stepLen);
    vec4 sc = shadowMatrix * vec4(p, 1.0);
    sc.xyz /= sc.w;
    float lit = 0.0;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      lit = texture(shadowMap, vec3(sc.xy, sc.z - 0.0015));
    }
    float n = 0.6 + 0.8 * vnoise(p * 2.4 + vec3(time * 0.05, time * 0.03, 0.0));
    acc += lit * n;
  }
  gl_FragColor = vec4(vec3(acc * stepLen * phase), 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tex;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tex, vUv).rgb * 0.227027;
  c += (texture2D(tex, vUv + dir * 1.3846153846).rgb + texture2D(tex, vUv - dir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(tex, vUv + dir * 3.2307692308).rgb + texture2D(tex, vUv - dir * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D inputBuffer;
uniform sampler2D fog;
uniform vec3 sunColor;
uniform float density;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(inputBuffer, vUv);
  vec3 f = texture2D(fog, vUv).rgb;
  gl_FragColor = vec4(base.rgb + sunColor * f * density, base.a);
}`;

/** Průchod, který nic nekreslí – jen si od composeru vyžádá hloubkovou texturu scény. */
class DepthTap extends Pass {
  texture: THREE.Texture | null = null;
  constructor() {
    super('DepthTap');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    this.enabled = false;
  }
  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.texture = depthTexture;
  }
  override render(): void {
    /* nic */
  }
}

/** Volumetrické paprsky: ray-march proti stínové mapě slunce v polovičním rozlišení + rozmazání. */
class VolumetricPass extends Pass {
  private march: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private composite: THREE.ShaderMaterial;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  density = 0;
  hasShadow = false;

  constructor(steps: number) {
    super('VolumetricPass');
    this.needsSwap = true;
    this.needsDepthTexture = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    const common = { vertexShader: FS_VERT, depthTest: false, depthWrite: false, toneMapped: false };
    this.march = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: MARCH_FRAG,
      defines: { STEPS: String(steps) },
      uniforms: {
        depthBuffer: { value: null },
        shadowMap: { value: null },
        shadowMatrix: { value: new THREE.Matrix4() },
        invViewProj: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() },
        toSun: { value: new THREE.Vector3(1, 0, 0) },
        time: { value: 0 },
        boxMin: { value: new THREE.Vector3(ROOM.minX, 0, ROOM.minZ) },
        boxMax: { value: new THREE.Vector3(ROOM.maxX, ROOM.h, ROOM.maxZ) },
      },
    });
    this.blur = new THREE.ShaderMaterial({ ...common, fragmentShader: BLUR_FRAG, uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2() } } });
    this.composite = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: { inputBuffer: { value: null }, fog: { value: null }, sunColor: { value: new THREE.Color() }, density: { value: 0 } },
    });
    this.fullscreenMaterial = this.composite;
  }

  get marchUniforms(): Record<string, THREE.IUniform> {
    return this.march.uniforms;
  }
  get sunColor(): THREE.Color {
    return this.composite.uniforms.sunColor.value as THREE.Color;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.march.uniforms.depthBuffer.value = depthTexture;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    const active = this.density > 0 && this.hasShadow && this.march.uniforms.depthBuffer.value !== null;
    if (active) {
      this.fullscreenMaterial = this.march;
      renderer.setRenderTarget(this.rtA);
      renderer.render(this.scene, this.camera);
      this.fullscreenMaterial = this.blur;
      const bu = this.blur.uniforms;
      bu.tex.value = this.rtA.texture;
      (bu.dir.value as THREE.Vector2).set(1 / this.rtA.width, 0);
      renderer.setRenderTarget(this.rtB);
      renderer.render(this.scene, this.camera);
      bu.tex.value = this.rtB.texture;
      (bu.dir.value as THREE.Vector2).set(0, 1 / this.rtA.height);
      renderer.setRenderTarget(this.rtA);
      renderer.render(this.scene, this.camera);
    }
    this.fullscreenMaterial = this.composite;
    const cu = this.composite.uniforms;
    cu.inputBuffer.value = inputBuffer.texture;
    cu.fog.value = this.rtA.texture;
    cu.density.value = active ? this.density : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
  }
}

// ------------------------------------------------------------------ grading + kočičí smysly
const gradeFrag = /* glsl */ `
uniform float saturation;
uniform float contrast;
uniform vec3 lift;
uniform vec3 gain;
uniform float senses;
uniform float nightVision;
uniform float fade;
uniform float time;
uniform vec3 whiteBalance;

float hashG(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  // noční vidění: zesílení stínů, zelenkavý nádech, jemný šum
  if (nightVision > 0.001) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 boosted = pow(max(c, vec3(0.0)), vec3(0.42)) * 1.25;
    float bl = dot(boosted, vec3(0.2126, 0.7152, 0.0722));
    vec3 nv = mix(vec3(bl), boosted, 0.35) * vec3(0.72, 1.0, 0.78);
    nv += (hashG(uv * 913.0 + time) - 0.5) * 0.045;
    c = mix(c, nv, nightVision * (1.0 - smoothstep(0.35, 0.8, l)));
  }
  c = c * whiteBalance;
  c = c * gain + lift;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sat = saturation * (1.0 - senses * 0.82);
  c = mix(vec3(luma), c, sat);
  c = (c - 0.5) * (contrast + senses * 0.08) + 0.5;
  // smysly: chladný nádech a ztmavení okrajů
  vec2 q = uv - 0.5;
  float edge = dot(q, q);
  c = mix(c, c * vec3(0.86, 0.93, 1.06), senses * 0.6);
  c *= 1.0 - senses * edge * 1.1;
  c *= 1.0 - fade;
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ['saturation', new THREE.Uniform(1.06)],
        ['contrast', new THREE.Uniform(1.05)],
        ['lift', new THREE.Uniform(new THREE.Vector3(0.0, 0.0, 0.004))],
        ['gain', new THREE.Uniform(new THREE.Vector3(1.02, 1.0, 0.97))],
        ['senses', new THREE.Uniform(0)],
        ['nightVision', new THREE.Uniform(0)],
        ['fade', new THREE.Uniform(0)],
        ['time', new THREE.Uniform(0)],
        ['whiteBalance', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    });
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly camera: THREE.PerspectiveCamera;
  /** Scéna překryvů (pachové stopy, zvukové vlnky) – kreslí se po tone mappingu. */
  readonly overlayScene = new THREE.Scene();
  private renderPass: RenderPass;
  private ao: N8AOPostPass | null = null;
  private volumetric: VolumetricPass | null = null;
  private dof: DepthOfFieldEffect;
  private dofPass: EffectPass;
  private bloom: BloomEffect | null = null;
  private grade: GradeEffect;
  private vignette: VignetteEffect;
  private noise: NoiseEffect;
  private overlayPass: RenderPass;
  private depthTap = new DepthTap();
  private time = 0;
  private _m = new THREE.Matrix4();
  readonly size = new THREE.Vector2(1, 1);
  /** Informace o výkonu posledního snímku. */
  info = { calls: 0, triangles: 0 };

  constructor(readonly canvas: HTMLCanvasElement, readonly scene: THREE.Scene) {
    const q = settings.preset;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: false,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // stíny se přepočítají jednou za snímek (první průchod), další průchody je jen čtou
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(settings.data.fov, 16 / 9, 0.03, 2000);
    this.camera.position.set(1.8, 1.4, 2.0);
    this.camera.lookAt(-0.6, 0.6, 0);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.depthTap);

    if (q.ao !== 'off') {
      const ao = new N8AOPostPass(scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 0.5;
      ao.configuration.distanceFalloff = 0.8;
      ao.configuration.intensity = 2.4;
      ao.configuration.halfRes = q.aoHalfRes;
      ao.configuration.color = new THREE.Color(0x000000);
      // N8AO by si kvůli průhledným objektům znovu vykreslovalo scénu (a tím i stínové mapy
      // se skrytými objekty) – sklo a prach u nás hloubku nezapisují, takže to není potřeba.
      (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      ao.setQualityMode(q.ao === 'low' ? 'Low' : q.ao === 'medium' ? 'Medium' : q.ao === 'high' ? 'High' : 'Ultra');
      this.composer.addPass(ao as unknown as RenderPass);
      this.ao = ao;
    }

    if (q.volumetricSteps > 0) {
      this.volumetric = new VolumetricPass(q.volumetricSteps);
      this.composer.addPass(this.volumetric);
    }

    this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 1, focusRange: 0.6, bokehScale: 3, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(this.camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    const mainEffects: Effect[] = [];
    if (q.bloom) {
      this.bloom = new BloomEffect({ intensity: 0.55, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 });
      mainEffects.push(this.bloom);
    }
    mainEffects.push(tone, this.grade);
    this.composer.addPass(new EffectPass(this.camera, ...mainEffects));

    this.overlayPass = new RenderPass(this.overlayScene, this.camera);
    this.overlayPass.clear = false;
    this.overlayPass.ignoreBackground = true;
    this.overlayPass.skipShadowMapUpdate = true;
    this.overlayPass.enabled = false;
    this.composer.addPass(this.overlayPass);

    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.5 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.07;
    const finalEffects: Effect[] = [];
    if (q.smaa) finalEffects.push(new SMAAEffect({ preset: q.ao === 'high' || q.ao === 'ultra' ? SMAAPreset.ULTRA : SMAAPreset.HIGH }));
    finalEffects.push(this.vignette, this.noise);
    this.composer.addPass(new EffectPass(this.camera, ...finalEffects));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    const cap = settings.preset.pixelRatio;
    const pr = Math.min(dpr, Math.max(1, cap)) * Math.min(1, cap);
    this.renderer.setPixelRatio(Math.max(0.5, pr));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size.set(w, h);
  }

  /** Hloubková textura hlavní scény (pro překryvy: pachové stopy, oblouk skoku). */
  get depthTexture(): THREE.Texture | null {
    return this.depthTap.texture;
  }

  setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setExposure(e: number): void {
    this.renderer.toneMappingExposure = e;
  }

  /** Hloubka ostrosti (jen v detailech a ve finále). */
  setDof(enabled: boolean, focusDistance = 1, focusRange = 0.5, bokeh = 3): void {
    this.dofPass.enabled = enabled;
    if (enabled) {
      const coc = this.dof.cocMaterial as unknown as { focusDistance: number; focusRange: number };
      coc.focusDistance = focusDistance;
      coc.focusRange = focusRange;
      this.dof.bokehScale = bokeh;
    }
  }

  setSenses(amount: number, nightVision: number): void {
    this.grade.uniforms.get('senses')!.value = amount;
    this.grade.uniforms.get('nightVision')!.value = nightVision;
    this.overlayPass.enabled = amount > 0.01 || this.overlayAlways;
  }

  /** Překryvná scéna se kreslí i mimo režim smyslů (např. oblouk skoku). */
  overlayAlways = false;

  /** Částečné vyvážení bílé (oko/kamera se přizpůsobí teplému světlu). */
  setWhiteBalance(r: number, g: number, b: number): void {
    (this.grade.uniforms.get('whiteBalance')!.value as THREE.Vector3).set(r, g, b);
  }

  setFade(v: number): void {
    this.grade.uniforms.get('fade')!.value = v;
  }

  setVolumetric(sun: THREE.DirectionalLight, toSun: THREE.Vector3, density: number): void {
    const v = this.volumetric;
    if (!v) return;
    const u = v.marchUniforms;
    const map = sun.shadow.map as (THREE.WebGLRenderTarget & { depthTexture: THREE.DepthTexture | null }) | null;
    const tex = map ? map.depthTexture : null;
    u.shadowMap.value = tex;
    v.hasShadow = !!tex && sun.visible;
    (u.shadowMatrix.value as THREE.Matrix4).copy(sun.shadow.matrix);
    v.sunColor.copy(sun.color).multiplyScalar(sun.intensity);
    (u.toSun.value as THREE.Vector3).copy(toSun);
    v.density = density;
  }

  render(dt: number): void {
    this.time += dt;
    const cam = this.camera;
    if (this.volumetric) {
      const u = this.volumetric.marchUniforms;
      cam.updateMatrixWorld();
      this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
      (u.invViewProj.value as THREE.Matrix4).copy(this._m);
      (u.camPos.value as THREE.Vector3).copy(cam.position);
      u.time.value = this.time % 1000;
    }
    this.grade.uniforms.get('time')!.value = this.time % 100;
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render(dt);
    this.info.calls = this.renderer.info.render.calls;
    this.info.triangles = this.renderer.info.render.triangles;
  }
}
