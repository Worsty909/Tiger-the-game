import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import type { StepDef } from '../PuzzleGraph';
import type { PuzzleCtx } from '../PuzzleCtx';
import { KITCHEN } from '../../world/Layout';
import { audio, type LoopHandle } from '../../core/Audio';

/**
 * Krok 6 – Kódový zámek. Tiger na lince otáčí tlapkou čtyřmi kolečky (detail s hloubkou ostrosti).
 * Špatný kód jen cvakne a Tiger švihne ocasem; po 3 špatných pokusech se urazí a 8 s si olizuje
 * tlapku. Správný kód 1403 otevře skříňku: sáček se shodí, pamlsky se rozsypou, Tiger je sní.
 */
export const CODE = [1, 4, 0, 3];
const SULK_TIME = 8;

interface LockState {
  open: boolean;
  inView: boolean;
  sel: number;
  fails: number;
  sulk: number;
  msg: string;
  spillT: number;
  purr: LoopHandle | null;
}

const st: LockState = { open: false, inView: false, sel: 0, fails: 0, sulk: 0, msg: '', spillT: -1, purr: null };

function showUI(pc: PuzzleCtx): void {
  pc.ui.showLock(pc.refs.lock.digits, st.sel, st.msg);
}

function enterView(pc: PuzzleCtx): void {
  const lock = pc.refs.lock;
  st.inView = true;
  st.msg = '';
  pc.cat.inputLocked = true;
  pc.interact.locked = true;
  const p: THREE.Vector3 = lock.pos;
  pc.game.camera.setShot({ position: new THREE.Vector3(p.x - 0.07, p.y - 0.06, p.z + 0.3), target: new THREE.Vector3(p.x - 0.01, p.y, p.z - 0.02), fov: 30 }, 4);
  pc.game.gfx.setDof(true, 0.3, 0.12, 3.5);
  pc.game.modalHandler = (ev) => {
    if (ev === 'left') st.sel = (st.sel + 3) % 4;
    else if (ev === 'right') st.sel = (st.sel + 1) % 4;
    else if (ev === 'up' || ev === 'down') {
      lock.digits[st.sel] = (lock.digits[st.sel] + (ev === 'up' ? 1 : 9)) % 10;
      pc.sfx('tick', lock.pos, 1.4);
      st.msg = '';
    } else if (ev === 'confirm') tryCode(pc);
    else if (ev === 'back') exitView(pc);
    if (st.inView) showUI(pc);
  };
  showUI(pc);
}

function exitView(pc: PuzzleCtx): void {
  st.inView = false;
  pc.cat.inputLocked = st.sulk > 0;
  pc.interact.locked = false;
  pc.game.camera.setShot(null, 3);
  pc.game.gfx.setDof(false);
  pc.game.modalHandler = null;
  pc.ui.hideLock();
}

function tryCode(pc: PuzzleCtx): void {
  const lock = pc.refs.lock;
  const ok = CODE.every((d, i) => lock.digits[i] === d);
  if (ok) {
    pc.sfx('lockOpen', lock.pos);
    st.open = true;
    pc.flags.lockOpen = true;
    exitView(pc);
    openCabinet(pc, true);
    pc.say('Čtrnáctého března. Moje narozeniny. Samozřejmě.', 3.6);
    return;
  }
  // špatně: cvaknutí, frustrovaný švih ocasem
  pc.sfx('lockClick', lock.pos);
  pc.stats.wrongCodes++;
  st.fails++;
  pc.tiger.anim.tailMood = 'annoyed';
  pc.later(1.6, () => {
    if (st.sulk <= 0) pc.tiger.anim.tailMood = 'neutral';
  });
  st.msg = ['Cvak. Nic.', 'Cvak. Zase nic.', ''][Math.min(2, st.fails - 1)];
  if (st.fails >= 3) {
    // Tiger se urazí
    st.fails = 0;
    st.sulk = SULK_TIME;
    exitView(pc);
    pc.cat.inputLocked = true;
    pc.tiger.anim.action = 'lick';
    pc.sfx('meowAnnoyed', pc.cat.position);
    pc.say('Fajn. Stejně jsem ty pamlsky nechtěl.', 3.5);
    pc.later(4, () => pc.say('…olizuju si tlapku, protože chci. Ne proto, že jsem uražený.', 3.6));
  }
}

function openCabinet(pc: PuzzleCtx, animate: boolean): void {
  const { refs } = pc;
  refs.lock.group.visible = false;
  refs.treatDoor.target = 1.75;
  if (!animate) {
    refs.treatDoor.angle = 1.75;
    refs.treatDoor.speed = 0;
    refs.treatDoor.pivot.rotation.y = -1.75;
  } else pc.sfx('doorCreak', refs.lock.pos, 0.5, 1.6);
  refs.treats.state = 'open';
}

