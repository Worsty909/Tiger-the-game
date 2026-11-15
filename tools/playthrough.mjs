// Automatický průchod hrou přes debug API (window.__tigerDebug).
// Vyřeší všechny kroky ve správném pořadí skutečnými herními akcemi (skoky, E/F, zámek, vysavač),
// ověří závěrečný stav a že konzole neobsahuje chyby.
// Použití: npm run build && node tools/playthrough.mjs [quality]
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startServer, openGame, root } from './lib/harness.mjs';

const quality = process.argv[2] ?? 'low';
const server = await startServer();
const { page, logs, close } = await openGame(server.url, { quality, width: 960, height: 540, params: 'fur=0' });
mkdirSync(join(root, 'screenshots'), { recursive: true });

let failed = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};
const dbg = (fn, arg) => page.evaluate(fn, arg);
const state = () => dbg(() => window.__tigerDebug.state());
const sim = (sec, move = null, held = []) => dbg(([s, m, h]) => { const d = window.__tigerDebug; d.input(m, h); d.simulate(s); }, [sec, move, held]);
const tp = (x, y, z, yaw = 0) => dbg(([x, y, z, yaw]) => { const d = window.__tigerDebug; d.input(null, []); d.teleport(x, y, z, yaw); d.simulate(0.25); }, [x, y, z, yaw]);
const tap = (a) => dbg((a) => window.__tigerDebug.tap(a), a);
const solved = async (id) => (await state()).solved.includes(id);
const shot = async (name) => {
  await dbg(() => { const d = window.__tigerDebug; d.renderFrame(1 / 60); d.renderFrame(1 / 60); });
  await page.screenshot({ path: join(root, 'screenshots', `play_${name}.png`), timeout: 300000 });
};
/** Zavře otevřený detail stopy (E). */
const closeReader = async () => {
  const s = await state();
  if (s.modal === 'reader') await tap('paw');
  return s.modal === 'reader';
};

