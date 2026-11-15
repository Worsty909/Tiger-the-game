// Jednorázový screenshot: node tools/shot.mjs <název> [quality] [px,py,pz,tx,ty,tz[,fov]] [phase] [w] [h]
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startServer, openGame, renderFrames, root } from './lib/harness.mjs';

const [name = 'shot', quality = 'low', cam = '', phase = '0', w = '1280', h = '720', params = ''] = process.argv.slice(2);
const server = await startServer();
const t0 = Date.now();
const { page, logs, close } = await openGame(server.url, { quality, width: Number(w), height: Number(h), params });
console.log(`načteno za ${((Date.now() - t0) / 1000).toFixed(1)} s`);
try {
  if (Number(phase) !== 0) {
    await page.evaluate(async (p) => {
      window.__tigerDebug.setSunPhase(p, true);
      await window.__tigerDebug.finishBake();
    }, Number(phase));
  }
  if (cam) {
    const v = cam.split(',').map(Number);
    await page.evaluate((a) => window.__tigerDebug.shot(a[0], a[1], a[2], a[3], a[4], a[5], a[6] ?? 55), v);
  }
  const ms = await renderFrames(page, 3);
  mkdirSync(join(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: join(root, 'screenshots', `${name}.png`), timeout: 300000 });
  const st = await page.evaluate(() => window.__tigerDebug.state());
  console.log(`snímek ${ms.toFixed(0)} ms`, JSON.stringify(st));
} finally {
  if (logs.errors.length) console.log('CHYBY KONZOLE:\n' + [...new Set(logs.errors)].slice(0, 12).join('\n'));
  if (logs.warnings.length) console.log('VAROVÁNÍ:\n' + [...new Set(logs.warnings)].slice(0, 12).join('\n'));
  await close();
  server.stop();
}
