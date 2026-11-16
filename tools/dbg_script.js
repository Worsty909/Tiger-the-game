// Ladicí skript pro `node tools/dbg.mjs [quality] [šířka] [výška] [parametry]`.
// K dispozici: page (Playwright), shot(název) → screenshots/<název>.png, renderFrames(page, n).
// Příklad: skok na krok se zámkem a snímek detailu.
await page.evaluate(() => {
  const d = window.__tigerDebug;
  d.setManual(true);
  d.simulate(0.3);
  d.gotoStep('lock');
  d.simulate(1.0);
});
await shot('dbg_example');
