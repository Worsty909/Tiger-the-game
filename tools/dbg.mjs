// Ladicí běh: node tools/dbg.mjs <quality> <w> <h> <params> -- pak čte příkazy JS ze souboru tools/dbg_script.js
import { join } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { startServer, openGame, renderFrames, root } from './lib/harness.mjs';

const [quality = 'low', w = '640', h = '360', params = '', script = 'tools/dbg_script.js'] = process.argv.slice(2);
const server = await startServer();
const { page, logs, close } = await openGame(server.url, { quality, width: Number(w), height: Number(h), params, test: !process.env.TIGER_NOTEST });
mkdirSync(join(root, 'screenshots'), { recursive: true });
const shot = async (name) => {
  await renderFrames(page, 2);
  await page.screenshot({ path: join(root, 'screenshots', `${name}.png`), timeout: 300000 });
};
try {
  const code = readFileSync(join(root, script), 'utf8');
  const fn = new Function('page', 'shot', 'renderFrames', `return (async () => { ${code} })();`);
  await fn(page, shot, renderFrames);
} finally {
  if (logs.errors.length) console.log('CHYBY KONZOLE:\n' + [...new Set(logs.errors)].slice(0, 12).join('\n'));
  if (logs.warnings.length) console.log('VAROVÁNÍ:\n' + [...new Set(logs.warnings)].slice(0, 8).join('\n'));
  await close();
  server.stop();
}
