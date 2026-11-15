import * as THREE from 'three';
import { settings } from '../core/Settings';
import { ROOM, WINDOW, BALCONY_DOOR } from './Layout';
import { rng } from './ProcTextures';

/**
 * Prach poletující ve světle. Částice se rozsvítí jen tam, kde jimi prochází sluneční paprsek –
 * test je analytický: přímka od částice ke slunci musí projít oknem nebo balkonovými dveřmi.
 */
export class Dust {
  readonly points: THREE.Points;
  private uniforms = {
    time: { value: 0 },
    toSun: { value: new THREE.Vector3(-1, 0.2, 0) },
    sunColor: { value: new THREE.Color(1, 0.8, 0.6) },
    ambient: { value: new THREE.Color(0.05, 0.05, 0.05) },
    scale: { value: 600 },
    win: { value: new THREE.Vector4(WINDOW.z0 + 0.06, WINDOW.sill + 0.06, WINDOW.z1 - 0.06, WINDOW.head - 0.06) },
    door: { value: new THREE.Vector4(BALCONY_DOOR.z0 + 0.14, 0.14, BALCONY_DOOR.z1 - 0.14, BALCONY_DOOR.head - 0.14) },
    doorOpen: { value: 0 },
    planeX: { value: ROOM.minX - 0.2 },
  };

  constructor() {
    const n = settings.preset.dust;
    const R = rng(909);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = ROOM.minX + 0.1 + R() * (ROOM.maxX - ROOM.minX - 0.2);
      pos[i * 3 + 1] = 0.05 + R() * (ROOM.h - 0.2);
      pos[i * 3 + 2] = ROOM.minZ + 0.1 + R() * (ROOM.maxZ - ROOM.minZ - 0.2);
      seed[i * 4] = R() * 6.283;
      seed[i * 4 + 1] = R() * 6.283;
      seed[i * 4 + 2] = 0.5 + R();
      seed[i * 4 + 3] = 0.4 + R() * 1.2; // velikost
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float time;
        uniform vec3 toSun;
        uniform float scale;
        uniform vec4 win;
        uniform vec4 door;
        uniform float planeX;
        varying float vLit;
        varying float vFade;
        float inRect(vec3 hit, vec4 r) {
          vec2 a = smoothstep(vec2(r.x, r.y) - 0.03, vec2(r.x, r.y) + 0.03, hit.zy);
          vec2 b = 1.0 - smoothstep(vec2(r.z, r.w) - 0.03, vec2(r.z, r.w) + 0.03, hit.zy);
          return a.x * a.y * b.x * b.y;
        }
        void main() {
          vec3 p = position;
          float t = time * seed.z;
          p.x += sin(t * 0.11 + seed.x) * 0.22 + sin(t * 0.37 + seed.y) * 0.04;
          p.y += sin(t * 0.09 + seed.y) * 0.16 + cos(t * 0.31 + seed.x) * 0.03 - mod(time * 0.004 * seed.z, 0.3);
          p.z += cos(t * 0.13 + seed.x * 1.7) * 0.22;
          // je částice ve slunečním paprsku?
          float lit = 0.0;
          if (toSun.x < -0.01) {
            float k = (planeX - p.x) / toSun.x;
            vec3 hit = p + toSun * k;
            lit = max(inRect(hit, win), inRect(hit, door));
          }
          vLit = lit;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp(seed.w * scale * 0.0024 / max(dist, 0.05), 0.0, 9.0);
          vFade = smoothstep(0.12, 0.45, dist) * (1.0 - smoothstep(5.0, 8.0, dist));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunColor;
        uniform vec3 ambient;
        varying float vLit;
        varying float vFade;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(q));
          vec3 col = sunColor * vLit * 0.085 + ambient * 0.02;
          gl_FragColor = vec4(col * a * a * vFade, 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'dust';
  }

  update(dt: number, toSun: THREE.Vector3, sun: THREE.DirectionalLight, viewportH: number, fov: number): void {
    this.uniforms.time.value += dt;
    this.uniforms.toSun.value.copy(toSun);
    this.uniforms.sunColor.value.copy(sun.color).multiplyScalar(sun.visible ? sun.intensity : 0);
    this.uniforms.scale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }
}
