import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import type { StepDef } from '../PuzzleGraph';
import { KITCHEN, TRASH_BIN, ROOM } from '../../world/Layout';
import * as L from '../../world/Labels';

/**
 * Krok 1 – Čich. Kočičí smysly ukážou tři pachové stopy: ke skříňce s pamlsky (zamčená),
 * k lednici (lísteček) a falešnou stopu tuňáka k odpadkovému koši.
 */
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const scentStep: StepDef = {
  id: 'scent',
  title: 'Čich',
  requires: [],
  hints: [
    'Mám hlad a nos, který nelže. Zkus se na svět podívat čichem – podrž Q.',
    'Vzduchem tečou tři pachové stopy. Ta jantarová voní po pamlscích a vede do kuchyně.',
    'Jdi po jantarové stopě až k lince u lednice – pamlsky jsou v horní skříňce nad ní.',
  ],
  alwaysUpdate: true,

  setup(pc) {
    const { refs, senses, graph, journal } = pc;
    const cab = refs.treatCabinet;
    const fridge = refs.fridge;
    senses.addTrail({
      id: 'treats',
      color: 0xffb040,
      waypoints: [v(-0.4, 0.16, -0.32), v(0.9, 0.18, -0.42), v(1.55, 0.2, -1.2), v(1.95, 0.5, -1.7), v(2.05, 1.15, -1.95), cab.front.clone()],
      active: () => !graph.isSolved('lock'),
    });
    senses.addTrail({
      id: 'fridge',
      color: 0xff8fb8,
      waypoints: [v(-0.4, 0.16, -0.32), v(1.1, 0.18, -0.45), v(2.1, 0.2, -1.2), v(2.5, 0.7, -1.65), fridge.magnetPos.clone()],
      active: () => !graph.isSolved('note'),
    });
    senses.addTrail({
      id: 'tuna',
      color: 0x5fe3c2,
      waypoints: [v(-0.4, 0.16, -0.32), v(-0.25, 0.16, -1.35), v(0.05, 0.18, -1.95), v(TRASH_BIN.x, 0.3, TRASH_BIN.z)],
      active: () => !pc.flags.binTipped,
    });
    journal.define({
      id: 'tuna',
      title: 'Plechovka od tuňáka',
      text: 'Prázdná plechovka v odpadkovém koši. Voněla slibně, ale je vylízaná do sucha.',
      kind: 'false',
      image: () => L.tunaLabel(),
      comment: 'Někdo tu jedl tuňáka. Beze mě.',
    });
    // koš jde shodit
    pc.interact.add({
      id: 'trashBin',
      pos: () => refs.trashBin.group.position,
      radius: 0.5,
      enabled: () => !pc.flags.binTipped,
      push: {
        label: 'Shodit koš',
        action: () => {
          const b = refs.trashBin.entry.body;
          const t = b.translation();
          const dir = new THREE.Vector3(t.x - pc.cat.position.x, 0, t.z - pc.cat.position.z).normalize();
          const m = b.mass();
          b.applyImpulseAtPoint({ x: dir.x * m * 1.9, y: 0, z: dir.z * m * 1.9 }, { x: t.x, y: t.y + 0.14, z: t.z }, true);
          pc.sfx('bump', refs.trashBin.group.position);
          pc.say('Gravitace. Musím to otestovat.');
        },
      },
    });
  },

  onActivate(pc) {
    void pc;
  },

  update(pc, dt) {
    void dt;
    const { refs, cat, graph } = pc;
    // převrácení koše → plechovka
    const bin = refs.trashBin;
    if (!pc.flags.binTipped) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bin.group.quaternion);
      if (up.y < 0.5) {
        pc.flags.binTipped = true;
        pc.sfx('clank', bin.group.position);
        // plechovka se vykutálí
        const can: THREE.Group = bin.can;
        can.visible = true;
        const out = up.clone().setY(0).normalize();
        can.position.copy(bin.group.position).addScaledVector(out, 0.2).setY(0.06);
        can.rotation.set(Math.PI / 2, 0, 0.4);
        bin.canEntry = pc.game.physics.addDynamic(
          can,
          [RAPIER.ColliderDesc.cylinder(0.0175, 0.042).setFriction(0.5).setRestitution(0.3).setDensity(300)],
          { info: { surface: 'metal' }, tag: 'can', debris: true, linDamp: 0.4, angDamp: 0.5 },
        );
        bin.canEntry.body.applyImpulse({ x: out.x * 0.05, y: 0.01, z: out.z * 0.05 }, true);
        pc.later(0.9, () => {
          pc.say('Prázdná. Někdo tu jedl tuňáka. Beze mě.', 4);
          pc.journal.add('tuna');
        });
      }
    }
    if (!graph.isActive('scent')) return;
    const p = cat.position;
    // konec jantarové stopy: u linky pod skříňkou (na zemi nebo na lince)
    const nearCab = Math.hypot(p.x - (KITCHEN.upperX0 + KITCHEN.upperX1) / 2, p.z - (ROOM.minZ + KITCHEN.runDepth + 0.25)) < 0.75 || (p.y > 0.8 && p.x > 1.5 && p.z < -1.8);
    if (!pc.flags.fridgeSeen && Math.hypot(p.x - 2.65, p.z + 1.45) < 0.6) {
      pc.flags.fridgeSeen = true;
      pc.say('Na lednici něco visí. Vysoko. Samozřejmě.');
    }
    if (nearCab && pc.senses.usedOnce) {
      pc.say('Tam nahoře. Pamlsky. A na dvířkách zámek se čtyřmi kolečky.', 4.5);
      pc.later(4.6, () => pc.say('Lidé si kódy zapisují. Stačí najít kam.', 3.5));
      graph.solve('scent');
    }
  },

  restore(pc) {
    pc.flags.fridgeSeen = true;
  },
};
