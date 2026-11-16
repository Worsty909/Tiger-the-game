// Měření výkonu na zvolené předvolbě kvality.
// Použití: npm run build && node tools/fps.mjs [quality=high] [šířka=1920] [výška=1080]
//
// Pozor: bez skutečné grafické karty běží Chromium na softwarovém rasterizéru (SwiftShader) a čísla
// jsou pak řádově nižší než na GPU – skript proto vždy vypíše i řetězec WebGL rendereru.
// Na stroji s GPU spusť `TIGER_GPU=1 node tools/fps.mjs high 1920 1080` (případně s TIGER_HEADED=1).
import { startServer, openGame } from './lib/harness.mjs';

const [quality = 'high', w = '1920', h = '1080'] = process.argv.slice(2);

/** Stanoviště: [název, x, y, z, yaw kočky, yaw kamery, sklon kamery]. */
const VIEWS = [
  ['obývák (od křesla k oknu)', 0.3, 0.02, 1.3, -1.9, -1.9, 0.16],
  ['okno a paprsky', -1.1, 0.02, -0.9, -1.75, -1.75, 0.02],
  ['kuchyň', 0.9, 0.02, 0.2, 2.6, 2.6, 0.05],
  ['celý pokoj (od lednice)', 2.3, 0.02, -1.0, -1.2, -1.2, 0.22],
  ['kamera přitlačená zdí k Tigerovi', 2.7, 0.02, 1.0, -1.57, -1.57, 0.25],
];

const server = await startServer();
const { page, logs, close } = await openGame(server.url, { quality, width: Number(w), height: Number(h), params: 'test=1' });
let failed = false;
try {
  const gpu = await page.evaluate(() => {
    const gl = window.__tigerDebug.game.gfx.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  const software = /swiftshader|llvmpipe|software/i.test(gpu);
  console.log(`Předvolba: ${quality} · ${w}×${h}`);
  console.log(`WebGL renderer: ${gpu}${software ? '  ← SOFTWAROVÝ RASTERIZÉR (čísla neodpovídají GPU)' : ''}`);
  await page.evaluate(() => { const d = window.__tigerDebug; d.setManual(true); d.simulate(0.5); });

  const rows = [];
  for (const [name, x, y, z, yaw, camYaw, pitch] of VIEWS) {
    const r = await page.evaluate(
      ([x, y, z, yaw, camYaw, pitch]) => {
        const d = window.__tigerDebug;
        const gl = d.game.gfx.renderer.getContext();
        d.teleport(x, y, z, yaw);
        d.look(camYaw, pitch);
        d.simulate(1.5); // kamera se po teleportu ustálí ve výchozí vzdálenosti
        // gl.finish() v Chromiu neblokuje – skutečné dokončení snímku vynutí až čtení pixelu zpět
        const px = new Uint8Array(4);
        const sync = () => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        };
        const measure = (n) => {
          d.renderFrame(1 / 60); // zahřátí (kompilace shaderů)
          sync();
          const t0 = performance.now();
          for (let i = 0; i < n; i++) {
            d.renderFrame(1 / 60);
            sync();
          }
          return (performance.now() - t0) / n;
        };
        let ms = measure(3);
        if (ms < 60) ms = measure(180);
        return { ms, calls: d.game.gfx.info.calls, tris: d.game.gfx.info.triangles };
      },
      [x, y, z, yaw, camYaw, pitch],
    );
    rows.push({ name, ...r });
    console.log(`  ${name.padEnd(40)} ${r.ms.toFixed(2).padStart(9)} ms  ${(1000 / r.ms).toFixed(1).padStart(7)} FPS  ${String(r.calls).padStart(4)} draw calls  ${(r.tris / 1000).toFixed(0).padStart(5)}k trojúhelníků`);
  }
  const avg = rows.reduce((s, r) => s + r.ms, 0) / rows.length;
  const worst = Math.max(...rows.map((r) => r.ms));
  console.log(`Průměr: ${avg.toFixed(2)} ms (${(1000 / avg).toFixed(1)} FPS) · nejhorší záběr: ${worst.toFixed(2)} ms (${(1000 / worst).toFixed(1)} FPS)`);
  if (!software) console.log(1000 / worst >= 60 ? 'CÍL 60 FPS: SPLNĚN' : 'CÍL 60 FPS: NESPLNĚN');
  if (logs.errors.length) {
    failed = true;
    console.log('CHYBY KONZOLE:\n' + [...new Set(logs.errors)].join('\n'));
  }
} finally {
  await close();
  server.stop();
}
process.exit(failed ? 1 : 0);
