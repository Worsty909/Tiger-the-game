import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { UI } from '../ui/UI';
import { audio } from '../core/Audio';

/**
 * Interakce: E = tlapka (zmáčknout, vyhrabat, otočit, přitáhnout), F = strčit / shodit.
 * Systém vybere nejbližší dostupný předmět před Tigerem, zobrazí u něj výzvu a natočí k němu hlavu.
 */
export interface InteractVerb {
  label: string | (() => string);
  action: () => void;
  when?: () => boolean;
}

export interface Interactable {
  id: string;
  pos: THREE.Vector3 | (() => THREE.Vector3);
  /** Dosah od hrudi Tigera (m). */
  radius?: number;
  paw?: InteractVerb;
  push?: InteractVerb;
  enabled?: () => boolean;
  /** Jen ve skoku (švih po magnetu). */
  airOnly?: boolean;
  /** Jen při plížení. */
  crouchOnly?: boolean;
  priority?: number;
  /** Předmět na prohlížení z dálky: stačí být poblíž, nemusí být přímo před čenichem. */
  wide?: boolean;
}

const _reach = new THREE.Vector3();
const _p = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _proj = new THREE.Vector3();

export class Interactions {
  private items: Interactable[] = [];
  current: Interactable | null = null;
  /** Zamknutí (cutscény, čtení). */
  locked = false;

  constructor(private game: Game, private ui: UI) {}

  add(item: Interactable): Interactable {
    this.items.push(item);
    return item;
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    if (this.current?.id === id) this.current = null;
  }

  private posOf(i: Interactable): THREE.Vector3 {
    return typeof i.pos === 'function' ? i.pos() : i.pos;
  }

  private verbOk(v?: InteractVerb): boolean {
    return !!v && (!v.when || v.when());
  }

  private label(v: InteractVerb): string {
    return typeof v.label === 'function' ? v.label() : v.label;
  }

  /** Volat v pevném kroku. */
  update(): void {
    const g = this.game;
    const cat = g.cat;
    const inp = g.input;
    if (this.locked || cat.inputLocked || cat.mode === 'scripted') {
      this.current = null;
      this.ui.setPrompt(null);
      g.tiger.anim.lookTarget = null;
      return;
    }
    _fwd.set(Math.sin(cat.yaw), 0, Math.cos(cat.yaw));
    _reach.copy(cat.position).addScaledVector(_fwd, 0.16);
    _reach.y += cat.crouching ? 0.08 : 0.17;
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const inAir = cat.mode === 'air';
    for (const it of this.items) {
      if (it.enabled && !it.enabled()) continue;
      if (it.airOnly && !inAir) continue;
      if (!it.airOnly && inAir) continue;
      if (it.crouchOnly && !cat.crouching) continue;
      if (!this.verbOk(it.paw) && !this.verbOk(it.push)) continue;
      const p = this.posOf(it);
      const r = it.radius ?? 0.42;
      const d = _p.subVectors(p, _reach).length();
      if (d > r) continue;
      // musí být zhruba před Tigerem (u širokých předmětů stačí blízkost)
      if (!it.wide && d > 0.2) {
        const dot = (_p.x * _fwd.x + _p.z * _fwd.z) / Math.max(1e-4, Math.hypot(_p.x, _p.z));
        if (dot < -0.25) continue;
      }
      const score = d / r - (it.priority ?? 0) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    this.current = best;

    // výzva u předmětu
    if (best) {
      const lines: Array<{ key: string; label: string }> = [];
      const pad = inp.usingGamepad;
      if (this.verbOk(best.paw)) lines.push({ key: pad ? 'X' : 'E', label: this.label(best.paw!) });
      if (this.verbOk(best.push)) lines.push({ key: pad ? 'B' : 'F', label: this.label(best.push!) });
      const p = this.posOf(best);
      _proj.copy(p).project(g.gfx.camera);
      if (_proj.z < 1 && Math.abs(_proj.x) < 1.1 && Math.abs(_proj.y) < 1.1) this.ui.setPrompt(lines, _proj.x * 0.5 + 0.5, -_proj.y * 0.5 + 0.5 - 0.07);
      else this.ui.setPrompt(lines);
      g.tiger.anim.lookTarget = p;
    } else {
      this.ui.setPrompt(null);
      g.tiger.anim.lookTarget = null;
    }

    if (inp.wasPressed('paw')) {
      if (best && this.verbOk(best.paw)) {
        g.tiger.anim.swipe(this.posOf(best));
        best.paw!.action();
      } else {
        // naprázdno: jen švihne tlapkou
        _p.copy(_reach).addScaledVector(_fwd, 0.14);
        g.tiger.anim.swipe(_p);
        audio.play('swipe', { pos: _p, volume: 0.6 });
      }
    }
    if (inp.wasPressed('push')) {
      if (best && this.verbOk(best.push)) {
        g.tiger.anim.swipe(this.posOf(best));
        best.push!.action();
      } else {
        this.genericPush();
      }
    }
  }

  /** Strčení do nejbližšího pohyblivého předmětu před Tigerem. */
  genericPush(): boolean {
    const g = this.game;
    const cat = g.cat;
    _fwd.set(Math.sin(cat.yaw), 0, Math.cos(cat.yaw));
    _reach.copy(cat.position).addScaledVector(_fwd, 0.2);
    _reach.y += 0.14;
    let best: (typeof g.physics.bodies)[number] | null = null;
    let bd = 0.62;
    for (const e of g.physics.bodies) {
      if (!e.body.isDynamic()) continue;
      const t = e.body.translation();
      const dx = t.x - _reach.x;
      const dz = t.z - _reach.z;
      const dy = t.y - _reach.y;
      if (Math.abs(dy) > 0.45) continue;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if ((dx * _fwd.x + dz * _fwd.z) / Math.max(d, 1e-3) < 0.1 && d > 0.25) continue;
      bd = d;
      best = e;
    }
    _p.copy(_reach).addScaledVector(_fwd, 0.14);
    g.tiger.anim.swipe(_p);
    if (!best) {
      audio.play('swipe', { pos: _p, volume: 0.6 });
      return false;
    }
    const m = best.body.mass();
    const k = Math.min(m * 1.7, 9);
    const t = best.body.translation();
    best.body.applyImpulseAtPoint({ x: _fwd.x * k, y: k * 0.06, z: _fwd.z * k }, { x: t.x - _fwd.x * 0.05, y: t.y + 0.05, z: t.z - _fwd.z * 0.05 }, true);
    audio.play('bump', { pos: _p });
    return true;
  }
}
