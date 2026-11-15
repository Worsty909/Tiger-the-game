const out = await page.evaluate(() => { const d = window.__tigerDebug; const g = d.game; d.setManual(true); d.simulate(0.3);
  d.teleport(-0.72, 2.21, -2.33, Math.PI / 2); d.simulate(0.3);
  const p = g.ctx.refs.pendant; const top = p.top;
  const ok = d.jumpTo(top.x - 0.08, top.y, top.z - 0.05); d.simulate(1.0);
  const log = [];
  let maxV = 0, maxAng = 0, okCount = 0;
  for (let i = 0; i < 180; i++) { d.simulate(1/30); const pv = g.cat.platformVelocity; const v = Math.hypot(pv.x, pv.z); maxV = Math.max(maxV, v); maxAng = Math.max(maxAng, Math.abs(p.angle));
    const can = d.canReach(1.95, 2.25, -2.3); if (can) okCount++;
    if (i % 12 === 0) log.push({ ang: +p.angle.toFixed(3), vel: +p.vel.toFixed(2), pv: [+pv.x.toFixed(2), +pv.y.toFixed(2), +pv.z.toFixed(2)], tag: g.cat.groundTag, pos: g.cat.position.toArray().map(v => +v.toFixed(2)), can }); }
  return { ok, maxV, maxAng, okCount, swingDir: p.swingDir.toArray(), log }; });
console.log(JSON.stringify(out, null, 0));