function spill(pc: PuzzleCtx, at: THREE.Vector3): void {
  const tr = pc.refs.treats;
  if (tr.state !== 'falling') return;
  tr.state = 'spilled';
  pc.sfx('bag', at);
  const dyn: THREE.Group = pc.refs.dynamicGroup;
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(tr.geo, tr.mat);
    m.castShadow = true;
    m.position.set(at.x + (Math.random() - 0.5) * 0.08, at.y + 0.03 + Math.random() * 0.05, at.z + (Math.random() - 0.5) * 0.08);
    dyn.add(m);
    const entry = pc.game.physics.addDynamic(m, [RAPIER.ColliderDesc.ball(0.009).setRestitution(0.45).setFriction(0.6).setDensity(700)], { info: { surface: 'wood' }, debris: true, linDamp: 0.9, angDamp: 1.2 });
    const a = Math.random() * Math.PI * 2;
    const k = 0.0008 + Math.random() * 0.0022;
    entry.body.applyImpulse({ x: Math.cos(a) * k, y: k * 0.9, z: Math.sin(a) * k + 0.0008 }, true);
    tr.pieces.push({ mesh: m, entry, eaten: false });
  }
  pc.later(0.8, () => pc.say('Prší pamlsky. Nejlepší počasí.', 3));
}

function centroid(pc: PuzzleCtx, out: THREE.Vector3): THREE.Vector3 {
  const tr = pc.refs.treats;
  out.set(0, 0, 0);
  let n = 0;
  for (const p of tr.pieces) {
    if (p.eaten) continue;
    out.add(p.mesh.position);
    n++;
  }
  return n ? out.divideScalar(n) : out.copy(pc.cat.position);
}

const _c = new THREE.Vector3();

