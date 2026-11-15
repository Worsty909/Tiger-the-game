/** Malá typovaná sběrnice událostí. */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}

/** Globální herní události (volná vazba mezi hádankami, UI, zvukem a debugem). */
export interface GameEvents extends Record<string, unknown> {
  stepSolved: { id: string };
  stepActivated: { id: string };
  journal: { id: string };
  subtitle: { text: string; duration?: number; speaker?: string };
  toast: { text: string; icon?: string };
  hint: { text: string; level: number };
  stateChanged: { state: string };
  settingsChanged: { key: string };
  achievement: { id: string; title: string };
  sunsetPhase: { phase: number };
  saved: Record<string, never>;
}

export const bus = new Emitter<GameEvents>();
