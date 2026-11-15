import { bus } from '../core/Events';

/** Tigerův deník: automaticky zapisované stopy. */
export interface JournalEntry {
  id: string;
  title: string;
  text: string;
  kind: 'clue' | 'false' | 'note';
  /** Obrázek stopy (líc, případně rub). */
  image?: () => HTMLCanvasElement;
  back?: () => HTMLCanvasElement;
  /** Tigerův komentář. */
  comment?: string;
}

export class Journal {
  private defs = new Map<string, JournalEntry>();
  readonly found: string[] = [];

  define(entry: JournalEntry): void {
    this.defs.set(entry.id, entry);
  }

  get(id: string): JournalEntry | undefined {
    return this.defs.get(id);
  }

  has(id: string): boolean {
    return this.found.includes(id);
  }

  /** Zapíše stopu; vrací true, pokud je nová. */
  add(id: string, silent = false): boolean {
    if (this.found.includes(id) || !this.defs.has(id)) return false;
    this.found.push(id);
    if (!silent) bus.emit('journal', { id });
    return true;
  }

  entries(): JournalEntry[] {
    return this.found.map((id) => this.defs.get(id)!).filter(Boolean);
  }

  load(ids: string[]): void {
    this.found.length = 0;
    for (const id of ids) if (this.defs.has(id)) this.found.push(id);
  }

  reset(): void {
    this.found.length = 0;
  }
}
