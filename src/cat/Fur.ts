import * as THREE from 'three';
import { settings } from '../core/Settings';
import type { CatModel } from './CatModel';

/**
 * Srst a oči Tigera.
 *
 * - Kůže: MeshPhysicalMaterial se sheen (měkký lesk kožichu) a „glitter“ efektem bengálek.
 * - Shell fur: stejná skinovaná síť vykreslená N× instancovaně, každá vrstva posunutá po normále.
 *   Chlupy jsou 3D buňky v klidovém prostoru modelu (UV atlas modelu je rozsekaný, takže UV šum
 *   by dělal švy), špičky se ztenčují, srst se mírně ohýbá gravitací. Barva jde z base color textury.
 * - Oči: poloha se najde z textury (zelené duhovky), v jejich okolí srst není, povrch má clearcoat
 *   (vlhký odlesk) a ve tmě svítí tapetum lucidum.
 */

const COMMON_VERT_PARS = /* glsl */ `
attribute float furLen;
varying float vFurLen;
varying vec3 vRestPos;
varying float vShell;
uniform mat4 restMatrix;
uniform float furLength;
uniform float furLayers;
`;

const COMMON_FRAG_PARS = /* glsl */ `
varying float vFurLen;
varying vec3 vRestPos;
varying float vShell;
uniform vec4 eyeA;
uniform vec4 eyeB;
uniform float tapetum;
uniform float glitter;
uniform float furDensity;
float furHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float eyeMaskAt(vec3 p) {
  float a = 1.0 - smoothstep(eyeA.w * 0.8, eyeA.w, distance(p, eyeA.xyz));
  float b = 1.0 - smoothstep(eyeB.w * 0.8, eyeB.w, distance(p, eyeB.xyz));
  return max(a, b);
}
`;

export class Fur {
  readonly shells: THREE.SkinnedMesh | null = null;
  private enabled = settings.data.fur;
  private lodLayers = -1;
  readonly skin: THREE.MeshPhysicalMaterial;
  private furMat: THREE.MeshPhysicalMaterial | null = null;
  readonly uniforms = {
    restMatrix: { value: new THREE.Matrix4() },
    furLength: { value: 0.0042 },
    furLayers: { value: 24 },
    eyeA: { value: new THREE.Vector4(0, 10, 0, 0.001) },
    eyeB: { value: new THREE.Vector4(0, 10, 0, 0.001) },
    tapetum: { value: 0 },
    glitter: { value: 1 },
    furDensity: { value: 2600 },
  };
  /** Značky očí připojené k hlavě (světové polohy pro efekty). */
  readonly eyeMarkers: THREE.Object3D[] = [];

  constructor(private model: CatModel) {
    const mesh = model.mesh;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const layers = settings.preset.furLayers;
    this.uniforms.furLayers.value = layers;
    // klidový prostor modelu
    model.root.updateMatrixWorld(true);
    this.uniforms.restMatrix.value.copy(model.root.matrixWorld).invert().multiply(mesh.matrixWorld);

    this.findEyes(mesh, src);
    this.computeFurLength(mesh);

    // ---------- kůže
    const skin = new THREE.MeshPhysicalMaterial({
      map: src.map,
      normalMap: src.normalMap,
      normalScale: src.normalScale.clone(),
      roughnessMap: src.roughnessMap,
      metalnessMap: null,
      roughness: 0.82,
      metalness: 0,
      sheen: 0.45,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xf2b46e),
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    skin.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + COMMON_VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRestPos = (restMatrix * vec4(position, 1.0)).xyz;\n  vShell = 0.0;\n  vFurLen = furLen;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + COMMON_FRAG_PARS)
        // oči: hladké, lesklé (clearcoat jen na očích)
        .replace(
          '#include <lights_physical_fragment>',
          /* glsl */ `#include <lights_physical_fragment>
          float eyeM = eyeMaskAt(vRestPos);
          material.clearcoat *= eyeM;
          material.roughness = mix(material.roughness, 0.12, eyeM);
          material.sheenColor *= (1.0 - eyeM);`,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `#include <lights_fragment_end>
          {
            // glitter: drobné jiskřičky v odlescích, mění se s úhlem pohledu
            vec3 gcell = floor(vRestPos * 1400.0);
            vec3 vdir = normalize(vViewPosition);
            float gh = furHash(gcell + floor(vdir * 9.0));
            float spark = smoothstep(0.972, 1.0, gh) * glitter * (1.0 - eyeM);
            reflectedLight.directSpecular += reflectedLight.directDiffuse * spark * 2.2;
            // tapetum lucidum: zelenožlutý odlesk očí ve tmě, nejsilnější při pohledu přímo do očí
            float retro = pow(clamp(dot(normalize(normal), vdir), 0.0, 1.0), 2.5);
            totalEmissiveRadiance += vec3(0.62, 1.0, 0.38) * eyeM * tapetum * retro * 0.35;
          }`,
        );
    };
    skin.customProgramCacheKey = () => 'tiger-skin';
    mesh.material = skin;
    this.skin = skin;

