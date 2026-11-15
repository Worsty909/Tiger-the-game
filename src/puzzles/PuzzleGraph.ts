import { bus } from '../core/Events';
import type { PuzzleCtx } from './PuzzleCtx';

/**
 * Datově řízený graf hádanek. Každý krok je samostatný modul (StepDef) se závislostmi;
 * krok se aktivuje, jakmile jsou vyřešené všechny kroky z `requires`.
 * Další místnost = další pole StepDef předané do `PuzzleGraph`.
 */
export type StepState = 'locked' | 'active' | 'solved';

export interface StepDef {
  id: string;
  /** Krátký název (deník, debug). */
  title: string;
  requires: string[];
  /** Volitelný krok neblokuje postup a nepočítá se do nápověd, dokud není hlavní hotový. */
  optional?: boolean;
  /** Tři úrovně nápovědy: od jemné po přímou. */
  hints: [string, string, string];
  /** Jednorázová příprava (interakce, rekvizity). Volá se pro všechny kroky při startu. */
  setup(pc: PuzzleCtx): void;
  onActivate?(pc: PuzzleCtx): void;
  /** Pevný krok simulace (běží i po vyřešení, pokud `alwaysUpdate`). */
  update?(pc: PuzzleCtx, dt: number): void;
  alwaysUpdate?: boolean;
  /** Okamžitě uvede svět do stavu „vyřešeno“ (načtení hry, debug). */
  restore?(pc: PuzzleCtx): void;
  /** Vrátí krok do výchozího stavu (nová hra bez znovunačtení stránky není podporována → nepovinné). */
}

export class PuzzleGraph {
  readonly steps = new Map<string, StepDef>();
  readonly order: string[] = [];
  private state = new Map<string, StepState>();
  private pc!: PuzzleCtx;

  constructor(defs: StepDef[]) {
    for (const d of defs) {
      this.steps.set(d.id, d);
      this.order.push(d.id);
      this.state.set(d.id, 'locked');
    }
    for (const d of defs) for (const r of d.requires) if (!this.steps.has(r)) throw new Error(`Krok ${d.id} závisí na neznámém kroku ${r}`);
  }

  init(pc: PuzzleCtx): void {
    this.pc = pc;
    for (const id of this.order) this.steps.get(id)!.setup(pc);
  }

  /** Spustí hru od začátku nebo z uloženého stavu. */
  start(solved: string[] = []): void {
    for (const id of this.order) {
      if (solved.includes(id)) {
        this.state.set(id, 'solved');
        this.steps.get(id)!.restore?.(this.pc);
      }
    }
    this.refresh();
  }

  private refresh(): void {
    for (const id of this.order) {
      if (this.state.get(id) !== 'locked') continue;
      const d = this.steps.get(id)!;
      if (d.requires.every((r) => this.state.get(r) === 'solved')) {
        this.state.set(id, 'active');
        d.onActivate?.(this.pc);
        bus.emit('stepActivated', { id });
      }
    }
  }

  stateOf(id: string): StepState {
    return this.state.get(id) ?? 'locked';
  }
  isSolved(id: string): boolean {
    return this.state.get(id) === 'solved';
  }
  isActive(id: string): boolean {
    return this.state.get(id) === 'active';
  }

  /** Označí krok za vyřešený (jen aktivní krok). */
  solve(id: string): boolean {
    if (this.state.get(id) !== 'active') return false;
    this.state.set(id, 'solved');
    bus.emit('stepSolved', { id });
    this.refresh();
    return true;
  }

  /** Debug: vyřeší krok okamžitě včetně stavu světa (a všech jeho závislostí). */
  forceSolve(id: string): void {
    const d = this.steps.get(id);
    if (!d || this.state.get(id) === 'solved') return;
    for (const r of d.requires) this.forceSolve(r);
    if (this.state.get(id) === 'locked') {
      this.state.set(id, 'active');
      d.onActivate?.(this.pc);
    }
    d.restore?.(this.pc);
    this.state.set(id, 'solved');
    bus.emit('stepSolved', { id });
    this.refresh();
  }

  solved(): string[] {
    return this.order.filter((id) => this.state.get(id) === 'solved');
  }

  /** Počet vyřešených hlavních (nevolitelných) kroků – řídí fázi západu slunce. */
  mainSolved(): number {
    return this.order.filter((id) => !this.steps.get(id)!.optional && this.state.get(id) === 'solved').length;
  }

  /** Krok, ke kterému se vztahuje nápověda: první aktivní hlavní, jinak první aktivní volitelný. */
  current(): StepDef | null {
    const active = this.order.filter((id) => this.state.get(id) === 'active').map((id) => this.steps.get(id)!);
    return active.find((d) => !d.optional) ?? active[0] ?? null;
  }

  update(dt: number): void {
    for (const id of this.order) {
      const d = this.steps.get(id)!;
      if (!d.update) continue;
      const s = this.state.get(id);
      if (s === 'active' || (d.alwaysUpdate && s !== 'locked') || (d.alwaysUpdate && d.requires.length === 0)) d.update(this.pc, dt);
    }
  }
}
