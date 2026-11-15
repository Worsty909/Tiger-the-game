import type { StepDef } from '../PuzzleGraph';
import * as L from '../../world/Labels';

/**
 * Krok 4 – Noční vidění. Pod gaučem je tma; Tiger se tam musí proplížit a se zapnutými smysly
 * najít očkovací průkaz zapadlý až vzadu. Datum narození je politý kávou: „1_. 0_.“
 */
export const cardStep: StepDef = {
  id: 'card',
  title: 'Průkaz pod gaučem',
  requires: ['note'],
  hints: [
    'Narozeniny mívají lidé napsané v papírech. Jeden takový papír mi kdysi spadl pod gauč.',
    'Proplížit se pod gauč (Ctrl) a zapnout smysly (Q) – ve tmě pak vidím jako ve dne.',
    'Průkaz leží vzadu pod gaučem, blíž ke kuchyni. Připlížit se k němu a zmáčknout E.',
  ],
  alwaysUpdate: true,

  setup(pc) {
    const { refs, journal, interact } = pc;
    const card = refs.card;
    journal.define({
      id: 'card',
      title: 'Očkovací průkaz',
      text: 'Jméno: Tiger. Datum narození je zalité kávou – čitelné je jen „1_. 0_.“',
      kind: 'clue',
      image: () => L.vaccinationCard(),
      comment: 'Desátého až devatenáctého… v lednu až září. To je skoro všechno.',
    });
    interact.add({
      id: 'card',
      pos: card.pos,
      radius: 0.36,
      wide: true,
      crouchOnly: true,
      enabled: () => !card.taken && pc.graph.isActive('card'),
      paw: {
        label: 'Vytáhnout',
        action: () => {
          card.taken = true;
          pc.sfx('paper', card.pos);
          pc.later(0.35, () => {
            card.mesh.visible = false;
            pc.discover('card', () => {
              pc.say('Jedna-něco, nula-něco. Káva. Lidé a jejich káva.', 4);
              pc.graph.solve('card');
            });
          });
        },
      },
    });
  },

  update(pc) {
    const { refs, cat, senses } = pc;
    const card = refs.card;
    // se smysly průkaz ve tmě slabě svítí
    card.mat.emissiveIntensity = card.taken ? 0 : senses.nightVision * 0.55;
    const s = refs.sofa;
    const p = cat.position;
    const under = p.x > s.underMin.x && p.x < s.underMax.x && p.z > s.underMin.z && p.z < s.underMax.z && p.y < 0.2;
    if (under && !pc.flags.underSofaSeen) {
      pc.flags.underSofaSeen = true;
      pc.say('Tma jako v pytli. Ještěže mám lepší oči než oni. (Q)', 4);
    }
  },

  restore(pc) {
    const card = pc.refs.card;
    card.taken = true;
    card.mesh.visible = false;
    pc.journal.add('card', true);
    pc.flags.underSofaSeen = true;
  },
};
