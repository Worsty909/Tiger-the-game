import * as THREE from 'three';
import { RAPIER, GROUPS } from '../../core/Physics';
import type { StepDef } from '../PuzzleGraph';
import type { PuzzleCtx } from '../PuzzleCtx';
import { TABURET } from '../../world/Layout';
import * as L from '../../world/Labels';
import { makeCanvas } from '../../world/ProcTextures';

/**
 * Krok 5 – Parkour ke knihovně. Taburet se musí dostrkat pod parapet; cesta pak vede přes
 * parapet a houpací závěsnou polici (do 2 s skočit dál, jinak sklouzne) na vršek knihovny.
 * Tam stojí zarámovaná fotka Tigera-koťátka: shodit, rám se rozbije, na rubu je datum.
 */

function breakFrame(pc: PuzzleCtx, at: THREE.Vector3): void {
  const { refs, game } = pc;
  const kf = refs.kittenFrame;
  if (kf.state !== 'falling') return;
  kf.state = 'broken';
  if (kf.entry) game.physics.removeBody(kf.entry);
  kf.entry = null;
  const dyn: THREE.Group = refs.dynamicGroup;
  const g: THREE.Group = kf.group;
  g.visible = false;
  const ground = Math.max(0, game.physics.groundHeight(at.x, at.y + 0.3, at.z, 1.5, GROUPS.queryStatic));
  pc.sfx('glass', at, 1);
  pc.sfx('thud', at, 0.6);
  game.camera.addShake(0.012);
  // úlomky rámu
  const frameMat = (kf.bars.children[0] as THREE.Mesh).material as THREE.Material;
  for (let i = 0; i < 4; i++) {
    const len = i < 2 ? kf.w : kf.h - 0.03;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.016, 0.018), frameMat);
    bar.castShadow = true;
    bar.position.set(at.x + (Math.random() - 0.5) * 0.12, ground + 0.05 + Math.random() * 0.06, at.z + (Math.random() - 0.5) * 0.12);
    bar.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dyn.add(bar);
    const e = game.physics.addDynamic(bar, [RAPIER.ColliderDesc.cuboid(len / 2, 0.008, 0.009).setRestitution(0.3).setDensity(500)], { info: { surface: 'wood' }, debris: true, linDamp: 0.6, angDamp: 0.8 });
    e.body.applyImpulse({ x: (Math.random() - 0.5) * 0.03, y: 0.02 + Math.random() * 0.02, z: (Math.random() - 0.3) * 0.03 }, true);
  }
  // střepy skla
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2 });
  for (let i = 0; i < 12; i++) {
    const s = 0.012 + Math.random() * 0.026;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(s, s * (0.2 + Math.random() * 0.5));
    shape.lineTo(s * (0.2 + Math.random() * 0.6), s);
    const shard = new THREE.Mesh(new THREE.ShapeGeometry(shape), glassMat);
    shard.renderOrder = 6;
    shard.position.set(at.x + (Math.random() - 0.5) * 0.14, ground + 0.04 + Math.random() * 0.08, at.z + (Math.random() - 0.5) * 0.14);
    shard.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dyn.add(shard);
    const e = game.physics.addDynamic(shard, [RAPIER.ColliderDesc.cuboid(s / 2, s / 2, 0.0015).setRestitution(0.35).setDensity(2500)], { info: { surface: 'glass' }, debris: true, linDamp: 0.5, angDamp: 0.6 });
    const a = Math.random() * Math.PI * 2;
    const k = 0.0008 + Math.random() * 0.0025;
    e.body.applyImpulse({ x: Math.cos(a) * k, y: k * 1.2, z: Math.sin(a) * k }, true);
  }
  // fotka leží rubem nahoru
  const photo: THREE.Group = kf.photo;
  dyn.add(photo);
  photo.position.set(at.x + 0.03, ground + 0.004, at.z + 0.06);
  photo.rotation.set(Math.PI / 2, 0, 0.5);
  photo.visible = true;
  kf.photoPos = photo.position.clone();
  pc.later(0.7, () => pc.say('Funguje. Jako vždycky.', 2.6));
}

/** Líc fotky: momentka Tigera z 3D scény (nebo kreslená náhrada). */
export function setKittenPhoto(pc: PuzzleCtx, canvas: HTMLCanvasElement): void {
  const kf = pc.refs.kittenFrame;
  const ctx2 = (kf.frontCanvas as HTMLCanvasElement).getContext('2d')!;
  ctx2.drawImage(canvas, 0, 0, kf.frontCanvas.width, kf.frontCanvas.height);
  kf.frontTex.needsUpdate = true;
}

