import { settings, QUALITY, type QualityName, type SettingsData } from '../core/Settings';
import { bus } from '../core/Events';
import type { Action } from '../core/Input';
import type { Journal, JournalEntry } from '../puzzles/Journal';

/** Celé uživatelské rozhraní (DOM nad canvasem). Vše česky, minimalistické. */

export interface UIHooks {
  newGame(): void;
  continueGame(): void;
  resume(): void;
  toMenu(): void;
  hasSave(): boolean;
  /** Zvuk kliknutí apod. */
  sound(name: 'click' | 'paper' | 'chime'): void;
}

export interface Stats {
  time: number;
  hints: number;
  wrongCodes: number;
  golden: boolean;
  journal: number;
  journalTotal: number;
}

type Modal = 'none' | 'menu' | 'pause' | 'journal' | 'reader' | 'settings' | 'controls' | 'credits';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const CONTROLS: Array<[string, string]> = [
  ['W A S D', 'pohyb'],
  ['Myš', 'rozhlížení, kolečko = vzdálenost kamery'],
  ['Shift', 'sprint'],
  ['Ctrl / C', 'plížení (pod gauč)'],
  ['Mezerník', 'skok vpřed · podržet = mířený skok'],
  ['E / levé tlačítko', 'tlapka: zmáčknout, vyhrabat, otočit, přitáhnout'],
  ['F / pravé tlačítko', 'strčit / shodit'],
  ['Q (držet)', 'kočičí smysly: pachy, zvuky, noční vidění'],
  ['H', 'nápověda (Tiger zamňouká)'],
  ['Tab', 'Tigerův deník'],
  ['Esc', 'pauza'],
  ['Gamepad', 'levá páčka pohyb, pravá kamera, A skok, X tlapka, B strčit, LB smysly, RB sprint, LT plížení, Y nápověda'],
];

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class UI {
  modal: Modal = 'none';
  private hud = h('div', 'hud');
  private promptEl = h('div', 'prompt');
  private subEl = h('div', 'subtitle');
  private hintEl = h('div', 'hint');
  private toastWrap = h('div', 'toasts');
  private sensesEl = h('div', 'senses-vignette');
  private titleEl = h('div', 'titlecard');
  private lockEl = h('div', 'lock-ui');
  private skipEl = h('div', 'skip', 'Přeskočit: <b>Enter</b>');
  private fadeEl = h('div', 'fade');
  private overlay = h('div', 'overlay');
  private subQueue: Array<{ text: string; dur: number }> = [];
  private subTimer = 0;
  private hintTimer = 0;
  private readerClose: (() => void) | null = null;
  private prevModal: Modal = 'none';
  private focusIndex = 0;

  constructor(private root: HTMLElement, private journal: Journal, private hooks: UIHooks) {
    this.hud.append(this.sensesEl, this.promptEl, this.subEl, this.hintEl, this.toastWrap, this.titleEl, this.lockEl, this.skipEl);
    root.append(this.hud, this.overlay, this.fadeEl);
    bus.on('journal', ({ id }) => {
      const e = this.journal.get(id);
      if (e) this.toast(`Deník: ${e.title}`, '✎');
    });
    bus.on('achievement', ({ title }) => this.toast(`Úspěch: ${title}`, '★'));
  }

  // ------------------------------------------------------------------ HUD
  setHudVisible(v: boolean): void {
    this.hud.style.opacity = v ? '1' : '0';
  }

  /** Výzva k interakci. `x`,`y` = poloha na obrazovce (0..1), jinak dole uprostřed. */
  setPrompt(lines: Array<{ key: string; label: string }> | null, x?: number, y?: number): void {
    if (!lines || !lines.length) {
      this.promptEl.classList.remove('show');
      return;
    }
    const html = lines.map((l) => `<span class="key">${l.key}</span><span class="label">${l.label}</span>`).join('');
    if (this.promptEl.dataset.html !== html) {
      this.promptEl.innerHTML = html;
      this.promptEl.dataset.html = html;
    }
    if (x !== undefined && y !== undefined) {
      this.promptEl.style.left = `${Math.min(88, Math.max(12, x * 100))}%`;
      this.promptEl.style.top = `${Math.min(84, Math.max(10, y * 100))}%`;
    } else {
      this.promptEl.style.left = '50%';
      this.promptEl.style.top = '72%';
    }
    this.promptEl.classList.add('show');
  }

  /** Titulek s Tigerovou myšlenkou. */
  say(text: string, duration = 3.6): void {
    if (!settings.data.subtitles) return;
    // nezdvojovat stejný text
    if (this.subQueue.some((s) => s.text === text) || (this.subTimer > 0 && this.subEl.textContent === text)) return;
    this.subQueue.push({ text, dur: duration });
  }

  clearSubtitles(): void {
    this.subQueue.length = 0;
    this.subTimer = 0;
    this.subEl.classList.remove('show');
  }

  toast(text: string, icon = ''): void {
    const t = h('div', 'toast', `${icon ? `<span class="ico">${icon}</span>` : ''}${text}`);
    this.toastWrap.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 500);
    }, 3600);
  }

  hint(text: string, level: number): void {
    this.hintEl.innerHTML = `<div class="hint-head">Nápověda ${'●'.repeat(level)}${'○'.repeat(3 - level)}</div><div>${text}</div>`;
    this.hintEl.classList.add('show');
    this.hintTimer = 9;
  }

  setSenses(amount: number): void {
    this.sensesEl.style.opacity = String(amount);
  }

  showTitle(text: string, sub = ''): void {
    this.titleEl.innerHTML = `<div class="t1">${text}</div>${sub ? `<div class="t2">${sub}</div>` : ''}`;
    this.titleEl.classList.add('show');
  }
  hideTitle(): void {
    this.titleEl.classList.remove('show');
  }

  showSkip(v: boolean): void {
    this.skipEl.classList.toggle('show', v);
  }

  setFade(v: number): void {
    this.fadeEl.style.opacity = String(v);
  }

  /** Překryv kódového zámku. */
  showLock(digits: number[], sel: number, message = '', locked = false): void {
    const d = digits.map((n, i) => `<span class="digit${i === sel ? ' sel' : ''}">${n}</span>`).join('');
    this.lockEl.innerHTML = `<div class="lock-digits${locked ? ' locked' : ''}">${d}</div>
      <div class="lock-help"><b>A / D</b> kolečko · <b>W / S</b> otočit · <b>E</b> zkusit · <b>Esc</b> odejít</div>
      <div class="lock-msg">${message}</div>`;
    this.lockEl.classList.add('show');
  }
  hideLock(): void {
    this.lockEl.classList.remove('show');
  }

  // ------------------------------------------------------------------ modály
  private open(m: Modal, content: HTMLElement): void {
    this.modal = m;
    this.overlay.innerHTML = '';
    this.overlay.append(content);
    this.overlay.className = `overlay show ${m}`;
    this.focusIndex = 0;
    this.updateFocus();
  }

  closeModal(): void {
    this.modal = 'none';
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = '';
    const rc = this.readerClose;
    this.readerClose = null;
    rc?.();
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.overlay.querySelectorAll<HTMLButtonElement>('button.menu-btn:not([disabled])')];
  }

  private updateFocus(): void {
    const b = this.buttons();
    b.forEach((el, i) => el.classList.toggle('focus', i === this.focusIndex));
  }

  private button(label: string, fn: () => void, disabled = false): HTMLButtonElement {
    const b = h('button', 'menu-btn', label);
    b.disabled = disabled;
    b.addEventListener('click', () => {
      this.hooks.sound('click');
      fn();
    });
    b.addEventListener('mouseenter', () => {
      this.focusIndex = this.buttons().indexOf(b);
      this.updateFocus();
    });
    return b;
  }

  showMenu(): void {
    const box = h('div', 'menu');
    box.append(h('div', 'menu-title', 'Tiger'), h('div', 'menu-sub', 'úniková hra jedné bengálské kočky'));
    const list = h('div', 'menu-list');
    list.append(
      this.button('Nová hra', () => this.hooks.newGame()),
      this.button('Pokračovat', () => this.hooks.continueGame(), !this.hooks.hasSave()),
      this.button('Nastavení', () => this.showSettings('menu')),
      this.button('Ovládání', () => this.showControls('menu')),
    );
    box.append(list, h('div', 'menu-foot', 'Assety: Poly Haven (CC0) · Vytvořeno v Three.js'));
    this.open('menu', box);
  }

  showPause(): void {
    const box = h('div', 'panel');
    box.append(h('div', 'panel-title', 'Pauza'));
    const list = h('div', 'menu-list');
    list.append(
      this.button('Pokračovat ve hře', () => this.hooks.resume()),
      this.button('Tigerův deník', () => this.showJournal('pause')),
      this.button('Nastavení', () => this.showSettings('pause')),
      this.button('Ovládání', () => this.showControls('pause')),
      this.button('Hlavní menu', () => this.hooks.toMenu()),
    );
    box.append(list, h('div', 'panel-note', 'Hra se ukládá automaticky po každém vyřešeném kroku.'));
    this.open('pause', box);
  }

  private back(to: Modal): void {
    if (to === 'menu') this.showMenu();
    else if (to === 'pause') this.showPause();
    else this.hooks.resume();
  }

  showControls(from: Modal): void {
    this.prevModal = from;
    const box = h('div', 'panel wide');
    box.append(h('div', 'panel-title', 'Ovládání'));
    const table = h('div', 'controls');
    for (const [k, v] of CONTROLS) table.append(h('div', 'ck', k), h('div', 'cv', v));
    box.append(table, this.button('Zpět', () => this.back(from)));
    this.open('controls', box);
  }

  showSettings(from: Modal): void {
    this.prevModal = from;
    const box = h('div', 'panel wide');
    box.append(h('div', 'panel-title', 'Nastavení'));
    const grid = h('div', 'settings');
    const row = (label: string, control: HTMLElement) => grid.append(h('label', 'sl', label), control);
    // kvalita
    const q = h('select', 'sel');
    for (const key of Object.keys(QUALITY) as QualityName[]) {
      const o = h('option', '', QUALITY[key].label);
      o.value = key;
      o.selected = settings.data.quality === key;
      q.append(o);
    }
    const note = h('div', 'panel-note', '');
    q.addEventListener('change', () => {
      settings.set('quality', q.value as QualityName);
      note.innerHTML = 'Změna kvality se projeví po znovunačtení hry. ';
      const r = h('button', 'link-btn', 'Načíst znovu');
      r.addEventListener('click', () => location.reload());
      note.append(r);
    });
    row('Kvalita grafiky', q);
    const range = (key: keyof SettingsData, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const wrap = h('div', 'range');
      const r = h('input');
      r.type = 'range';
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      r.value = String(settings.data[key]);
      const val = h('span', 'range-val', fmt(Number(r.value)));
      r.addEventListener('input', () => {
        settings.set(key, Number(r.value) as never);
        val.textContent = fmt(Number(r.value));
      });
      wrap.append(r, val);
      return wrap;
    };
    const check = (key: keyof SettingsData) => {
      const c = h('input');
      c.type = 'checkbox';
      c.checked = Boolean(settings.data[key]);
      c.addEventListener('change', () => settings.set(key, c.checked as never));
      return c;
    };
    row('Citlivost myši', range('mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2) + '×'));
    row('Invertovat osu Y', check('invertY'));
    row('Zorné pole (FOV)', range('fov', 50, 100, 1, (v) => v.toFixed(0) + '°'));
    row('Hlasitost hudby', range('musicVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + ' %'));
    row('Hlasitost efektů', range('sfxVolume', 0, 1, 0.01, (v) => Math.round(v * 100) + ' %'));
    row('Titulky', check('subtitles'));
    row('Srst', check('fur'));
    box.append(grid, note, this.button('Zpět', () => this.back(from)));
    this.open('settings', box);
  }

  showJournal(from: Modal = 'none'): void {
    this.prevModal = from;
    const box = h('div', 'panel journal-panel');
    box.append(h('div', 'panel-title', 'Tigerův deník'));
    const list = h('div', 'journal-list');
    const entries = this.journal.entries();
    if (!entries.length) list.append(h('div', 'journal-empty', 'Zatím nic. Čenich dolů, uši nahoru.'));
    for (const e of entries) {
      const item = h('div', `journal-item ${e.kind}`);
      if (e.image) {
        const c = e.image();
        c.className = 'journal-thumb';
        item.append(c);
      } else item.append(h('div', 'journal-thumb empty', e.kind === 'false' ? '?' : '✎'));
      const body = h('div', 'journal-body');
      body.append(h('div', 'journal-title', e.title), h('div', 'journal-text', e.text));
      if (e.comment) body.append(h('div', 'journal-comment', `„${e.comment}“`));
      item.append(body);
      item.addEventListener('click', () => this.read(e, () => this.showJournal(from)));
      list.append(item);
    }
    box.append(list, this.button('Zavřít', () => this.back(from)));
    this.open('journal', box);
  }

  /** Detail stopy (lísteček, fotka…). */
  read(entry: JournalEntry, onClose?: () => void): void {
    const box = h('div', 'reader');
    const pics = h('div', 'reader-pics');
    if (entry.image) pics.append(entry.image());
    if (entry.back) pics.append(entry.back());
    box.append(pics, h('div', 'reader-title', entry.title), h('div', 'reader-text', entry.text));
    if (entry.comment) box.append(h('div', 'reader-comment', `„${entry.comment}“`));
    box.append(this.button('Zavřít (E)', () => this.closeModal()));
    this.hooks.sound('paper');
    this.open('reader', box);
    this.readerClose = onClose ?? (() => this.hooks.resume());
  }

  showCredits(stats: Stats): void {
    const box = h('div', 'credits');
    box.innerHTML = `
      <div class="credits-title">Tiger</div>
      <div class="credits-sub">Západ slunce. Plné břicho. Svět je zase v pořádku.</div>
      <div class="stats">
        <div><span>Čas</span><b>${formatTime(stats.time)}</b></div>
        <div><span>Nápovědy</span><b>${stats.hints}</b></div>
        <div><span>Špatné pokusy o kód</span><b>${stats.wrongCodes}</b></div>
        <div><span>Stopy v deníku</span><b>${stats.journal} / ${stats.journalTotal}</b></div>
        <div><span>Zlatý pamlsek</span><b>${stats.golden ? 'nalezen ★ Král výšek' : 'nenalezen'}</b></div>
      </div>
      <div class="credits-roll">
        <p><b>Hra a kód</b><br/>vytvořeno v Three.js, Rapier, postprocessing a N8AO</p>
        <p><b>Modely, textury a HDRI</b><br/>Poly Haven (CC0)</p>
        <p><b>V hlavní roli</b><br/>Tiger, bengálská kočka</p>
        <p class="thanks">Děkujeme za hraní.</p>
      </div>`;
    const btn = this.button('Hlavní menu', () => this.hooks.toMenu());
    box.append(btn);
    this.open('credits', box);
  }

  // ------------------------------------------------------------------ vstup
  /** Zpracuje akci, pokud je otevřený modál. Vrací true, když ji spotřebovalo. */
  handleAction(a: Action): boolean {
    if (this.modal === 'none') return false;
    if (this.modal === 'reader') {
      if (a === 'paw' || a === 'pause' || a === 'confirm' || a === 'back' || a === 'jump') this.closeModal();
      return true;
    }
    if (this.modal === 'journal' && (a === 'journal' || a === 'pause' || a === 'back')) {
      this.back(this.prevModal);
      return true;
    }
    if ((this.modal === 'settings' || this.modal === 'controls') && (a === 'pause' || a === 'back')) {
      this.back(this.prevModal);
      return true;
    }
    if (this.modal === 'pause' && (a === 'pause' || a === 'back')) {
      this.hooks.resume();
      return true;
    }
    if (a === 'confirm' || a === 'paw' || a === 'jump') {
      const b = this.buttons()[this.focusIndex];
      b?.click();
      return true;
    }
    return true;
  }

  /** Šipky / WSAD v menu. */
  navigate(dir: number): void {
    const b = this.buttons();
    if (!b.length) return;
    this.focusIndex = (this.focusIndex + dir + b.length) % b.length;
    this.updateFocus();
  }

  update(dt: number): void {
    // titulky
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) this.subEl.classList.remove('show');
    } else if (this.subQueue.length) {
      const s = this.subQueue.shift()!;
      this.subEl.textContent = s.text;
      this.subEl.classList.add('show');
      this.subTimer = s.dur;
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.classList.remove('show');
    }
  }
}