try {
  await dbg(() => { const d = window.__tigerDebug; d.setManual(true); d.simulate(0.5); });
  let s = await state();
  check(s.state === 'playing', 'hra běží', s.state);
  check(s.active.includes('scent'), 'aktivní krok: čich');

  // ---------------------------------------------------------------- dosažitelnost skoků (parkour)
  console.log('Parkour – dosažitelnost:');
  const reach = (from, to) => dbg(([a, b]) => window.__tigerDebug.canReachFrom(a, b), [from, to]);
  check(!(await reach([2.0, 0.01, -1.6], [2.0, 0.92, -2.15])), 'ze země se na linku nedá vyskočit');
  check(await reach([-0.6, 0.01, -1.0], [0.02, 0.64, -1.0]), 'ze země na barovou židli');
  check(await reach([0.02, 0.64, -1.0], [0.42, 0.92, -1.0]), 'z barové židle na pult');
  check(!(await reach([-2.2, 0.01, -1.6], [-2.95, 0.98, -1.6])), 'ze země se na parapet nedá vyskočit');
  check(await reach([-2.45, 0.468, -1.6], [-2.98, 0.98, -1.6]), 'z taburetu na parapet');
  check(await reach([-2.98, 0.98, -2.12], [-2.5, 1.68, -2.37]), 'z parapetu na závěsnou polici');
  check(await reach([-2.15, 1.68, -2.37], [-1.45, 2.2, -2.33]), 'ze závěsné police na knihovnu');
  check(!(await reach([-2.45, 0.468, -1.6], [-2.5, 1.68, -2.37])), 'z taburetu se na závěsnou polici nedá vyskočit');
  check(!(await reach([-0.7, 2.2, -2.33], [1.9, 2.25, -2.32])), 'z knihovny přímo na horní skříňky to nejde');
  check(!(await reach([0.5, 0.92, -1.0], [0.6, 1.95, -1.15])), 'z pultu se na svítidlo nedá vyskočit');

  // ---------------------------------------------------------------- 1. čich
  console.log('Krok 1 – čich:');
  await sim(1.0, null, ['senses']);
  await shot('1_senses');
  await sim(0.2, null, []);
  // falešná stopa: koš s plechovkou
  await tp(-0.2, 0.02, -2.2, Math.PI / 2);
  s = await state();
  check(s.prompt === 'trashBin', 'výzva „Shodit koš“', String(s.prompt));
  await tap('push');
  await sim(2.5);
  check((await dbg(() => window.__tigerDebug.flags())).binTipped === true, 'koš se převrátil, vykutálela se plechovka');
  check((await state()).journal.includes('tuna'), 'falešná stopa „tuňák“ v deníku');
  await tp(2.0, 0.02, -1.45, Math.PI);
  await sim(0.4);
  check(await solved('scent'), 'čich vyřešen (jantarová stopa ke skříňce)');

  // ---------------------------------------------------------------- 2. lísteček
  console.log('Krok 2 – lísteček na lednici:');
  await tp(2.15, 0.93, -2.1, Math.PI / 2);
  s = await state();
  check(s.pos[1] > 0.85, 'Tiger stojí na lince', `y=${s.pos[1]}`);
  // na lince magnet nedosáhne
  check(s.prompt !== 'magnet', 'ze stoje na magnet nedosáhne');
  // výskok u lednice a švih ve vzduchu
  const magnet = await dbg(() => window.__tigerDebug.game.ctx.refs.fridge.magnetPos.toArray());
  await tp(2.2, 0.93, -1.98, Math.PI / 2);
  await dbg(() => { const d = window.__tigerDebug; d.input(null, ['jump']); d.simulate(1 / 60); d.input(null, []); });
  let swiped = false;
  for (let i = 0; i < 40 && !swiped; i++) {
    await sim(1 / 60);
    s = await state();
    if (s.mode === 'air' && s.prompt === 'magnet') {
      await tap('paw');
      swiped = true;
    }
  }
  check(swiped, 've skoku se objevila výzva „Švihnout!“', `magnet y=${magnet[1].toFixed(2)}`);
  await sim(3.0);
  await tp(2.55, 0.02, -1.5, Math.PI);
  s = await state();
  check(s.prompt === 'noteUnder', 'lísteček zajel pod lednici (výzva „Vyhrabat“)', String(s.prompt));
  for (let i = 0; i < 4; i++) { await tap('paw'); await sim(0.3); }
  await sim(0.8);
  s = await state();
  check(s.modal === 'reader', 'otevřel se detail lístečku');
  await shot('2_note');
  await closeReader();
  await sim(0.3);
  check(await solved('note'), 'lísteček vyřešen');

  // ---------------------------------------------------------------- 3. falešné stopy
  console.log('Krok 3 – falešné stopy:');
  for (const [id, x, y, z, yaw] of [['calendar', -0.05, 0.02, -1.9, Math.PI], ['wedding', -2.2, 0.02, 1.7, -Math.PI / 2], ['tvpin', -1.5, 0.02, 1.95, 0]]) {
    await tp(x, y, z, yaw);
    s = await state();
    check(s.prompt === 'clue_' + id, `výzva u stopy „${id}“`, String(s.prompt));
    await tap('paw');
    await sim(0.2);
    check((await state()).modal === 'reader', `detail stopy „${id}“`);
    await closeReader();
    await sim(0.2);
  }
  check(await solved('falseClues'), 'falešné stopy zapsány v deníku');

  // ---------------------------------------------------------------- 4. průkaz pod gaučem
  console.log('Krok 4 – průkaz pod gaučem:');
  const card = await dbg(() => window.__tigerDebug.game.ctx.refs.card.pos.toArray());
  // vestoje se pod gauč nevejde
  await tp(card[0], 0.02, -0.25, 0);
  await sim(1.2, { x: 0, y: 1 });
  s = await state();
  check(s.pos[2] < 0.05, 'vestoje se pod gauč nedostane', `z=${s.pos[2]}`);
  // plížení
  for (let i = 0; i < 60; i++) {
    await sim(0.1, { x: 0, y: 1 }, ['crouch']);
    s = await state();
    if (s.pos[2] > card[2] - 0.22) break;
  }
  check(s.crouching && s.pos[2] > 0.12, 'proplížil se pod gauč', `z=${s.pos[2]}`);
  await sim(0.6, null, ['crouch', 'senses']);
  await shot('4_under_sofa');
  s = await state();
  check(s.prompt === 'card', 'výzva „Vytáhnout“', String(s.prompt));
  await dbg(() => { const d = window.__tigerDebug; d.input(null, ['crouch']); d.tap('paw'); });
  await sim(0.6, null, ['crouch']);
  check((await state()).modal === 'reader', 'detail očkovacího průkazu');
  await closeReader();
  await sim(0.2);
  check(await solved('card'), 'průkaz vyřešen');

  // ---------------------------------------------------------------- 5. parkour a fotka
  console.log('Krok 5 – parkour a fotka:');
  // taburet se dá strkat (F)
  const tb0 = await dbg(() => window.__tigerDebug.bodyPos('taburet'));
  await tp(tb0[0], 0.02, tb0[2] + 0.55, Math.PI);
  await tap('push');
  await sim(1.2);
  const tb1 = await dbg(() => window.__tigerDebug.bodyPos('taburet'));
  check(tb1[2] < tb0[2] - 0.08, 'strčením (F) se taburet posunul', `${tb0[2]} → ${tb1[2]}`);
  // dostrkání pod parapet (zkráceno přesunem)
  await dbg(() => window.__tigerDebug.moveBody('taburet', -2.45, 0.234, -1.6));
  await sim(0.5);
  check((await dbg(() => window.__tigerDebug.flags())).taburetPlaced === true, 'taburet je pod parapetem');
  // skutečné skoky: země → taburet → parapet → police → knihovna
  await tp(-1.8, 0.02, -1.6, -Math.PI / 2);
  const hop = async (x, y, z, label) => {
    const ok = await dbg(([x, y, z]) => window.__tigerDebug.jumpTo(x, y, z), [x, y, z]);
    await sim(1.0);
    const st2 = await state();
    check(ok && Math.abs(st2.pos[1] - y) < 0.08, label, `y=${st2.pos[1]} tag=${st2.groundTag}`);
    return st2;
  };
  await hop(-2.45, 0.468, -1.6, 'skok na taburet');
  await hop(-2.98, 0.98, -1.75, 'skok na parapet');
  await tp(-2.98, 0.99, -2.1, 0);
  const okShelf = await dbg(() => window.__tigerDebug.jumpTo(-2.5, 1.68, -2.37));
  await sim(0.75);
  s = await state();
  check(okShelf && s.groundTag === 'hangShelf', 'skok na závěsnou polici', `y=${s.pos[1]} tag=${s.groundTag}`);
  // do 2 s dál na knihovnu
  const okTop = await dbg(() => window.__tigerDebug.jumpTo(-1.4, 2.2, -2.33));
  await sim(1.0);
  s = await state();
  check(okTop && s.groundTag === 'bookshelf', 'skok na vršek knihovny', `y=${s.pos[1]} tag=${s.groundTag}`);
  // police: kdo se zdrží, sklouzne
  await tp(-2.4, 1.69, -2.38, Math.PI / 2);
  await sim(3.2);
  s = await state();
  check(s.pos[1] < 1.3, 'na polici se nedá zůstat – po 2 s Tiger sklouzne', `y=${s.pos[1]}`);
  // shodit fotku
  const frame = await dbg(() => window.__tigerDebug.game.ctx.refs.kittenFrame.home.toArray());
  await tp(frame[0] - 0.32, 2.21, frame[2], Math.PI / 2);
  await shot('5_bookshelf_top');
  s = await state();
  check(s.prompt === 'kittenFrame', 'výzva „Shodit“ u fotky', String(s.prompt));
  await tap('push');
  await sim(2.5);
  const kf = await dbg(() => { const k = window.__tigerDebug.game.ctx.refs.kittenFrame; return { state: k.state, pos: k.photoPos ? k.photoPos.toArray() : null }; });
  check(kf.state === 'broken', 'rám se na zemi rozbil', kf.state);
  await tp(kf.pos[0] + 0.3, 0.02, kf.pos[2] + 0.25, -2.3);
  await shot('5_broken_frame');
  s = await state();
  check(s.prompt === 'kittenPhoto', 'výzva „Prohlédnout fotku“', String(s.prompt));
  await tap('paw');
  await sim(0.2);
  check((await state()).modal === 'reader', 'detail fotky koťátka (rub s datem)');
  await shot('5_photo');
  await closeReader();
  await sim(0.2);
  check(await solved('photo'), 'fotka vyřešena');

  // ---------------------------------------------------------------- 6. kódový zámek
  console.log('Krok 6 – kódový zámek:');
  await tp(2.05, 0.93, -2.08, Math.PI);
  s = await state();
  check(s.prompt === 'lock', 'výzva „Otáčet kolečky“', String(s.prompt));
  await tap('paw');
  await sim(0.8);
  await shot('6_lock');
  // tři špatné pokusy → Tiger se urazí
  for (let i = 0; i < 3; i++) {
    await dbg((i) => { const d = window.__tigerDebug; d.lock.set([2, 2, 0, 7 + (i % 2)]); d.lock.confirm(); }, i);
    await sim(0.3);
  }
  s = await state();
  check(s.stats.wrongCodes === 3 && s.inputLocked, 'po 3 špatných pokusech se Tiger urazil', `wrong=${s.stats.wrongCodes}`);
  await sim(4.0);
  check((await state()).inputLocked, 'cooldown trvá (olizuje si tlapku)');
  await sim(4.6);
  check(!(await state()).inputLocked, 'po 8 s cooldown skončil');
  // správný kód skutečnými stisky: otočit kolečka klávesami
  await tap('paw');
  await sim(0.5);
  await dbg(() => window.__tigerDebug.lock.set([0, 0, 0, 0]));
  const code = await dbg(() => window.__tigerDebug.lock.code());
  for (let w = 0; w < 4; w++) {
    for (let k = 0; k < code[w]; k++) {
      await sim(1 / 30, { x: 0, y: 1 });
      await sim(1 / 30, null);
    }
    if (w < 3) {
      await sim(1 / 30, { x: 1, y: 0 });
      await sim(1 / 30, null);
    }
  }
  const digits = (await dbg(() => window.__tigerDebug.lock.state())).digits.join('');
  check(digits === code.join(''), 'kolečka nastavena klávesami', digits);
  await tap('paw');
  await sim(1.5);
  check((await dbg(() => window.__tigerDebug.lock.state())).open, 'zámek se otevřel kódem ' + code.join(''));
  await shot('6_open');
  s = await state();
  check(s.prompt === 'treatBag', 'výzva „Shodit sáček“', String(s.prompt));
  await tap('push');
  await sim(2.5);
  const tr = await dbg(() => { const t = window.__tigerDebug.game.ctx.refs.treats; let x = 0, y = 0, z = 0; for (const q of t.pieces) { x += q.mesh.position.x; y += q.mesh.position.y; z += q.mesh.position.z; } const n = t.pieces.length || 1; return { state: t.state, n: t.pieces.length, p: [x / n, y / n, z / n] }; });
  check(tr.state === 'spilled' && tr.n >= 12 && tr.p[1] < 0.1, 'pamlsky se rozsypaly po zemi', `${tr.state}, ${tr.n} ks, y=${tr.p[1].toFixed(2)}`);
  await tp(tr.p[0] + 0.2, 0.02, tr.p[2] + 0.25, -2.4);
  await shot('6_treats');
  s = await state();
  check(s.prompt === 'eatTreats', 'výzva „Sníst pamlsky“', String(s.prompt));
  await tap('paw');
  await sim(7);
  check(await solved('lock'), 'pamlsky snědeny, krok vyřešen');

  // ---------------------------------------------------------------- 7. vysavač
  console.log('Krok 7 – vysavač a balkonové dveře:');
  // s překážkami v cestě vysavač nedojede
  const v0 = await dbg(() => window.__tigerDebug.vacuum());
  await tp(v0.pos[0] - 0.05, 0.02, v0.pos[2] + 0.4, Math.PI);
  s = await state();
  check(s.prompt === 'vacuumButton', 'výzva „Zapnout vysavač“', String(s.prompt));
  await tap('paw');
  await sim(6);
  let v = await dbg(() => window.__tigerDebug.vacuum());
  check(v.bounces >= 1 && !(await solved('vacuum')), 'bota v cestě: vysavač se odrazil', `odrazů ${v.bounces}`);
  for (let i = 0; i < 60 && v.state !== 'docked'; i++) { await sim(1); v = await dbg(() => window.__tigerDebug.vacuum()); }
  check(v.state === 'docked', 'vysavač se vrátil do stanice', v.state);
  // odstrkat botu a koš (F), zbytek přesunem
  const boot0 = await dbg(() => window.__tigerDebug.bodyPos('boot'));
  await tp(boot0[0], 0.02, boot0[2] - 0.5, 0);
  await tap('push');
  await sim(1.5);
  const boot1 = await dbg(() => window.__tigerDebug.bodyPos('boot'));
  check(Math.hypot(boot1[0] - boot0[0], boot1[2] - boot0[2]) > 0.08, 'strčením (F) se bota posunula');
  await dbg(() => { const d = window.__tigerDebug; d.moveBody('boot', 1.6, 0.2, 1.3); d.moveBody('laundry', -1.3, 0.25, -1.4); d.moveBody('taburet', -2.45, 0.234, -1.6); });
  await sim(1.0);
  await tp(v.pos[0] - 0.05, 0.02, v.pos[2] + 0.4, Math.PI);
  await tap('paw');
  // svezení na vysavači
  await sim(1.0);
  v = await dbg(() => window.__tigerDebug.vacuum());
  await tp(v.pos[0], 0.3, v.pos[2], -Math.PI / 2);
  await sim(2.0);
  s = await state();
  const v2 = await dbg(() => window.__tigerDebug.vacuum());
  check(s.groundTag === 'vacuum' && Math.abs(s.pos[0] - v2.pos[0]) < 0.12, 'Tiger se veze na vysavači', `tag=${s.groundTag}`);
  await shot('7_riding');
  await tp(0.5, 0.02, 0.9, 0);
  for (let i = 0; i < 40 && !(await solved('vacuum')); i++) await sim(1);
  check(await solved('vacuum'), 'vysavač dojel ke dveřím a dorazil je');
  await sim(2);
  check((await dbg(() => window.__tigerDebug.flags())).doorOpen === true, 'balkonové dveře jsou otevřené');

  // ---------------------------------------------------------------- tajemství: zlatý pamlsek
  console.log('Tajemství – zlatý pamlsek:');
  await tp(-0.72, 2.21, -2.33, Math.PI / 2);
  await sim(0.6, null, ['senses']);
  const trail = await dbg(() => window.__tigerDebug.game.senses.trailVisible('golden'));
  check(trail, 'zlatá stopa je z vršku knihovny vidět');
  await sim(0.2);
  // skok na houpající se svítidlo
  const lampTop = await dbg(() => { const p = window.__tigerDebug.game.ctx.refs.pendant; return p.top.toArray(); });
  const okLamp = await dbg((t) => window.__tigerDebug.jumpTo(t[0] - 0.08, t[1], t[2] - 0.05), lampTop);
  await sim(1.0);
  s = await state();
  check(okLamp && s.groundTag === 'pendant', 'skok z knihovny na svítidlo', `tag=${s.groundTag} y=${s.pos[1]}`);
  await shot('s_pendant');
  // odraz ve správné fázi houpání: zkoušet, dokud oblouk nevyjde
  const gold = await dbg(() => window.__tigerDebug.game.ctx.refs.goldenTreat.pos.toArray());
  let jumped = false;
  let phases = { ok: 0, no: 0 };
  for (let i = 0; i < 360 && !jumped; i++) {
    await sim(1 / 30);
    const can = await dbg(() => window.__tigerDebug.canReach(1.95, 2.25, -2.3));
    if (can) phases.ok++; else phases.no++;
    if (can && phases.no > 0) jumped = await dbg(() => window.__tigerDebug.jumpTo(1.95, 2.25, -2.3));
  }
  if (!jumped) console.log('    stav na svítidle:', JSON.stringify(await state()).slice(0, 220));
  check(phases.no > 0, 've špatné fázi houpání skok nevyjde', `ano ${phases.ok}× / ne ${phases.no}×`);
  await sim(1.2);
  s = await state();
  check(jumped && s.groundTag === 'upperCabinet', 'odraz ve správné fázi → horní skříňky', `tag=${s.groundTag} y=${s.pos[1]}`);
  await tp(gold[0] - 0.3, 2.26, gold[2], Math.PI / 2);
  s = await state();
  check(s.prompt === 'goldenTreat', 'výzva „Sníst zlatý pamlsek“', String(s.prompt));
  await tap('paw');
  await sim(1.0);
  s = await state();
  check(s.stats.golden && s.solved.includes('golden'), 'zlatý pamlsek nalezen (Král výšek)');

  // ---------------------------------------------------------------- nápovědy a uložení
  console.log('Nápovědy a ukládání:');
  await tp(0.5, 0.02, 0.9, 0);
  await dbg(() => window.__tigerDebug.hint());
  s = await state();
  check(s.stats.hints === 1, 'nápověda (H) se započítala');
  const saved = await dbg(() => JSON.parse(localStorage.getItem('tiger.save.v1') ?? 'null'));
  check(saved && saved.solved.includes('vacuum') && saved.journal.length >= 6, 'autosave obsahuje postup', saved ? `${saved.solved.length} kroků, ${saved.journal.length} stop` : 'chybí');

  // ---------------------------------------------------------------- 8. finále
  console.log('Krok 8 – finále:');
  await tp(-2.6, 0.02, -0.3, -Math.PI / 2);
  await dbg(() => window.__tigerDebug.look(-Math.PI / 2, 0.2));
  await sim(4.0, { x: 0, y: 1 });
  s = await state();
  check(s.state === 'finale', 'Tiger vyšel na balkon → finále', `state=${s.state} x=${s.pos[0]}`);
  await sim(9, null);
  s = await state();
  check(s.modal === 'credits', 'běží závěrečné titulky se statistikou');
  await shot('8_finale');
  await sim(30, null);
  await shot('8_finale_end');
  s = await state();
  const all = ['scent', 'note', 'falseClues', 'card', 'photo', 'lock', 'vacuum', 'finale', 'golden'];
  check(all.every((id) => s.solved.includes(id)), 'závěrečný stav: všechny kroky vyřešeny', s.solved.join(', '));
  check(s.phase === 8, 'slunce zapadlo (modrá hodinka)', `fáze ${s.phase}`);
  check(s.journal.length === 7, 'deník je kompletní (7 stop)', String(s.journal.length));
  check(s.stats.hints === 1 && s.stats.wrongCodes === 3 && s.stats.golden, 'statistika odpovídá průchodu', JSON.stringify(s.stats));
  const errs = await dbg(() => window.__tigerDebug.errors);
  check(errs.length === 0 && logs.errors.length === 0, 'konzole bez chyb', [...errs, ...logs.errors].slice(0, 3).join(' | '));
} catch (e) {
  failed++;
  console.log('VÝJIMKA:', e.message);
} finally {
  if (logs.errors.length) console.log('CHYBY KONZOLE:\n' + [...new Set(logs.errors)].slice(0, 10).join('\n'));
  await close();
  server.stop();
}
console.log(failed === 0 ? '\nPRŮCHOD HROU: OK' : `\nPRŮCHOD HROU: ${failed} selhání`);
process.exit(failed === 0 ? 0 : 1);
