const tp = (x, z, act = 'none') => page.evaluate(([x, z, a]) => { const d = window.__tigerDebug; d.input(null, []); d.teleport(x, 0.02, z, -Math.PI / 2); d.action(a); }, [x, z, act]);
await page.evaluate(() => { const d = window.__tigerDebug; d.setManual(true); d.look(-Math.PI / 2, 0.2); d.renderFrame(0.016); });
await tp(-0.3, -0.3);
await page.evaluate(() => { const d = window.__tigerDebug; d.input(null, []); d.simulate(0.6); const h = d.game.tiger.anim.headPos; 
  d.shot(h.x - 0.26, h.y + 0.03, h.z - 0.17, h.x, h.y - 0.01, h.z, 28); d.game.camera.update(0.016); d.game.gfx.render(0.016); });
await page.screenshot({ path: 'screenshots/furA_face.png', timeout: 300000 });
await page.evaluate(() => { const d = window.__tigerDebug; d.game.tiger.fur.setTapetum(1.0); const h = d.game.tiger.anim.headPos; 
  d.shot(h.x - 0.5, h.y + 0.1, h.z - 0.45, h.x + 0.12, h.y - 0.08, h.z, 30); d.game.camera.update(0.016); d.game.gfx.render(0.016); });
await page.screenshot({ path: 'screenshots/furA_body.png', timeout: 300000 });
