// Stáhne CC0 assety z Poly Haven podle tools/assets.manifest.json do public/assets/.
// Použití: node tools/fetch_assets.mjs [--force]
// (Za firemní proxy spusť s NODE_USE_ENV_PROXY=1.)
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'assets');
const force = process.argv.includes('--force');
const UA = { 'User-Agent': 'tiger-the-game-asset-fetch/1.0' };

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function download(url, dest) {
  if (!force && (await exists(dest))) return false;
  await mkdir(dirname(dest), { recursive: true });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch (e) {
      if (attempt === 4) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function files(id) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA });
  if (!res.ok) throw new Error(`files/${id}: HTTP ${res.status}`);
  return res.json();
}

const manifest = JSON.parse(await readFile(join(root, 'tools', 'assets.manifest.json'), 'utf8'));
let count = 0;
const failed = [];

for (const m of manifest.models) {
  try {
    const f = await files(m.id);
    const g = f.gltf[m.res].gltf;
    const dir = join(out, 'models', m.id);
    if (await download(g.url, join(dir, `${m.id}.gltf`))) count++;
    for (const [rel, inc] of Object.entries(g.include ?? {})) {
      if (await download(inc.url, join(dir, rel))) count++;
    }
    console.log('model  ', m.id);
  } catch (e) {
    failed.push(m.id);
    console.warn('CHYBA model', m.id, e.message);
  }
}

// U textur bereme: Diffuse, nor_gl a arm (AO/Rough/Metal v jednom) – vše JPG.
for (const t of manifest.textures) {
  try {
    const f = await files(t.id);
    const dir = join(out, 'textures', t.id);
    const maps = { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' };
    for (const [short, key] of Object.entries(maps)) {
      const entry = f[key]?.[t.res]?.jpg;
      if (!entry) { console.warn('  chybí mapa', t.id, key); continue; }
      if (await download(entry.url, join(dir, `${short}.jpg`))) count++;
    }
    console.log('texture', t.id);
  } catch (e) {
    failed.push(t.id);
    console.warn('CHYBA textura', t.id, e.message);
  }
}

for (const h of manifest.hdris) {
  try {
    const f = await files(h.id);
    const entry = f.hdri[h.res].hdr;
    if (await download(entry.url, join(out, 'hdri', `${h.id}.hdr`))) count++;
    console.log('hdri   ', h.id);
  } catch (e) {
    failed.push(h.id);
    console.warn('CHYBA hdri', h.id, e.message);
  }
}

console.log(`Hotovo, staženo ${count} nových souborů.` + (failed.length ? ` Selhalo: ${failed.join(', ')}` : ''));
if (failed.length) process.exitCode = 1;
