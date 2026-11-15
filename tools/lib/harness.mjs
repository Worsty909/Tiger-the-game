// Společné pomůcky pro Playwright testy: spustí `vite preview` nad dist/ a otevře hru.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.TIGER_PORT ?? 4173);

export async function startServer() {
  if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Chybí dist/ – nejdřív spusť `npm run build`.');
  const proc = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const url = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return { url, stop: () => proc.kill() };
    } catch {
      /* ještě neběží */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  proc.kill();
  throw new Error('vite preview nenaběhl:\n' + out);
}

/**
 * Otevře hru a počká na načtení.
 * @returns {{ page, browser, logs: {errors: string[], warnings: string[]}, close: () => Promise<void> }}
 */
export async function openGame(url, { quality = 'low', width = 1280, height = 720, params = '', timeout = 600000, scale = 1 } = {}) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const logs = { errors: [], warnings: [] };
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') logs.errors.push(msg.text());
    else if (t === 'warning') logs.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => logs.errors.push('pageerror: ' + err.message));
  page.on('requestfailed', (req) => logs.errors.push('requestfailed: ' + req.url()));
  await page.goto(`${url}?quality=${quality}&test=1${params ? '&' + params : ''}`);
  await page.waitForFunction(() => window.__tigerDebug && window.__tigerDebug.ready, null, { timeout });
  return { page, browser, logs, close: () => browser.close() };
}

/** Vykreslí n snímků ručně (deterministicky) a vrátí průměrný čas snímku v ms. */
export async function renderFrames(page, n = 2, dt = 1 / 60) {
  return page.evaluate(
    ([count, step]) => {
      const d = window.__tigerDebug;
      d.setManual(true);
      const t0 = performance.now();
      for (let i = 0; i < count; i++) d.renderFrame(step);
      return (performance.now() - t0) / count;
    },
    [n, dt],
  );
}
