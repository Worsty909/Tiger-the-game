import * as THREE from 'three';
import type { Game } from '../core/Game';

/**
 * Kočičí smysly (držet Q): okolí se odbarví, pachové stopy tečou jako svítící proud částic,
 * zvuky se šíří jako vlnky ze svého zdroje a ve tmě se zapne noční vidění.
 * Stopy a vlnky se kreslí do překryvné scény po tone mappingu (zůstanou barevné) a ručně se
 * ořezávají hloubkou hlavní scény. Stejná vrstva kreslí i oblouk mířeného skoku.
 */

export interface ScentTrail {
  id: string;
  color: number;
  /** Průchozí body volným prostorem (od středu místnosti k cíli). */
  waypoints: THREE.Vector3[];
  active: () => boolean;
}

export interface SoundSource {
  id: string;
  pos: THREE.Vector3 | (() => THREE.Vector3);
  color: number;
  active: () => boolean;
  /** Vlnek za sekundu. */
  rate?: number;
  size?: number;
}

const POINT_VERT = /* glsl */ `
attribute float alpha;
attribute float size;
uniform float scale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * scale / max(-mv.z, 0.05), 1.0, 64.0);
  vAlpha = alpha;
}`;

const POINT_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform vec3 color;
uniform float hasDepth;
uniform float opacity;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(q));
  if (hasDepth > 0.5) {
    float d = texture2D(tDepth, gl_FragCoord.xy / resolution).r;
    if (gl_FragCoord.z > d + 0.00003) discard;
  }
  float v = a * a * vAlpha * opacity;
  gl_FragColor = vec4(color * v, v);
}`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RING_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform vec3 color;
uniform float hasDepth;
uniform float opacity;
uniform float soft;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.78, 0.9, r) * (1.0 - smoothstep(0.92, 1.0, r));
  ring = mix(ring, (1.0 - smoothstep(0.0, 1.0, r)) * 0.5, soft);
  if (hasDepth > 0.5) {
    float d = texture2D(tDepth, gl_FragCoord.xy / resolution).r;
    if (gl_FragCoord.z > d + 0.00003) ring *= 0.12;
  }
  float v = ring * opacity;
  gl_FragColor = vec4(color * v, v);
}`;

const PER_TRAIL = 64;
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();

interface TrailGfx {
  def: ScentTrail;
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  pos: Float32Array;
  alpha: Float32Array;
  size: Float32Array;
  seeds: Float32Array;
  path: THREE.Vector3[];
  lengths: number[];
  total: number;
  fade: number;
}

interface SoundGfx {
  def: SoundSource;
  rings: THREE.Mesh[];
  mats: THREE.ShaderMaterial[];
  fade: number;
}

export class Senses {
  /** 0..1 plynulá síla efektu. */
  amount = 0;
  /** Drží hráč Q? */
  active = false;
  /** Byly smysly už někdy použity? */
  usedOnce = false;
  nightVision = 0;
  /** Lze vynutit (cutscéna). */
  forced = false;
  private trails: TrailGfx[] = [];
  private sounds: SoundGfx[] = [];
  private time = 0;
  private shared = {
    tDepth: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    hasDepth: { value: 0 },
    scale: { value: 600 },
  };
  // oblouk skoku
  private arc: THREE.Points;
  private arcMat: THREE.ShaderMaterial;
  private arcPos = new Float32Array(26 * 3);
  private arcAlpha = new Float32Array(26);
  private marker: THREE.Mesh;
  private markerMat: THREE.ShaderMaterial;
  private readonly ringGeo = new THREE.PlaneGeometry(1, 1);

