import type * as THREE from 'three';
import type { Game } from '../core/Game';
import type { WorldCtx, Refs } from '../world/Ctx';
import type { CatController } from '../cat/CatController';
import type { Tiger } from '../cat/Tiger';
import type { Senses } from '../cat/Senses';
import type { UI } from '../ui/UI';
import type { Journal } from './Journal';
import type { Interactions } from './Interact';
import type { PuzzleGraph } from './PuzzleGraph';
import type { Sfx } from '../core/Audio';

export interface GameStats {
  hints: number;
  wrongCodes: number;
  golden: boolean;
}

/** Vše, co moduly hádanek potřebují. */
export interface PuzzleCtx {
  game: Game;
  world: WorldCtx;
  refs: Refs;
  cat: CatController;
  tiger: Tiger;
  senses: Senses;
  ui: UI;
  journal: Journal;
  interact: Interactions;
  graph: PuzzleGraph;
  stats: GameStats;
  /** Sdílený stav mezi kroky (ukládá se). */
  flags: Record<string, boolean | number>;
  /** Tigerova myšlenka v titulcích. */
  say(text: string, duration?: number): void;
  sfx(name: Sfx, pos?: THREE.Vector3, volume?: number, pitch?: number): void;
  /** Otevře detail stopy a zapíše ji do deníku. */
  discover(id: string, after?: () => void): void;
  /** Spustí funkci za `seconds` herního času. */
  later(seconds: number, fn: () => void): void;
}
