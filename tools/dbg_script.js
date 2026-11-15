await page.evaluate(() => { const d = window.__tigerDebug; d.shot(-2.3,0.3,-1.0,-3.0,0.0,-1.7,50); });
await shot('m1_c');
await page.evaluate(() => { const d = window.__tigerDebug; d.shot(-1.2,1.3,1.6,2.2,0.9,-1.8,62); });
await shot('m1_d');