export const lockStep: StepDef = {
  id: 'lock',
  title: 'Kódový zámek',
  requires: ['note'],
  hints: [
    'Čtyři kolečka, čtyři číslice: den a měsíc mých narozenin. Zámek je na horní skříňce – vyskoč na linku.',
    'Průkaz říká „1_. 0_.“ a fotka, že 11. 4. mi byly čtyři týdny. Odečti 28 dní.',
    '28 dní před 11. dubnem je 14. března. Kód je 1 4 0 3.',
  ],
  alwaysUpdate: true,

  setup(pc) {
    const { refs, interact } = pc;
    const lock = refs.lock;
    const tr = refs.treats;
    interact.add({
      id: 'lock',
      pos: lock.pos,
      radius: 0.85,
      wide: true,
      enabled: () => !st.open && st.sulk <= 0 && pc.graph.isActive('lock') && pc.cat.position.y > 0.8,
      paw: { label: 'Otáčet kolečky', action: () => enterView(pc) },
    });
    // ze země: jen poznámka
    interact.add({
      id: 'lockFar',
      pos: new THREE.Vector3(lock.pos.x, 0.3, lock.pos.z + 0.45),
      radius: 0.6,
      wide: true,
      enabled: () => !st.open && pc.graph.isActive('lock') && pc.cat.position.y < 0.5 && !pc.flags.lockFarSeen,
      paw: {
        label: 'Podívat se nahoru',
        action: () => {
          pc.flags.lockFarSeen = true;
          pc.say('Na zámek odsud nedosáhnu. Musím na linku.', 3.2);
        },
      },
    });
    interact.add({
      id: 'treatBag',
      pos: () => tr.bag.position,
      radius: 0.9,
      wide: true,
      enabled: () => tr.state === 'open' && pc.cat.position.y > 0.8,
      push: {
        label: 'Shodit sáček',
        action: () => {
          tr.state = 'falling';
          st.spillT = 0;
          const bag: THREE.Group = tr.bag;
          // sáček „vyjede“ před skříňku (uvnitř je plný kolizní kvádr korpusu) a spadne dolů
          bag.position.z = pc.refs.treatCabinet.front.z + 0.09;
          bag.position.y += 0.02;
          bag.updateMatrixWorld(true);
          tr.bagEntry = pc.game.physics.addDynamic(
            bag,
            [RAPIER.ColliderDesc.cuboid(0.055, 0.08, 0.022).setRestitution(0.05).setDensity(350)],
            {
              info: { surface: 'plastic', tag: 'noStand' }, tag: 'treatBag', canSleep: false,
              onImpact: (speed) => {
                const p = tr.bagEntry?.body.translation();
                if (p && speed > 2.2 && p.y < 0.6) spill(pc, new THREE.Vector3(p.x, p.y, p.z));
              },
            },
          );
          const m = tr.bagEntry.body.mass();
          tr.bagEntry.body.applyImpulse({ x: -m * 0.25, y: m * 0.5, z: m * 1.5 }, true);
          tr.bagEntry.body.applyTorqueImpulse({ x: m * 0.01, y: 0, z: m * 0.006 }, true);
          pc.sfx('bump', bag.position);
          pc.say('Gravitace. Znovu funguje.', 2.4);
        },
      },
    });
    interact.add({
      id: 'eatTreats',
      pos: () => centroid(pc, _c),
      radius: 0.7,
      wide: true,
      enabled: () => tr.state === 'spilled' && pc.cat.position.y < 0.3,
      paw: {
        label: 'Sníst pamlsky',
        action: () => {
          tr.state = 'eating';
          pc.cat.inputLocked = true;
          pc.tiger.anim.action = 'eat';
          pc.tiger.anim.breathRate = 1.8;
          st.purr = audio.loop('purrLoop', pc.cat.position, 1);
          const alive = tr.pieces.filter((p: { eaten: boolean }) => !p.eaten);
          alive.forEach((p: { mesh: THREE.Mesh; entry: import('../../core/Physics').BodyEntry; eaten: boolean }, i: number) => {
            pc.later(0.4 + i * 0.26, () => {
              p.eaten = true;
              p.mesh.visible = false;
              pc.game.physics.removeBody(p.entry);
              pc.sfx('crunch', pc.cat.position, 0.8, 0.9 + Math.random() * 0.3);
            });
          });
          pc.later(0.4 + alive.length * 0.26 + 0.7, () => {
            tr.state = 'eaten';
            pc.tiger.anim.action = 'none';
            pc.tiger.anim.tailMood = 'happy';
            pc.cat.inputLocked = false;
            pc.say('Mňam. Život má zase smysl.', 3.4);
            pc.later(5, () => {
              st.purr?.stop();
              st.purr = null;
              pc.tiger.anim.breathRate = 1;
              pc.tiger.anim.tailMood = 'neutral';
            });
            pc.graph.solve('lock');
          });
        },
      },
    });
  },

  update(pc, dt) {
    const { refs } = pc;
    const lock = refs.lock;
    // kolečka se plynule dotáčejí na zvolenou číslici
    for (let i = 0; i < 4; i++) {
      const target = lock.digits[i] * ((Math.PI * 2) / 10);
      let d = target - lock.angles[i];
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      lock.angles[i] += d * Math.min(1, dt * 14);
      lock.wheels[i].rotation.x = lock.angles[i] + Math.PI * 0.5;
    }
    // uražený Tiger: 8 s si olizuje tlapku
    if (st.sulk > 0) {
      st.sulk -= dt;
      if (st.sulk <= 0) {
        pc.tiger.anim.action = 'none';
        pc.tiger.anim.tailMood = 'neutral';
        pc.cat.inputLocked = false;
        pc.say('Dobře. Ještě jednou. S rozmyslem.', 3);
      }
    }
    // sáček: pojistka, kdyby se při dopadu neroztrhl
    const tr = refs.treats;
    if (tr.state === 'falling' && tr.bagEntry) {
      st.spillT += dt;
      const p = tr.bagEntry.body.translation();
      const v = tr.bagEntry.body.linvel();
      if ((st.spillT > 0.5 && Math.hypot(v.x, v.y, v.z) < 0.5) || st.spillT > 3) spill(pc, new THREE.Vector3(p.x, p.y, p.z));
    }
    if (st.purr) st.purr.setPosition(pc.cat.position);
    void KITCHEN;
  },

  restore(pc) {
    const { refs } = pc;
    st.open = true;
    st.sulk = 0;
    pc.flags.lockOpen = true;
    refs.lock.digits.splice(0, 4, ...CODE);
    openCabinet(pc, false);
    const tr = refs.treats;
    if (tr.bagEntry) pc.game.physics.removeBody(tr.bagEntry);
    tr.bagEntry = null;
    tr.bag.visible = false;
    for (const p of tr.pieces) {
      if (!p.eaten) pc.game.physics.removeBody(p.entry);
      p.eaten = true;
      p.mesh.visible = false;
    }
    tr.state = 'eaten';
  },
};

/** Pro debug API a testy. */
export const lockDebug = {
  state: st,
  enter: enterView,
  exit: exitView,
  tryCode,
};
