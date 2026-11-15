import * as THREE from 'three';
import { assets } from '../core/Assets';
import { settings } from '../core/Settings';
import type { WorldCtx } from './Ctx';
import { rng, makeCanvas, canvasTexture } from './ProcTextures';
import { ROOM, SUN_HEADING } from './Layout';

/**
 * Obloha: kopule se třemi HDRI z Poly Haven (západ → růžový soumrak → modrá hodinka), mezi kterými
 * se plynule prolíná. HDRI je natočené tak, aby jeho slunce sedělo se směrem herního slunce.
 * Před oblohou stojí 3D siluety střech města.
 */

const HDRIS = [
  { id: 'qwantani_sunset_puresky', sunU: 0.6, sunElev: 6.2 },
  { id: 'qwantani_dusk_2_puresky', sunU: 0.59, sunElev: 6.2 },
  { id: 'qwantani_dusk_1_puresky', sunU: 0.596, sunElev: 6.2 },
];

function gradientSky(top: string, mid: string, low: string): THREE.Texture {
  // náhradní obloha, když HDRI chybí
  const [c, g] = makeCanvas(8, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top);
  gr.addColorStop(0.47, mid);
  gr.addColorStop(0.5, low);
  gr.addColorStop(1, '#30323a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 256);
  const t = canvasTexture(c, true, true);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    texA: { value: null as THREE.Texture | null },
    texB: { value: null as THREE.Texture | null },
    mixAB: { value: 0 },
    exposure: { value: 1 },
    yaw: { value: 0 },
    vShift: { value: 0 },
    sunDir: { value: new THREE.Vector3(-1, 0.1, 0) },
    sunGlow: { value: new THREE.Color(1, 0.6, 0.3) },
    sunGlowAmount: { value: 0 },
    tint: { value: new THREE.Color(1, 1, 1) },
    saturation: { value: 1 },
  };
  private textures: THREE.Texture[] = [];
  readonly city = new THREE.Group();
  private windowMat!: THREE.MeshBasicMaterial;

  constructor(private ctx: WorldCtx) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D texA;
        uniform sampler2D texB;
        uniform float mixAB;
        uniform float exposure;
        uniform float yaw;
        uniform float vShift;
        uniform vec3 sunDir;
        uniform vec3 sunGlow;
        uniform float sunGlowAmount;
        uniform vec3 tint;
        uniform float saturation;
        varying vec3 vDir;
        const float PI = 3.141592653589793;
        void main() {
          vec3 d = normalize(vDir);
          float u = (atan(d.z, d.x) + yaw) / (2.0 * PI) + 0.5;
          float elev = asin(clamp(d.y, -1.0, 1.0));
          // pod obzorem zrcadlíme oblohu (spodní polokoule HDRI je jen mlha)
          float v = (abs(elev) * 0.96 + 0.012 - vShift) / PI + 0.5;
          vec3 a = texture2D(texA, vec2(u, v)).rgb;
          vec3 b = texture2D(texB, vec2(u, v)).rgb;
          vec3 col = mix(a, b, mixAB);
          col = min(col, vec3(60.0)); // slunce v HDRI by přepálilo bloom
          col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
          // vlastní sluneční kotouč a záře (HDRI má slunce jen v jedné výšce)
          float cosA = dot(d, normalize(sunDir));
          float disk = smoothstep(0.99990, 0.99997, cosA);
          float halo = pow(max(cosA, 0.0), 180.0) * 2.5 + pow(max(cosA, 0.0), 14.0) * 0.35;
          col += sunGlow * (disk * 60.0 + halo) * sunGlowAmount;
          if (elev < 0.0) col *= mix(1.0, 0.25, smoothstep(0.0, -0.25, elev));
          gl_FragColor = vec4(col * tint * exposure, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    ctx.exterior.add(this.mesh);
    ctx.exterior.add(this.city);
  }

  async load(): Promise<void> {
    const loaded = await Promise.all(HDRIS.map((h) => assets.hdr(`assets/hdri/${h.id}.hdr`)));
    const fallbacks = [
      () => gradientSky('#27406e', '#f0a060', '#ffc890'),
      () => gradientSky('#3a3f6e', '#c98aa0', '#e8a8a0'),
      () => gradientSky('#1a2440', '#4a5a86', '#6a7aa0'),
    ];
    this.textures = loaded.map((t, i) => t ?? fallbacks[i]());
    this.uniforms.texA.value = this.textures[0];
    this.uniforms.texB.value = this.textures[1];
    // natočení: slunce HDRI (u = 0.6) → směr, odkud svítí herní slunce
    const hdrAngle = (HDRIS[0].sunU - 0.5) * Math.PI * 2;
    const worldAngle = Math.atan2(-SUN_HEADING.z, -SUN_HEADING.x);
    this.uniforms.yaw.value = hdrAngle - worldAngle;
    this.buildCity();
  }

  /** skyMix ∈ [0, 2]: 0 = západ, 1 = růžový soumrak, 2 = modrá hodinka. */
  set(skyMix: number, exposure: number, sunDir: THREE.Vector3, sunElevDeg: number, glow: THREE.Color, glowAmount: number): void {
    const i = Math.min(1, Math.floor(skyMix));
    this.uniforms.texA.value = this.textures[i];
    this.uniforms.texB.value = this.textures[i + 1];
    this.uniforms.mixAB.value = THREE.MathUtils.clamp(skyMix - i, 0, 1);
    this.uniforms.exposure.value = exposure;
    this.uniforms.sunDir.value.copy(sunDir);
    this.uniforms.vShift.value = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(sunElevDeg - HDRIS[0].sunElev, -8, 5)) * 0.6;
    this.uniforms.sunGlow.value.copy(glow);
    this.uniforms.sunGlowAmount.value = glowAmount;
  }

  /** Rozsvícená okna města (0..1). */
  setCityLights(v: number): void {
    if (this.windowMat) {
      this.windowMat.color.setRGB(1.0, 0.72, 0.38).multiplyScalar(v * 3.2);
      this.windowMat.visible = v > 0.01;
    }
  }

  /** Siluety střech: domy s valbovými/sedlovými střechami, komíny, antény, věž kostela. */
  private buildCity(): void {
    const { mats } = this.ctx;
    const R = rng(77);
    const density = settings.preset.city;
    // Byt je ve 4. patře: okolní střechy jsou pod úrovní podlahy, vzdálenější domy vyšší.
    const bodies: THREE.Matrix4[] = [];
    const bodies2: THREE.Matrix4[] = [];
    const roofsA: THREE.Matrix4[] = [];
    const roofsB: THREE.Matrix4[] = [];
    const chimneys: THREE.Matrix4[] = [];
    const windows: THREE.Matrix4[] = [];
    const d = new THREE.Object3D();
    const groundY = -11.5;
    const count = Math.round(150 * density);
    for (let i = 0; i < count; i++) {
      // rozmístění do pásu na západ od bytu (x < -9), řidčeji do stran
      const dist = 22 + Math.pow(R(), 1.5) * 190;
      const ang = Math.PI + (R() - 0.5) * 2.5; // směr na západ ± 72°
      const x = Math.cos(ang) * dist + ROOM.minX;
      const z = Math.sin(ang) * dist;
      if (x > -16) continue;
      const w = 9 + R() * 12;
      const dep = 9 + R() * 9;
      const h = dist < 45 ? 5.5 + R() * 3.5 : dist < 110 ? 7 + R() * 6.5 : 9 + R() * 10;
      const rot = (Math.round(R() * 3) * Math.PI) / 2 + (R() - 0.5) * 0.25;
      d.position.set(x, groundY + h / 2, z);
      d.rotation.set(0, rot, 0);
      d.scale.set(w, h, dep);
      d.updateMatrix();
      (R() < 0.6 ? bodies : bodies2).push(d.matrix.clone());
      // střecha: jehlan se 4 stranami, protažený
      const rh = 2.2 + R() * 2.6;
      d.position.set(x, groundY + h + rh / 2, z);
      d.rotation.set(0, rot + Math.PI / 4, 0);
      d.scale.set(1, rh, 1);
      d.updateMatrix();
      const m = new THREE.Matrix4().makeRotationY(rot).multiply(new THREE.Matrix4().makeScale(w * 1.04, 1, dep * 1.04));
      m.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 4));
      m.premultiply(new THREE.Matrix4().makeTranslation(x, groundY + h + rh / 2, z));
      m.multiply(new THREE.Matrix4().makeScale(1, rh, 1));
      (R() < 0.7 ? roofsA : roofsB).push(m);
      // komíny
      const nCh = 1 + Math.floor(R() * 2);
      for (let c = 0; c < nCh; c++) {
        d.position.set(x + (R() - 0.5) * w * 0.5, groundY + h + rh * 0.55 + 0.6, z + (R() - 0.5) * dep * 0.5);
        d.rotation.set(0, rot, 0);
        d.scale.set(0.7, 2.2 + R(), 0.9);
        d.updateMatrix();
        chimneys.push(d.matrix.clone());
      }
      // okna (svítí za soumraku) – jen na straně přivrácené k bytu
      if (dist < 110) {
        const nx = Math.cos(rot);
        const nz = -Math.sin(rot);
        const rows = Math.floor(h / 3);
        const cols = Math.floor(dep / 2.4);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (R() > 0.3) continue;
          const side = (c + 0.5) / cols - 0.5;
          d.position.set(x + nx * (w / 2 + 0.03) + Math.sin(rot) * side * dep, groundY + 1.6 + r * 3, z + nz * (w / 2 + 0.03) + Math.cos(rot) * side * dep);
          d.rotation.set(0, rot + Math.PI / 2, 0);
          d.scale.set(1.1, 1.4, 1);
          d.updateMatrix();
          windows.push(d.matrix.clone());
        }
      }
    }
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = false) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadow;
      im.receiveShadow = false;
      im.frustumCulled = false;
      this.city.add(im);
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    // UV pro fasády/střechy: jednoduché opakování
    const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
    const uv = roofGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 14, uv.getY(i) * 5);
    const facA = this.ctx.mats.facade.clone();
    facA.map = facA.map!.clone();
    facA.map.repeat.set(3, 3);
    facA.normalMap = null;
    const facB = this.ctx.mats.facadeLight.clone();
    facB.normalMap = null;
    facB.color.set(0xcfc4b4);
    inst(box, facA, bodies);
    inst(box, facB, bodies2);
    const roofA = mats.roofTile.clone();
    roofA.map = roofA.map!.clone();
    roofA.map.repeat.set(1, 1);
    roofA.normalMap = null;
    roofA.aoMap = null;
    const roofB = roofA.clone();
    roofB.color.set(0x7c8086);
    inst(roofGeo, roofA, roofsA);
    inst(roofGeo, roofB, roofsB);
    inst(box, new THREE.MeshStandardMaterial({ color: 0x8a5a44, roughness: 1 }), chimneys);
    this.windowMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.windowMat.visible = false;
    inst(new THREE.PlaneGeometry(1, 1), this.windowMat, windows);

    // věž kostela a pár antén pro čitelnou siluetu
    const tower = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0xb8ab98, roughness: 1 });
    const tb = new THREE.Mesh(new THREE.BoxGeometry(6, 30, 6), stone);
    tb.position.y = 15;
    tower.add(tb);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4.6, 16, 4), new THREE.MeshStandardMaterial({ color: 0x4f6f66, roughness: 0.8 }));
    spire.position.y = 38;
    spire.rotation.y = Math.PI / 4;
    tower.add(spire);
    tower.position.set(-95, groundY, -38);
    this.city.add(tower);
    const antennaMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1c });
    for (let i = 0; i < 14; i++) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3 + R() * 2, 4), antennaMat);
      const dist = 16 + R() * 50;
      const ang = Math.PI + (R() - 0.5) * 1.6;
      a.position.set(Math.cos(ang) * dist - 3, 4 + R() * 3, Math.sin(ang) * dist);
      this.city.add(a);
    }
    // zem / ulice hluboko dole
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x4b4a47, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-200, groundY, 0);
    this.city.add(ground);
  }
}
