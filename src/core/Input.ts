import { settings } from './Settings';

/** Abstraktní herní akce – klávesnice, myš i gamepad se mapují sem. */
export type Action =
  | 'jump'
  | 'paw'
  | 'push'
  | 'senses'
  | 'sprint'
  | 'crouch'
  | 'hint'
  | 'journal'
  | 'pause'
  | 'confirm'
  | 'back';

const KEYMAP: Record<string, Action> = {
  Space: 'jump',
  KeyE: 'paw',
  KeyF: 'push',
  KeyQ: 'senses',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
  KeyH: 'hint',
  Tab: 'journal',
  Escape: 'pause',
  Enter: 'confirm',
  Backspace: 'back',
};

// Standardní rozložení gamepadu (Xbox): A=0, B=1, X=2, Y=3, LB=4, RB=5, LT=6, RT=7, Back=8, Start=9
const PADMAP: Array<[number, Action]> = [
  [0, 'jump'],
  [2, 'paw'],
  [1, 'push'],
  [4, 'senses'],
  [5, 'sprint'],
  [6, 'crouch'],
  [7, 'sprint'],
  [3, 'hint'],
  [8, 'journal'],
  [9, 'pause'],
];

export class Input {
  /** Pohyb: x = do strany (+ vpravo), y = dopředu. Délka ≤ 1. */
  readonly move = { x: 0, y: 0 };
  /** Rozhlížení v radiánech za tento snímek (už včetně citlivosti). */
  readonly look = { x: 0, y: 0 };
  wheel = 0;
  pointerLocked = false;
  /** Když je false, herní vstupy se ignorují (menu, deník…). */
  gameplayEnabled = false;
  usingGamepad = false;

  private keys = new Set<string>();
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private padHeld = new Set<Action>();
  private virtualHeld = new Set<Action>();
  private virtualMove: { x: number; y: number } | null = null;
  private mouseDX = 0;
  private mouseDY = 0;
  private listeners: Array<(a: Action) => void> = [];

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.gameplayEnabled) return;
      if (!this.pointerLocked) this.requestLock();
      else if (e.button === 0) this.tap('paw');
      else if (e.button === 2) this.tap('push');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Posluchač jednorázových stisků (i mimo gameplay – pro UI). */
  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  requestLock(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* headless prohlížeč nebo odmítnutý zámek */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    const action = KEYMAP[e.code];
    if (e.code === 'Tab' || e.code === 'Space' || (e.ctrlKey && this.gameplayEnabled && e.code !== 'KeyR')) {
      // Tab nesmí přeskakovat fokus, mezerník rolovat, Ctrl+W/S/D zavírat stránku
      if (this.gameplayEnabled || e.code === 'Tab') e.preventDefault();
    }
    if (down) {
      if (this.keys.has(e.code)) return; // auto-repeat
      this.keys.add(e.code);
      this.usingGamepad = false;
      if (action) this.press(action);
    } else {
      this.keys.delete(e.code);
      if (action && !this.isAnyKeyFor(action)) this.release(action);
    }
  }

  private isAnyKeyFor(action: Action): boolean {
    for (const k of this.keys) if (KEYMAP[k] === action) return true;
    return false;
  }

  private press(a: Action): void {
    if (!this.held.has(a)) {
      this.held.add(a);
      this.pressed.add(a);
      for (const fn of this.listeners) fn(a);
    }
  }

  private release(a: Action): void {
    if (this.held.has(a)) {
      this.held.delete(a);
      this.released.add(a);
    }
  }

  /** Krátký stisk (myš, debug API). */
  tap(a: Action): void {
    this.press(a);
    queueMicrotask(() => this.release(a));
  }

  /** Virtuální vstupy pro automatické testy. */
  setVirtual(move: { x: number; y: number } | null, held: Action[] = []): void {
    this.virtualMove = move;
    for (const a of [...this.virtualHeld]) {
      if (!held.includes(a)) {
        this.virtualHeld.delete(a);
        this.release(a);
      }
    }
    for (const a of held) {
      if (!this.virtualHeld.has(a)) {
        this.virtualHeld.add(a);
        this.press(a);
      }
    }
  }

  addLook(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  isHeld(a: Action): boolean {
    return this.gameplayEnabled && this.held.has(a);
  }
  wasPressed(a: Action): boolean {
    return this.gameplayEnabled && this.pressed.has(a);
  }
  wasReleased(a: Action): boolean {
    return this.gameplayEnabled && this.released.has(a);
  }

  /** Volat jednou za snímek před herní logikou. */
  update(dt: number): void {
    // --- gamepad ---
    let padX = 0;
    let padY = 0;
    let padLX = 0;
    let padLY = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? [...pads].find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
      padX = dz(pad.axes[0] ?? 0);
      padY = -dz(pad.axes[1] ?? 0);
      padLX = dz(pad.axes[2] ?? 0);
      padLY = dz(pad.axes[3] ?? 0);
      if (padX || padY || padLX || padLY) this.usingGamepad = true;
      for (const [idx, action] of PADMAP) {
        const b = pad.buttons[idx];
        const down = !!b && (b.pressed || b.value > 0.5);
        if (down && !this.padHeld.has(action)) {
          this.padHeld.add(action);
          this.usingGamepad = true;
          this.press(action);
        } else if (!down && this.padHeld.has(action)) {
          this.padHeld.delete(action);
          if (!this.isAnyKeyFor(action)) this.release(action);
        }
      }
    }

    // --- pohyb ---
    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    mx += padX;
    my += padY;
    if (this.virtualMove) {
      mx += this.virtualMove.x;
      my += this.virtualMove.y;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const on = this.gameplayEnabled;
    this.move.x = on ? mx : 0;
    this.move.y = on ? my : 0;

    // --- rozhlížení ---
    const s = settings.data.mouseSensitivity;
    const inv = settings.data.invertY ? -1 : 1;
    this.look.x = on ? this.mouseDX * 0.0022 * s + padLX * 2.6 * s * dt : 0;
    this.look.y = on ? (this.mouseDY * 0.0022 * s + padLY * 1.9 * s * dt) * inv : 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Volat na konci snímku. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
  }

  clear(): void {
    this.keys.clear();
    for (const a of [...this.held]) this.release(a);
    this.padHeld.clear();
    this.virtualHeld.clear();
    this.virtualMove = null;
  }
}
