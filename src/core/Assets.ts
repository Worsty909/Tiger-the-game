import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { settings } from './Settings';
import { fallbackPBR, type FallbackKind } from '../world/ProcTextures';

const BASE = import.meta.env.BASE_URL;

export function assetUrl(path: string): string {
  return BASE + path.replace(/^\//, '');
}

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  armMap: THREE.Texture | null;
  procedural: boolean;
}

/** Načítání assetů s cache a procedurální náhradou při selhání. */
class AssetStore {
  private texLoader = new THREE.TextureLoader();
  private gltfLoader = new GLTFLoader();
  private hdrLoader = new HDRLoader();
  private texCache = new Map<string, Promise<THREE.Texture | null>>();
  private gltfCache = new Map<string, Promise<GLTF | null>>();
  readonly failed: string[] = [];
  onProgress: ((done: number, total: number) => void) | null = null;
  private total = 0;
  private done = 0;

  private track<T>(p: Promise<T>): Promise<T> {
    this.total++;
    return p.finally(() => {
      this.done++;
      this.onProgress?.(this.done, this.total);
    });
  }

  texture(path: string, srgb: boolean): Promise<THREE.Texture | null> {
    const key = path + (srgb ? '|s' : '|l');
    let p = this.texCache.get(key);
    if (!p) {
      p = this.track(
        this.texLoader
          .loadAsync(assetUrl(path))
          .then((t) => {
            t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = settings.preset.anisotropy;
            return t;
          })
          .catch(() => {
            this.failed.push(path);
            return null;
          }),
      );
      this.texCache.set(key, p);
    }
    return p;
  }

  /** PBR sada z Poly Haven (diff / nor / arm); při chybě procedurální náhrada. */
  async pbr(id: string, fallback: FallbackKind): Promise<PBRSet> {
    const dir = `assets/textures/${id}/`;
    const [map, normalMap, armMap] = await Promise.all([
      this.texture(dir + 'diff.jpg', true),
      this.texture(dir + 'nor.jpg', false),
      this.texture(dir + 'arm.jpg', false),
    ]);
    if (map && normalMap) return { map, normalMap, armMap, procedural: false };
    const fb = fallbackPBR(fallback);
    return { map: fb.map, normalMap: fb.normalMap, armMap: null, procedural: true };
  }

  gltf(path: string): Promise<GLTF | null> {
    let p = this.gltfCache.get(path);
    if (!p) {
      p = this.track(
        this.gltfLoader.loadAsync(assetUrl(path)).catch(() => {
          this.failed.push(path);
          return null;
        }),
      );
      this.gltfCache.set(path, p);
    }
    return p;
  }

  /** Model z Poly Haven: public/assets/models/<id>/<id>.gltf */
  async model(id: string): Promise<THREE.Group | null> {
    const g = await this.gltf(`assets/models/${id}/${id}.gltf`);
    if (!g) return null;
    const root = g.scene.clone(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const sm = mat as THREE.MeshStandardMaterial;
          for (const t of [sm.map, sm.normalMap, sm.roughnessMap, sm.metalnessMap, sm.aoMap]) {
            if (t) t.anisotropy = settings.preset.anisotropy;
          }
        }
      }
    });
    return root;
  }

  hdr(path: string): Promise<THREE.DataTexture | null> {
    return this.track(
      this.hdrLoader
        .loadAsync(assetUrl(path))
        .then((t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          t.wrapS = THREE.RepeatWrapping;
          t.minFilter = THREE.LinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.generateMipmaps = false;
          return t as THREE.DataTexture;
        })
        .catch(() => {
          this.failed.push(path);
          return null;
        }),
    );
  }

  /** Existuje soubor? (sloty pro zvuky a rigovaný model) */
  async exists(path: string): Promise<boolean> {
    try {
      const res = await fetch(assetUrl(path), { method: 'HEAD' });
      const type = res.headers.get('content-type') ?? '';
      // Vite dev server vrací pro neexistující soubory index.html (200, text/html)
      return res.ok && !type.includes('text/html');
    } catch {
      return false;
    }
  }
}

export const assets = new AssetStore();
