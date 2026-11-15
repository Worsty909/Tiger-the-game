/** Autosave do localStorage po každém vyřešeném kroku. */
export interface SaveData {
  v: 1;
  solved: string[];
  journal: string[];
  flags: Record<string, boolean | number>;
  stats: { time: number; hints: number; wrongCodes: number; golden: boolean };
  cat: { x: number; y: number; z: number; yaw: number };
  /** Polohy pohyblivých předmětů: [x, y, z, qx, qy, qz, qw]. */
  bodies: Record<string, number[]>;
  lockDigits: number[];
  savedAt: number;
}

const KEY = 'tiger.save.v1';

export const Save = {
  has(): boolean {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  },
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return d && d.v === 1 && Array.isArray(d.solved) ? d : null;
    } catch {
      return null;
    }
  },
  write(d: SaveData): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* plné úložiště nebo soukromý režim */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