  constructor(private game: Game) {
    const scene = game.gfx.overlayScene;
    this.arcMat = this.pointMaterial(0xfff2c8);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.arcAlpha, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(26).fill(0.018), 1));
    this.arc = new THREE.Points(geo, this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    scene.add(this.arc);
    this.markerMat = this.ringMaterial(0x9dff9a);
    this.marker = new THREE.Mesh(this.ringGeo, this.markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.scale.setScalar(0.26);
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    scene.add(this.marker);
  }

  private pointMaterial(color: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.shared, color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  private ringMaterial(color: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.shared, color: { value: new THREE.Color(color) }, opacity: { value: 1 }, soft: { value: 0 } },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }

  addTrail(def: ScentTrail): void {
    const mat = this.pointMaterial(def.color);
    const pos = new Float32Array(PER_TRAIL * 3);
    const alpha = new Float32Array(PER_TRAIL);
    const size = new Float32Array(PER_TRAIL);
    const seeds = new Float32Array(PER_TRAIL * 2);
    for (let i = 0; i < PER_TRAIL; i++) {
      seeds[i * 2] = i / PER_TRAIL + Math.random() * 0.01;
      seeds[i * 2 + 1] = Math.random() * 6.28;
      size[i] = 0.02 + Math.random() * 0.03;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    this.game.gfx.overlayScene.add(points);
    this.trails.push({ def, points, mat, pos, alpha, size, seeds, path: [], lengths: [], total: 0, fade: 0 });
  }

  addSound(def: SoundSource): void {
    const rings: THREE.Mesh[] = [];
    const mats: THREE.ShaderMaterial[] = [];
    for (let i = 0; i < 3; i++) {
      const m = this.ringMaterial(def.color);
      const r = new THREE.Mesh(this.ringGeo, m);
      r.frustumCulled = false;
      r.visible = false;
      this.game.gfx.overlayScene.add(r);
      rings.push(r);
      mats.push(m);
    }
    this.sounds.push({ def, rings, mats, fade: 0 });
  }

  /** Je stopa právě vidět? (pro hádanky) */
  trailVisible(id: string): boolean {
    const t = this.trails.find((x) => x.def.id === id);
    return !!t && t.fade > 0.5 && this.amount > 0.5;
  }

  /** Cesta od kočky: nejbližší průchozí bod a dál k cíli. */
  private buildPath(t: TrailGfx, from: THREE.Vector3): void {
    const wp = t.def.waypoints;
    let k = 0;
    let bd = Infinity;
    for (let i = 0; i < wp.length - 1; i++) {
      const d = wp[i].distanceTo(from);
      if (d < bd) {
        bd = d;
        k = i;
      }
    }
    // pokud je kočka blíž cíli než nejbližší bod, začít až dalším
    if (k < wp.length - 1 && from.distanceTo(wp[wp.length - 1]) < wp[k].distanceTo(wp[wp.length - 1])) k++;
    t.path.length = 0;
    t.path.push(_a.copy(from).setY(from.y + 0.14).clone());
    for (let i = k; i < wp.length; i++) t.path.push(wp[i]);
    t.lengths.length = 0;
    t.total = 0;
    for (let i = 0; i < t.path.length - 1; i++) {
      const l = t.path[i].distanceTo(t.path[i + 1]);
      t.lengths.push(l);
      t.total += l;
    }
  }

  private samplePath(t: TrailGfx, u: number, out: THREE.Vector3): THREE.Vector3 {
    let d = u * t.total;
    for (let i = 0; i < t.lengths.length; i++) {
      if (d <= t.lengths[i] || i === t.lengths.length - 1) {
        return out.lerpVectors(t.path[i], t.path[i + 1], t.lengths[i] > 0 ? Math.min(1, d / t.lengths[i]) : 0);
      }
      d -= t.lengths[i];
    }
    return out.copy(t.path[t.path.length - 1]);
  }

  /** Volat každý snímek. */
  update(dt: number): void {
    const g = this.game;
    this.time += dt;
    const held = (g.input.isHeld('senses') && g.state === 'playing' && !g.cat.inputLocked) || this.forced;
    this.active = held;
    if (held) this.usedOnce = true;
    this.amount += ((held ? 1 : 0) - this.amount) * (1 - Math.exp(-dt * 7));
    if (this.amount < 0.002) this.amount = 0;

    // noční vidění: pod gaučem nebo po setmění
    const sofa = g.ctx.refs.sofa;
    let dark = g.lighting.darkness * 0.7;
    if (sofa) {
      const p = g.cat.position;
      if (p.x > sofa.underMin.x && p.x < sofa.underMax.x && p.z > sofa.underMin.z && p.z < sofa.underMax.z && p.y < 0.2) dark = 1;
    }
    this.nightVision += (dark * this.amount - this.nightVision) * (1 - Math.exp(-dt * 6));

    // sdílené uniformy
    const dpr = g.gfx.renderer.getPixelRatio();
    this.shared.resolution.value.set(g.gfx.size.x * dpr, g.gfx.size.y * dpr);
    this.shared.tDepth.value = g.gfx.depthTexture;
    this.shared.hasDepth.value = g.gfx.depthTexture ? 1 : 0;
    this.shared.scale.value = (g.gfx.size.y * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(g.gfx.camera.fov) / 2));

    // --- pachové stopy
    const cat = g.cat.position;
    for (const t of this.trails) {
      const on = this.amount > 0.01 && t.def.active();
      t.fade += ((on ? 1 : 0) - t.fade) * (1 - Math.exp(-dt * 4));
      t.points.visible = t.fade * this.amount > 0.01;
      if (!t.points.visible) continue;
      this.buildPath(t, cat);
      const speed = 0.22 / Math.max(t.total, 0.5);
      for (let i = 0; i < PER_TRAIL; i++) {
        const u = (t.seeds[i * 2] + this.time * speed) % 1;
        this.samplePath(t, u, _v);
        const ph = t.seeds[i * 2 + 1];
        _v.x += Math.sin(this.time * 1.3 + ph + u * 9) * 0.035;
        _v.y += Math.sin(this.time * 1.7 + ph * 2 + u * 7) * 0.03 + 0.02;
        _v.z += Math.cos(this.time * 1.1 + ph + u * 8) * 0.035;
        t.pos[i * 3] = _v.x;
        t.pos[i * 3 + 1] = _v.y;
        t.pos[i * 3 + 2] = _v.z;
        t.alpha[i] = Math.sin(Math.PI * u) * (0.55 + 0.45 * Math.sin(ph * 5 + this.time * 3));
      }
      t.points.geometry.attributes.position.needsUpdate = true;
      t.points.geometry.attributes.alpha.needsUpdate = true;
      t.mat.uniforms.opacity.value = t.fade * this.amount * 0.9;
    }

    // --- zvukové vlnky
    const cam = g.gfx.camera;
    for (const s of this.sounds) {
      const on = this.amount > 0.01 && s.def.active();
      s.fade += ((on ? 1 : 0) - s.fade) * (1 - Math.exp(-dt * 4));
      const vis = s.fade * this.amount > 0.01;
      const p = typeof s.def.pos === 'function' ? s.def.pos() : s.def.pos;
      const rate = s.def.rate ?? 0.7;
      const size = s.def.size ?? 0.55;
      s.rings.forEach((r, i) => {
        r.visible = vis;
        if (!vis) return;
        const u = (this.time * rate + i / s.rings.length) % 1;
        r.position.copy(p);
        r.quaternion.copy(cam.quaternion);
        r.scale.setScalar(0.06 + u * size);
        s.mats[i].uniforms.opacity.value = (1 - u) * (1 - u) * s.fade * this.amount * 0.85;
      });
    }

    // --- oblouk mířeného skoku
    const c = g.cat;
    const arc = c.aiming ? c.aimArc : null;
    if (arc && arc.points.length > 1) {
      const n = Math.min(26, arc.points.length);
      for (let i = 0; i < 26; i++) {
        const p = arc.points[Math.min(i, n - 1)];
        this.arcPos[i * 3] = p.x;
        this.arcPos[i * 3 + 1] = p.y + 0.06;
        this.arcPos[i * 3 + 2] = p.z;
        // „tečkovaná“ čára, která se posouvá ke značce
        this.arcAlpha[i] = i < n ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(i * 1.4 - this.time * 9)) : 0;
      }
      this.arc.geometry.attributes.position.needsUpdate = true;
      this.arc.geometry.attributes.alpha.needsUpdate = true;
      const col = arc.valid ? 0xd8ffd0 : 0xff8a70;
      (this.arcMat.uniforms.color.value as THREE.Color).setHex(col);
      (this.markerMat.uniforms.color.value as THREE.Color).setHex(arc.valid ? 0x8dff86 : 0xff5a3c);
      this.marker.position.copy(arc.target).setY(arc.target.y + 0.012);
      this.marker.scale.setScalar(0.24 + Math.sin(this.time * 6) * 0.02);
      this.arc.visible = true;
      this.marker.visible = true;
    } else {
      this.arc.visible = false;
      this.marker.visible = false;
    }

    g.gfx.overlayAlways = this.arc.visible;
    g.gfx.setSenses(this.amount, this.nightVision);
  }
}
