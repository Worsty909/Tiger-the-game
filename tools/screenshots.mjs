// Klíčové záběry hry do screenshots/ (pro vizuální kontrolu realismu).
// Použití: npm run build && node tools/screenshots.mjs [quality=medium] [šířka=1280] [výška=720] [jen=a,b,c]
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startServer, openGame, root } from './lib/harness.mjs';

const [quality = 'medium', w = '1280', h = '720', only = ''] = process.argv.slice(2);
const want = (name) => !only || only.split(',').includes(name);
const server = await startServer();
mkdirSync(join(root, 'screenshots'), { recursive: true });
const out = (name) => join(root, 'screenshots', `${name}.png`);
const errors = [];

async function session(params, fn) {
  const { page, logs, close } = await openGame(server.url, { quality, width: Number(w), height: Number(h), params, test: params.includes('test=1') });
  try {
    await fn(page);
  } finally {
    errors.push(...logs.errors);
    await close();
  }
}
const frame = (page, n = 2) => page.evaluate((k) => { const d = window.__tigerDebug; d.setManual(true); for (let i = 0; i < k; i++) d.renderFrame(1 / 60); }, n);
const snap = async (page, name) => { await frame(page); await page.screenshot({ path: out(name), timeout: 600000 }); console.log('  ✔', name); };

try {
  // --- hlavní menu a intro (bez testovacího režimu)
  if (want('menu') || want('intro')) {
    await session('', async (page) => {
      await page.evaluate(() => { const d = window.__tigerDebug; d.setManual(true); d.simulate(1.5); });
      if (want('menu')) await snap(page, '01_menu');
      if (want('intro')) {
        await page.evaluate(() => { const d = window.__tigerDebug; d.game.flow.newGame(); d.simulate(2.2); });
        await snap(page, '02_intro_sleep');
        await page.evaluate(() => window.__tigerDebug.simulate(6.3));
        await snap(page, '03_intro_feeder');
        await page.evaluate(() => window.__tigerDebug.simulate(4.2));
        await snap(page, '04_intro_title');
      }
    });
  }
  // --- hra
  await session('test=1', async (page) => {
    const d = (fn, arg) => page.evaluate(fn, arg);
    await d(() => { const x = window.__tigerDebug; x.setManual(true); x.simulate(0.5); });
    if (want('start')) {
      await d(() => { const x = window.__tigerDebug; x.teleport(0.3, 0.02, 1.3, -1.9); x.look(-1.9, 0.16); x.simulate(0.4); });
      await snap(page, '05_gameplay_living');
    }
    if (want('window')) {
      await d(() => { const x = window.__tigerDebug; x.teleport(-1.1, 0.02, -0.9, -1.75); x.look(-1.75, 0.02); x.simulate(0.4); });
      await snap(page, '06_gameplay_window');
    }
    if (want('kitchen')) {
      await d(() => { const x = window.__tigerDebug; x.teleport(0.9, 0.02, 0.2, 2.6); x.look(2.6, 0.05); x.simulate(0.4); });
      await snap(page, '07_gameplay_kitchen');
    }
    if (want('senses')) {
      await d(() => { const x = window.__tigerDebug; x.teleport(-0.4, 0.02, -0.4, 1.3); x.look(1.3, 0.12); x.input(null, ['senses']); x.simulate(1.2); });
      await snap(page, '08_senses_scent');
      await d(() => { const x = window.__tigerDebug; x.input(null, []); x.simulate(0.4); });
    }
    if (want('aim')) {
      await d(() => { const x = window.__tigerDebug; x.teleport(-0.95, 0.02, 1.25, Math.PI); x.look(Math.PI, 0.3); x.simulate(0.3); x.input(null, ['jump']); x.simulate(0.6); });
      await snap(page, '09_aimed_jump');
      await d(() => { const x = window.__tigerDebug; x.input(null, []); x.simulate(1.2); });
    }
    if (want('overview')) {
      await d(() => { const x = window.__tigerDebug; x.teleport(-0.9, 0.02, -0.45, -1.57); x.simulate(0.3); x.shot(2.55, 1.75, 2.2, -0.9, 0.7, -0.5, 62); });
      await snap(page, '10_room_overview');
      await d(() => window.__tigerDebug.shot(-2.6, 1.5, 2.1, 1.2, 0.8, -1.2, 62));
      await snap(page, '11_room_kitchen_side');
      await d(() => window.__tigerDebug.clearShot());
    }
    if (want('lock')) {
      await d(() => { const x = window.__tigerDebug; x.gotoStep('lock'); x.teleport(2.05, 0.93, -2.08, Math.PI); x.simulate(0.3); x.tap('paw'); x.simulate(1.0); });
      await snap(page, '12_lock_closeup');
      await d(() => { const x = window.__tigerDebug; x.game.modalHandler?.('back'); x.simulate(0.5); });
    }
    if (want('sunset')) {
      await d(async () => { const x = window.__tigerDebug; x.setSunPhase(5); await x.finishBake(); x.teleport(0.3, 0.02, 1.3, -1.9); x.look(-1.9, 0.16); x.simulate(0.4); });
      await snap(page, '13_sunset_orange');
      await d(async () => { const x = window.__tigerDebug; x.setSunPhase(7); await x.finishBake(); x.simulate(0.4); });
      await snap(page, '14_sunset_dusk');
    }
    if (want('finale')) {
      await d(async () => { const x = window.__tigerDebug; x.solveStep('vacuum'); x.simulate(0.5); await x.finishBake(); x.teleport(-3.1, 0.02, -0.3, -Math.PI / 2); x.look(-Math.PI / 2, 0.2); x.input({ x: 0, y: 1 }); x.simulate(1.5); x.input(null); x.simulate(6.5); });
      await snap(page, '15_finale');
      await d(async () => { const x = window.__tigerDebug; x.simulate(34); await x.finishBake(); });
      await snap(page, '16_finale_blue_hour');
    }
  });
} finally {
  server.stop();
}
const uniq = [...new Set(errors)];
console.log(uniq.length ? 'CHYBY KONZOLE:\n' + uniq.join('\n') : 'Konzole bez chyb.');
process.exit(uniq.length ? 1 : 0);