export const photoStep: StepDef = {
  id: 'photo',
  title: 'Fotka na knihovně',
  requires: ['note'],
  hints: [
    'Na nejvyšší polici knihovny stojí fotka. Moje. Z dob, kdy jsem byl malý a ještě roztomilejší.',
    'Dostrkej taburet pod okno (F). Pak: taburet → parapet → závěsná police → vršek knihovny. Na polici se nezdržuj, houpe se!',
    'Nahoře shoď zarámovanou fotku (F) a dole si přečti její rub (E). Čtyři týdny před 11. 4. je…',
  ],
  alwaysUpdate: true,

  setup(pc) {
    const { refs, journal, interact } = pc;
    const kf = refs.kittenFrame;
    journal.define({
      id: 'kitten',
      title: 'Fotka koťátka',
      text: 'Na rubu stojí: „Tiger, 4 týdny – 11. 4.“ Čtyři týdny je 28 dní.',
      kind: 'clue',
      image: () => {
        const [c, g] = makeCanvas(512, 400);
        g.drawImage(kf.frontCanvas, 0, 0, 512, 400);
        return c;
      },
      back: () => L.kittenBack(),
      comment: 'Jedenáctého dubna mi byly čtyři týdny. Takže narozeniny…',
    });
    interact.add({
      id: 'kittenFrame',
      pos: kf.home,
      radius: 0.55,
      wide: true,
      enabled: () => kf.state === 'onShelf' && pc.graph.isActive('photo'),
      push: {
        label: 'Shodit',
        action: () => {
          kf.state = 'falling';
          kf.fallT = 0;
          const g: THREE.Group = kf.group;
          kf.stand.visible = false;
          kf.entry = pc.game.physics.addDynamic(
            g,
            [RAPIER.ColliderDesc.cuboid(kf.w / 2, kf.h / 2, 0.012).setRestitution(0.1).setDensity(600)],
            {
              info: { surface: 'wood', tag: 'noStand' },
              tag: 'kittenFrame',
              ccd: true,
              canSleep: false,
              onImpact: (speed) => {
                const p = kf.entry ? kf.entry.body.translation() : null;
                if (p && speed > 2.6 && p.y < 1.2) breakFrame(pc, new THREE.Vector3(p.x, p.y, p.z));
              },
            },
          );
          const m = kf.entry.body.mass();
          kf.entry.body.applyImpulse({ x: 0, y: m * 0.6, z: m * 1.5 }, true);
          kf.entry.body.applyTorqueImpulse({ x: m * 0.02, y: 0, z: m * 0.004 }, true);
          pc.sfx('bump', kf.home);
          pc.say('Gravitace. Musím to otestovat.', 2.6);
        },
      },
    });
    interact.add({
      id: 'kittenPhoto',
      pos: () => kf.photoPos ?? kf.home,
      radius: 0.5,
      wide: true,
      enabled: () => kf.state === 'broken',
      paw: {
        label: 'Prohlédnout fotku',
        action: () => {
          kf.state = 'read';
          pc.discover('kitten', () => {
            pc.say('11. dubna čtyři týdny… a průkaz říká jedna-něco, nula-něco. Počítej, Tigere.', 5);
            pc.graph.solve('photo');
          });
        },
      },
    });
  },

  update(pc, dt) {
    const { refs, cat, game } = pc;
    // --- taburet pod parapetem
    const tb = refs.taburet;
    if (tb && !pc.flags.taburetPlaced) {
      const t = tb.body.translation();
      const z = TABURET.zone;
      if (t.x > z.minX && t.x < z.maxX && t.z > z.minZ && t.z < z.maxZ) {
        pc.flags.taburetPlaced = true;
        pc.sfx('thud', new THREE.Vector3(t.x, 0.2, t.z), 0.4);
        pc.say('Taburet pod oknem. Schod hodný krále.', 3.2);
      }
    }
    // --- závěsná police: po dopadu se naklání, do 2 s je třeba skočit dál
    const hs = refs.hangShelf;
    if (hs) {
      const on = cat.mode === 'ground' && cat.groundTag === 'hangShelf';
      hs.timer = on ? (hs.timer ?? 0) + dt : Math.max(0, (hs.timer ?? 0) - dt * 3);
      if (on && !hs.warned && hs.timer > 0.25) {
        hs.warned = true;
        pc.sfx('doorCreak', hs.pivot.position, 0.5, 1.5);
        if (!pc.flags.shelfSeen) {
          pc.flags.shelfSeen = true;
          pc.say('Houpe se to! Rychle dál!', 2);
        }
      }
      if (!on && hs.timer === 0) hs.warned = false;
      const target = on ? THREE.MathUtils.clamp((hs.timer - 0.35) / 1.65, 0, 1) ** 1.6 * 0.92 : 0;
      hs.tiltV = (hs.tiltV ?? 0) + ((target - hs.tilt) * 60 - (hs.tiltV ?? 0) * 9) * dt;
      hs.tilt += hs.tiltV * dt;
      const sway = Math.sin(game.time * 1.4) * 0.012 + (on ? Math.sin(game.time * 7) * 0.01 : 0);
      hs.pivot.rotation.x = hs.tilt + sway;
      hs.pivot.updateMatrixWorld(true);
      game.physics.moveKinematic(hs.body, hs.pivot.position, hs.pivot.quaternion);
    }
    // --- rám: pojistka, kdyby se při pádu nerozbil
    const kf = refs.kittenFrame;
    if (kf.state === 'falling' && kf.entry) {
      kf.fallT += dt;
      const p = kf.entry.body.translation();
      const v = kf.entry.body.linvel();
      if (kf.fallT > 0.5 && p.y < 1.6 && Math.hypot(v.x, v.y, v.z) < 0.4) breakFrame(pc, new THREE.Vector3(p.x, p.y, p.z));
      else if (kf.fallT > 4) breakFrame(pc, new THREE.Vector3(p.x, p.y, p.z));
    }
  },

  restore(pc) {
    const { refs } = pc;
    const kf = refs.kittenFrame;
    if (kf.entry) pc.game.physics.removeBody(kf.entry);
    kf.entry = null;
    kf.state = 'read';
    kf.group.visible = false;
    kf.photo.visible = false;
    pc.journal.add('kitten', true);
    pc.flags.taburetPlaced = true;
    pc.flags.shelfSeen = true;
  },
};
