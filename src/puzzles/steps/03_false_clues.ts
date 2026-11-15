import type { StepDef } from '../PuzzleGraph';
import * as L from '../../world/Labels';

/**
 * Krok 3 – Falešné stopy (volitelné). Kalendář, svatební fotka a lísteček na televizi:
 * všechny nabízejí čísla, žádné není kód. Zapisují se do deníku.
 */
const IDS = ['calendar', 'wedding', 'tvpin'];

export const falseCluesStep: StepDef = {
  id: 'falseClues',
  title: 'Falešné stopy',
  requires: ['note'],
  optional: true,
  hints: [
    'Lidé si píšou čísla všude možně. Ne všechna jsou moje narozeniny.',
    'Kalendář u kuchyně, fotka na komodě, lísteček na televizi – prohlédni si je (E).',
    'Žádné z těch čísel není kód. Kód jsou MOJE narozeniny – hledej průkaz a moji fotku.',
  ],

  setup(pc) {
    const { refs, journal, interact } = pc;
    journal.define({
      id: 'calendar',
      title: 'Nástěnný kalendář',
      text: 'Červenec, zakroužkované 22. 7. – „Tomáš – narozky!“',
      kind: 'false',
      image: () => L.calendar(),
      comment: 'To jsou narozeniny Tomáše. Ten pamlsky nedostává.',
    });
    journal.define({
      id: 'wedding',
      title: 'Svatební fotka',
      text: '„Jana & Tomáš, 9. 5. 2019.“ Hezká fotka. Chybím na ní.',
      kind: 'false',
      image: () => L.weddingPhoto(),
      comment: 'Svatba. Bez kočky. Neplatné.',
    });
    journal.define({
      id: 'tvpin',
      title: 'Lísteček na televizi',
      text: '„PIN k TV: 2580.“ Čtyři číslice – ale k televizi, ne ke skříňce.',
      kind: 'false',
      image: () => L.tvNote(),
      comment: 'Čtyři číslice! …k televizi. Škoda.',
    });
    const check = () => {
      if (IDS.every((id) => journal.has(id)) && pc.graph.isActive('falseClues')) {
        pc.graph.solve('falseClues');
        pc.say('Samá čísla, žádné moje. Lidé jsou zvláštní.', 4);
      }
    };
    const add = (id: string, pos: () => { x: number; y: number; z: number }, radius: number) => {
      interact.add({
        id: 'clue_' + id,
        pos: pos as never,
        radius,
        wide: true,
        enabled: () => !journal.has(id),
        paw: { label: 'Prohlédnout', action: () => pc.discover(id, check) },
      });
    };
    add('calendar', () => refs.calendar.pos, 1.75);
    add('wedding', () => refs.weddingPhoto.pos, 1.2);
    add('tvpin', () => refs.tvNote.pos, 1.15);
  },

  restore(pc) {
    for (const id of IDS) pc.journal.add(id, true);
  },
};
