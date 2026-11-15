import * as THREE from 'three';

/** Procedurální textury (canvas) – náhrada za stažené PBR sady a zdroj drobných map. */

export type FallbackKind = 'wood' | 'plaster' | 'fabric' | 'tile' | 'stone' | 'roof';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

export function canvasTexture(canvas: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Deterministický generátor náhodných čísel (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dlaždicovatelný hodnotový šum (několik oktáv) do Float32Array [0..1]. */
export function tileNoise(size: number, baseFreq: number, octaves: number, seed: number, stretchX = 1, stretchY = 1): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const fx = Math.max(1, Math.round(baseFreq * 2 ** o * stretchX));
    const fy = Math.max(1, Math.round(baseFreq * 2 ** o * stretchY));
    const r = rng(seed + o * 101);
    const grid = new Float32Array(fx * fy);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * fy;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const ya = (y0 % fy) * fx;
      const yb = ((y0 + 1) % fy) * fx;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * fx;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % fx;
        const xb = (x0 + 1) % fx;
        const a = grid[ya + xa] + (grid[ya + xb] - grid[ya + xa]) * sx;
        const b = grid[yb + xa] + (grid[yb + xb] - grid[yb + xa]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Normálová mapa z výškového pole (dlaždicovatelná). */
export function normalFromHeight(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = height[y * size + ((x - 1 + size) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yu = height[((y - 1 + size) % size) * size + x];
      const yd = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength;
      let ny = (yd - yu) * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c, false);
}

function colorFromHeight(height: Float32Array, size: number, dark: [number, number, number], light: [number, number, number], contrast = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const t = Math.min(1, Math.max(0, (height[i] - 0.5) * contrast + 0.5));
    img.data[i * 4] = dark[0] + (light[0] - dark[0]) * t;
    img.data[i * 4 + 1] = dark[1] + (light[1] - dark[1]) * t;
    img.data[i * 4 + 2] = dark[2] + (light[2] - dark[2]) * t;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c, true);
}

const fallbackCache = new Map<string, { map: THREE.Texture; normalMap: THREE.Texture }>();

/** Náhradní PBR sada, když se nepodaří stáhnout textury z Poly Haven. */
export function fallbackPBR(kind: FallbackKind): { map: THREE.Texture; normalMap: THREE.Texture } {
  const hit = fallbackCache.get(kind);
  if (hit) return hit;
  const S = 512;
  let h: Float32Array;
  let map: THREE.Texture;
  let strength = 2;
  switch (kind) {
    case 'wood': {
      h = tileNoise(S, 3, 5, 11, 1, 14);
      const fine = tileNoise(S, 40, 2, 12, 1, 6);
      for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.75 + fine[i] * 0.25;
      map = colorFromHeight(h, S, [120, 82, 48], [196, 150, 100], 1.6);
      strength = 1.2;
      break;
    }
    case 'fabric': {
      h = new Float32Array(S * S);
      const n = tileNoise(S, 32, 2, 21);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const weave = (Math.sin((x / S) * Math.PI * 2 * 96) * Math.sin((y / S) * Math.PI * 2 * 96)) * 0.5 + 0.5;
        h[y * S + x] = weave * 0.7 + n[y * S + x] * 0.3;
      }
      map = colorFromHeight(h, S, [150, 150, 150], [205, 205, 205], 0.8);
      strength = 3;
      break;
    }
    case 'tile': {
      h = new Float32Array(S * S);
      const n = tileNoise(S, 8, 4, 31);
      const cells = 4;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = ((x / S) * cells) % 1;
        const v = ((y / S) * cells) % 1;
        const grout = Math.min(u, 1 - u, v, 1 - v) < 0.015 ? 0 : 1;
        h[y * S + x] = grout * (0.8 + n[y * S + x] * 0.2);
      }
      map = colorFromHeight(h, S, [120, 116, 108], [222, 216, 204], 1);
      strength = 4;
      break;
    }
    case 'roof': {
      h = new Float32Array(S * S);
      const n = tileNoise(S, 10, 3, 41);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const row = Math.floor((y / S) * 10);
        const u = (((x / S) * 8 + (row % 2) * 0.5) % 1);
        const v = ((y / S) * 10) % 1;
        h[y * S + x] = (Math.sin(u * Math.PI) * 0.6 + v * 0.4) * (0.7 + n[y * S + x] * 0.3);
      }
      map = colorFromHeight(h, S, [96, 44, 28], [190, 96, 58], 1.2);
      strength = 5;
      break;
    }
    case 'stone': {
      h = tileNoise(S, 6, 6, 51);
      map = colorFromHeight(h, S, [118, 114, 108], [186, 182, 174], 1.4);
      strength = 3;
      break;
    }
    default: {
      h = tileNoise(S, 12, 5, 61);
      map = colorFromHeight(h, S, [205, 203, 198], [240, 238, 232], 1);
      strength = 1.5;
    }
  }
  const res = { map, normalMap: normalFromHeight(h, S, strength) };
  fallbackCache.set(kind, res);
  return res;
}

let _brushed: THREE.Texture | null = null;
/** Jemně kartáčovaný kov – normálová mapa s vodorovnými vlásečnicemi. */
export function brushedMetalNormal(): THREE.Texture {
  if (_brushed) return _brushed;
  const S = 256;
  const h = tileNoise(S, 2, 6, 71, 1, 96);
  _brushed = normalFromHeight(h, S, 1.4);
  return _brushed;
}

let _micro: THREE.Texture | null = null;
/** Mikro-nerovnosti (lak, plast, nátěr) – velmi jemná normálová mapa. */
export function microNormal(): THREE.Texture {
  if (_micro) return _micro;
  const S = 256;
  const h = tileNoise(S, 48, 3, 81);
  _micro = normalFromHeight(h, S, 0.9);
  return _micro;
}

let _rough: THREE.Texture | null = null;
/** Šmouhy a otisky – mapa drsnosti (G kanál) pro lesklé povrchy. */
export function smudgeRoughness(): THREE.Texture {
  if (_rough) return _rough;
  const S = 256;
  const a = tileNoise(S, 3, 5, 91);
  const b = tileNoise(S, 14, 3, 92, 3, 1);
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = Math.min(1, Math.max(0, 0.55 + (a[i] - 0.5) * 0.9 + (b[i] - 0.5) * 0.35));
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = v * 255;
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _rough = canvasTexture(c, false);
  return _rough;
}

/** Měkký kruhový gradient (falešný kontaktní stín, částice). */
export function radialTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', hardness = 0): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, (size / 2) * hardness, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = canvasTexture(c, true, false);
  return t;
}
