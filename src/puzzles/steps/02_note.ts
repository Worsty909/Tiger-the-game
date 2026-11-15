import * as THREE from 'three';
import { RAPIER } from '../../core/Physics';
import type { StepDef } from '../PuzzleGraph';
import * as L from '../../world/Labels';

/**
 * Krok 2 – Lísteček na lednici. Visí vysoko pod magnetem: Tiger po něm musí ve skoku švihnout
 * tlapkou (E ve vzduchu). Lísteček sletí a zajede pod lednici, odkud se musí vyhrabat.
 */
export const noteStep: StepDef = {
  id: 'note',
  title: 'Lísteček na lednici',
  requires: ['scent'],
  hints: [
    'Lísteček visí vysoko na lednici. Kočky skáčou. A tlapky švihají.',
    'Na linku se dostaneš přes barovou židli. U lednice vyskoč (mezerník) a ve vzduchu u magnetu zmáčkni E.',
    'Lísteček zajel pod lednici: stoupni si před ni na zem a několikrát zmáčkni E, dokud ho nevyhrabeš.',
  ],
  alwaysUpdate: true,

  setup(pc) {
    const { refs, journal, interact } = pc;
    const fn = refs.fridgeNote;
    const fridge = refs.fridge;
    journal.define({
      id: 'note',
      title: 'Lísteček z lednice',
      text: 'Kód ke skříňce s pamlsky? Tigerovy narozeniny 😉 (DD MM)',
      kind: 'clue',
      image: () => L.noteFridge(),
      comment: 'Moje narozeniny. Kdy to vlastně… hm.',
    });
    // švih po magnetu – jen ve skoku
    interact.add({
      id: 'magnet',
      pos: fridge.magnetPos,
      radius: 0.4,
      airOnly: true,
      wide: true,
      enabled: () => fn.state === 'onFridge' && pc.graph.isActive('note'),
      paw: {
        label: 'Švihnout!',
        action: () => {
          fn.state = 'falling';
          fn.t = 0;
          pc.sfx('swipe', fridge.magnetPos);
          pc.sfx('click', fridge.magnetPos);
          // magnet odletí jako samostatné těleso
          const mag: THREE.Mesh = fn.magnet;
          const wp = mag.getWorldPosition(new THREE.Vector3());
          pc.refs.dynamicGroup.add(mag);
          mag.position.copy(wp);
          const e = pc.game.physics.addDynamic(
            mag,
            [RAPIER.ColliderDesc.cylinder(0.004, 0.016).setRestitution(0.4).setDensity(900)],
            { info: { surface: 'plastic' }, debris: true, tag: 'magnet' },
          );
          e.body.applyImpulse({ x: -0.004, y: 0.004, z: 0.012 }, true);
          fn.magnetEntry = e;
          pc.say('Mám tě!', 1.6);
        },
      },
    });
    // vyhrabání zpod lednice
    const digPos = new THREE.Vector3(fridge.underPos.x, 0.03, fridge.front + 0.05);
    interact.add({
      id: 'noteUnder',
      pos: digPos,
      radius: 0.45,
      wide: true,
      enabled: () => fn.state === 'under',
      paw: {
        label: () => `Vyhrabat (${fn.pulls}/4)`,
        action: () => {
          fn.pulls++;
          pc.sfx('scratch', digPos);
          if (fn.pulls >= 4) {
            fn.state = 'out';
            pc.sfx('paper', digPos);
            pc.later(0.45, () => {
              fn.state = 'taken';
              fn.group.visible = false;
              pc.discover('note', () => {
                pc.say('Moje narozeniny. Den a měsíc. To si přece… pamatuju?', 4);
                pc.graph.solve('note');
              });
            });
          } else if (fn.pulls === 1) pc.say('Je tam. Cítím papír.', 2);
        },
      },
    });
  },

  update(pc, dt) {
    const fn = pc.refs.fridgeNote;
    const fridge = pc.refs.fridge;
    const g: THREE.Group = fn.group;
    if (fn.state === 'falling') {
      // lísteček se snáší jako list a pak zajede pod lednici
      fn.t += dt;
      const fall = Math.min(1, fn.t / 1.5);
      const start: THREE.Vector3 = fridge.magnetPos;
      const landX = fridge.underPos.x + 0.02;
      const landZ = fridge.front + 0.24;
      if (fn.t < 1.5) {
        const e = fall * fall;
        g.position.set(
          THREE.MathUtils.lerp(start.x, landX, fall) + Math.sin(fn.t * 7) * 0.05 * (1 - fall),
          THREE.MathUtils.lerp(start.y - 0.03, 0.012, e),
          THREE.MathUtils.lerp(start.z, landZ, Math.sqrt(fall)) + Math.cos(fn.t * 5) * 0.03,
        );
        g.rotation.set(-fall * Math.PI / 2 + Math.sin(fn.t * 7) * 0.5 * (1 - fall), 0.3 * fall, Math.sin(fn.t * 6) * 0.4 * (1 - fall));
      } else {
        const s = Math.min(1, (fn.t - 1.5) / 0.5);
        const k = 1 - (1 - s) * (1 - s);
        g.position.set(landX, 0.006, THREE.MathUtils.lerp(landZ, fridge.underPos.z, k));
        g.rotation.set(-Math.PI / 2, 0.3, 0);
        if (s >= 1) {
          fn.state = 'under';
          pc.sfx('paper', g.position, 0.6);
          pc.say('Pod lednici. No jistě.', 2.6);
        }
      }
    } else if (fn.state === 'under' || fn.state === 'out') {
      // každé hrábnutí ho kousek povytáhne
      const targetZ = fridge.underPos.z + fn.pulls * 0.075 + (fn.state === 'out' ? 0.08 : 0);
      g.position.z += (targetZ - g.position.z) * Math.min(1, dt * 10);
    }
  },

  restore(pc) {
    const fn = pc.refs.fridgeNote;
    fn.state = 'taken';
    fn.group.visible = false;
    pc.journal.add('note', true);
  },
};