    // ---------- shell fur
    if (layers > 0) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = mesh.geometry.index;
      for (const [name, attr] of Object.entries(mesh.geometry.attributes)) geo.setAttribute(name, attr);
      geo.instanceCount = layers;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 2);
      const fur = new THREE.MeshPhysicalMaterial({
        map: src.map,
        roughness: 0.78,
        metalness: 0,
        sheen: 0.4,
        sheenRoughness: 0.45,
        sheenColor: new THREE.Color(0xf6bd7c),
        side: THREE.FrontSide,
      });
      fur.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + COMMON_VERT_PARS)
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `#include <begin_vertex>
            vShell = (float(gl_InstanceID) + 1.0) / furLayers;
            vRestPos = (restMatrix * vec4(position, 1.0)).xyz;
            // posun po normále + mírný ohyb gravitací (silnější u špiček)
            vFurLen = furLen;
            transformed += objectNormal * furLength * furLen * vShell;
            transformed.y -= furLength * furLen * 0.45 * vShell * vShell;`,
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + COMMON_FRAG_PARS)
          .replace(
            '#include <map_fragment>',
            /* glsl */ `#include <map_fragment>
            {
              if (eyeMaskAt(vRestPos) > 0.25 || vFurLen < 0.06) discard;
              vec3 fp = vRestPos * furDensity;
              vec3 cell = floor(fp);
              float rnd = furHash(cell);
              // délka chlupu se liší, některé buňky jsou prázdné
              float len = 0.55 + 0.45 * furHash(cell + 17.0);
              vec2 d2 = fract(fp).xy - 0.5 + (vec2(furHash(cell + 3.0), furHash(cell + 7.0)) - 0.5) * 0.35;
              float dist = length(d2) + abs(fract(fp).z - 0.5) * 0.35;
              float radius = 0.58 * (1.0 - vShell / len * 0.82);
              float strand = step(dist, radius) * step(vShell, len) * step(0.12, rnd);
              // v dálce jsou chlupy menší než pixel → přejít na plynulé pokrytí (dithering)
              float fw = length(fwidth(fp));
              float coverage = pow(1.0 - vShell, 1.6) * 0.75;
              float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + vShell * 7.0);
              float soft = step(noise, coverage);
              float keep = mix(strand, soft, smoothstep(0.9, 2.2, fw));
              if (keep < 0.5) discard;
              // u kořínků tmavší (vlastní stín srsti), špičky světlejší
              diffuseColor.rgb *= mix(0.68, 1.04, vShell);
            }`,
          )
          .replace(
            '#include <lights_fragment_end>',
            /* glsl */ `#include <lights_fragment_end>
            {
              vec3 gcell = floor(vRestPos * 1400.0);
              vec3 vdir = normalize(vViewPosition);
              float gh = furHash(gcell + floor(vdir * 9.0));
              float spark = smoothstep(0.972, 1.0, gh) * glitter * vShell;
              reflectedLight.directSpecular += reflectedLight.directDiffuse * spark * 2.6;
            }`,
          );
      };
      fur.customProgramCacheKey = () => 'tiger-fur';
      const shells = new THREE.SkinnedMesh(geo, fur);
      shells.name = 'tigerFur';
      shells.frustumCulled = false;
      shells.castShadow = false;
      shells.receiveShadow = true;
      mesh.parent!.add(shells);
      shells.position.copy(mesh.position);
      shells.quaternion.copy(mesh.quaternion);
      shells.scale.copy(mesh.scale);
      shells.bind(mesh.skeleton, mesh.bindMatrix);
      (this as { shells: THREE.SkinnedMesh | null }).shells = shells;
      this.furMat = fur;
      shells.visible = settings.data.fur;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.shells) this.shells.visible = on && this.lodLayers > 0;
  }

  /**
   * LOD srsti podle vzdálenosti kamery od Tigera. Když kameru přitlačí zeď až k tělu, srst zabere
   * celý obraz a všechny vrstvy by se překreslovaly přes sebe (nejdražší situace ve hře) –
   * proto se zblízka postupně ubírají vnější vrstvy, až zbyde jen hladká srst základní sítě.
   */
  setViewDistance(d: number): void {
    if (!this.shells) return;
    const full = this.uniforms.furLayers.value as number;
    const k = THREE.MathUtils.clamp((d - 0.2) / (0.62 - 0.2), 0, 1);
    const layers = Math.round(full * k);
    if (layers === this.lodLayers) return;
    this.lodLayers = layers;
    (this.shells.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.max(1, layers);
    this.shells.visible = this.enabled && layers > 0;
  }

  /** 0..1 – jak silně svítí tapetum (tma + světlo dopadající do očí). */
  setTapetum(v: number): void {
    this.uniforms.tapetum.value = v;
  }

  /** Najde oči podle zelené barvy duhovek v base color textuře. */
  private findEyes(mesh: THREE.SkinnedMesh, mat: THREE.MeshStandardMaterial): void {
    const head = this.model.rig.get('head');
    const fallback = () => {
      // odhad z kostry: po stranách osy hlavy
      const fwd = head.restDir.clone();
      const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
      const c = head.restPos.clone().addScaledVector(fwd, 0.055).add(new THREE.Vector3(0, 0.008, 0));
      return [c.clone().addScaledVector(side, 0.016), c.clone().addScaledVector(side, -0.016)];
    };
    let centers: THREE.Vector3[] | null = null;
    let radius = 0.0085;
    try {
      const img = mat.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
      if (img && img.width > 0) {
        const S = Math.min(1024, img.width);
        const canvas = document.createElement('canvas');
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, S, S);
        const data = ctx.getImageData(0, 0, S, S).data;
        const pos = mesh.geometry.getAttribute('position');
        const uv = mesh.geometry.getAttribute('uv');
        const flipY = mat.map!.flipY;
        const M = this.uniforms.restMatrix.value;
        const pts: THREE.Vector3[] = [];
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          const u = uv.getX(i);
          const w = uv.getY(i);
          const px = Math.min(S - 1, Math.max(0, Math.floor((u - Math.floor(u)) * S)));
          const vv = w - Math.floor(w);
          const py = Math.min(S - 1, Math.max(0, Math.floor((flipY ? 1 - vv : vv) * S)));
          const k = (py * S + px) * 4;
          const r = data[k];
          const g = data[k + 1];
          const b = data[k + 2];
          if (g > 95 && g - Math.max(r, b) > 26) {
            v.fromBufferAttribute(pos, i).applyMatrix4(M);
            // jen v okolí hlavy
            if (v.distanceTo(head.restPos) < 0.12) pts.push(v.clone());
          }
        }
        if (pts.length >= 12) {
          // 2-means
          let a = pts[0].clone();
          let b = pts.reduce((best, p) => (p.distanceTo(a) > best.distanceTo(a) ? p : best), pts[0]).clone();
          for (let it = 0; it < 12; it++) {
            const sa = new THREE.Vector3();
            const sb = new THREE.Vector3();
            let na = 0;
            let nb = 0;
            for (const p of pts) {
              if (p.distanceToSquared(a) < p.distanceToSquared(b)) {
                sa.add(p);
                na++;
              } else {
                sb.add(p);
                nb++;
              }
            }
            if (na) a = sa.divideScalar(na);
            if (nb) b = sb.divideScalar(nb);
          }
          if (a.distanceTo(b) > 0.012) {
            centers = [a, b];
            let maxD = 0;
            for (const p of pts) maxD = Math.max(maxD, Math.min(p.distanceTo(a), p.distanceTo(b)));
            radius = THREE.MathUtils.clamp(maxD * 1.25 + 0.0015, 0.006, 0.013);
          }
        }
      }
    } catch {
      centers = null;
    }
    if (!centers) centers = fallback();
    this.uniforms.eyeA.value.set(centers[0].x, centers[0].y, centers[0].z, radius);
    this.uniforms.eyeB.value.set(centers[1].x, centers[1].y, centers[1].z, radius);
    // značky připojené ke kosti hlavy
    const headBone = head.bone;
    const inv = new THREE.Matrix4().copy(headBone.matrixWorld).invert();
    this.model.root.updateMatrixWorld(true);
    for (const c of centers) {
      const m = new THREE.Object3D();
      m.position.copy(c).applyMatrix4(this.model.root.matrixWorld).applyMatrix4(inv);
      headBone.add(m);
      this.eyeMarkers.push(m);
    }
  }

  /**
   * Délka srsti po vrcholech: tenké části (vousky, okraje uší) mají srst kratší nebo žádnou,
   * na obličeji je kratší. Tloušťka se odhaduje hledáním protilehlé plochy (opačná normála).
   */
  private computeFurLength(mesh: THREE.SkinnedMesh): void {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const n = pos.count;
    const M = this.uniforms.restMatrix.value;
    const P = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      P[i * 3] = v.x;
      P[i * 3 + 1] = v.y;
      P[i * 3 + 2] = v.z;
    }
    const CELL = 0.006;
    const R = 0.012;
    const grid = new Map<number, number[]>();
    const keyOf = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    for (let i = 0; i < n; i++) {
      const k = keyOf(Math.floor(P[i * 3] / CELL), Math.floor(P[i * 3 + 1] / CELL), Math.floor(P[i * 3 + 2] / CELL));
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(i);
    }
    const ea = this.uniforms.eyeA.value;
    const eb = this.uniforms.eyeB.value;
    const fx = (ea.x + eb.x) / 2;
    const fy = (ea.y + eb.y) / 2 - 0.012;
    const fz = (ea.z + eb.z) / 2;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), cz = Math.floor(pz / CELL);
      let thick = Infinity;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
        const arr = grid.get(keyOf(cx + dx, cy + dy, cz + dz));
        if (!arr) continue;
        for (const j of arr) {
          const ox = P[j * 3] - px, oy = P[j * 3 + 1] - py, oz = P[j * 3 + 2] - pz;
          const d = Math.hypot(ox, oy, oz);
          if (d >= thick || d > R || d < 1e-5) continue;
          // j leží „za“ vrcholem i a má opačnou normálu
          if (nx * nor.getX(j) + ny * nor.getY(j) + nz * nor.getZ(j) > -0.4) continue;
          if (-(ox * nx + oy * ny + oz * nz) < d * 0.5) continue;
          thick = d;
        }
      }
      let len = thick === Infinity ? 1 : THREE.MathUtils.smoothstep(thick, 0.0022, 0.011);
      // obličej: kratší srst
      const fd = Math.hypot(px - fx, py - fy, pz - fz);
      len *= THREE.MathUtils.lerp(0.5, 1, THREE.MathUtils.smoothstep(fd, 0.025, 0.06));
      out[i] = len;
    }
    geo.setAttribute('furLen', new THREE.BufferAttribute(out, 1));
  }

  dispose(): void {
    this.furMat?.dispose();
  }
}
