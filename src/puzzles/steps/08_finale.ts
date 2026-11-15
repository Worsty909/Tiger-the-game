import type { StepDef } from '../PuzzleGraph';
import { BALCONY } from '../../world/Layout';

/**
 * Krok 8 – Finále. Tiger vyjde na balkon, sedne si a dívá se na západ slunce nad střechami.
 * Samotnou scénu (kamera, titulky, statistika) řídí GameFlow.
 */
export const finaleStep: StepDef = {
  id: 'finale',
  title: 'Balkon',
  requires: ['vacuum'],
  hints: [
    'Dveře jsou otevřené. Venku zapadá slunce.',
    'Vyjdi na balkon.',
    'Projdi otevřenými balkonovými dveřmi ven – tam už jen sedět a dívat se.',
  ],

  setup() {
    /* nic k přípravě */
  },

  update(pc) {
    const p = pc.cat.position;
    if (p.x < BALCONY.maxX - 0.12 && pc.cat.mode === 'ground' && pc.graph.isActive('finale')) {
      pc.graph.solve('finale');
      pc.game.flow.startFinale();
    }
  },
};
