import * as THREE from 'three';
import type { Game } from './Game';
import { Save, type SaveData } from './Save';
import { audio, type LoopHandle } from './Audio';
import { bus } from './Events';
import { BALCONY, BALCONY_DOOR, ROOM } from '../world/Layout';
import { SUNSET_PHASE, OBSOLETE_AFTER } from '../puzzles/rooms/livingRoom';

/**
 * Herní tok: hlavní menu s živou scénou, úvodní scéna, pauza, nápovědy, autosave a finále.
 */
export class Flow {
  private introT = -1;
  private introStage = 0;
  private finaleT = -1;
  private creditsShown = false;
  private hintLevel = new Map<string, { level: number; at: number }>();
  private started = false;
  private purr: LoopHandle | null = null;
  private fridgeHum: LoopHandle | null = null;
  private city: LoopHandle | null = null;
  private tickAcc = 0;
  private blink = 0;
  private menuT = 0;

  constructor(private game: Game) {
    bus.on('stepSolved', ({ id }) => this.onSolved(id));
  }

  // ------------------------------------------------------------------ menu
  showMenu(): void {
    const g = this.game;
    g.setState('menu');
    g.ui.setHudVisible(false);
    g.ui.showMenu();
    g.input.exitLock();
    this.sleepOnSofa();
    this.menuT = 0;
  }

  private sleepOnSofa(): void {
    const g = this.game;
    const sofa = g.ctx.refs.sofa;
    g.cat.teleport(sofa.sleepPos, Math.PI * 0.42);
    g.cat.mode = 'scripted';
    g.tiger.anim.action = 'sleep';
    g.tiger.snap();
  }

  /** Pomalý pohyb kamery nad živou scénou v menu. */
  private updateMenuCamera(dt: number): void {
    this.menuT += dt;
    const t = this.menuT;
    const a = Math.sin(t * 0.045) * 0.5;
    this.game.camera.cutToShot({
      position: new THREE.Vector3(1.55 + Math.sin(a) * 0.5, 1.05 + Math.sin(t * 0.07) * 0.08, 2.0 - Math.cos(a) * 0.25),
      target: new THREE.Vector3(-1.0, 0.62, 0.25),
      fov: 42,
    });
  }

  private startAmbience(): void {
    if (this.fridgeHum) return;
    const refs = this.game.ctx.refs;
    this.fridgeHum = audio.loop('fridge', refs.fridge.hum, 1);
    this.city = audio.loop('city', new THREE.Vector3(ROOM.minX - 0.4, 1.2, BALCONY_DOOR.z0 + 0.4), 0.5);
  }

  // ------------------------------------------------------------------ nová hra / pokračování
  newGame(): void {
    if (this.started) {
      // svět už je rozehraný → čistý start přes znovunačtení stránky
      Save.clear();
      this.reload('new');
      return;
    }
    Save.clear();
    this.started = true;
    audio.unlock();
    this.startAmbience();
    const g = this.game;
    g.ui.closeModal();
    g.graph.start([]);
    this.startIntro();
  }

  continueGame(): void {
    const data = Save.load();
    if (!data) {
      this.newGame();
      return;
    }
    if (this.started) {
      this.reload('continue');
      return;
    }
    this.started = true;
    audio.unlock();
    this.startAmbience();
    const g = this.game;
    g.ui.closeModal();
    this.applySave(data);
    this.beginPlay();
  }

  private reload(mode: string): void {
    const url = new URL(location.href);
    url.searchParams.set('autostart', mode);
    location.href = url.toString();
  }

  toMenu(): void {
    // návrat do menu = znovunačtení (svět se vrátí do výchozího stavu, uložená hra zůstává)
    const url = new URL(location.href);
    url.searchParams.delete('autostart');
    location.href = url.toString();
  }

  /** Spuštění bez intra (testy, ?autostart). */
  startDirect(): void {
    if (this.started) return;
    this.started = true;
    this.startAmbience();
    this.game.ui.closeModal();
    this.game.graph.start([]);
    this.game.cat.teleport(new THREE.Vector3(-0.9, 0.02, -0.45), -Math.PI / 2);
    this.game.tiger.snap();
    this.beginPlay();
  }

  private beginPlay(): void {
    const g = this.game;
    g.cat.mode = 'ground';
    g.cat.inputLocked = false;
    g.tiger.anim.action = 'none';
    g.camera.setShot(null, 3);
    g.camera.resetBehind();
    g.ui.setHudVisible(true);
    g.ui.hideTitle();
    g.ui.showSkip(false);
    g.setState('playing');
    g.input.requestLock();
    this.syncPhase(true);
  }

  // ------------------------------------------------------------------ úvodní scéna
  private startIntro(): void {
    const g = this.game;
    g.setState('intro');
    g.ui.setHudVisible(true);
    g.ui.showSkip(true);
    this.sleepOnSofa();
    this.introT = 0;
    this.introStage = 0;
    g.lighting.setPhaseImmediate(0);
    g.ui.setFade(1);
  }

  skipIntro(): void {
    if (this.introT < 0) return;
    this.endIntro();
  }

  private endIntro(): void {
    const g = this.game;
    this.introT = -1;
    g.ui.setFade(0);
    g.ui.clearSubtitles();
    g.ctx.refs.feeder.error = true;
    g.tiger.anim.action = 'none';
    g.tiger.snap();
    this.beginPlay();
    g.cat.yaw = Math.PI * 0.42;
    g.camera.resetBehind();
    g.later(1.2, () => g.pc.say('Hlad. A dávkovač hlásí ERROR. Zapojíme čich. (Q)', 5));
  }

  private updateIntro(dt: number): void {
    const g = this.game;
    this.introT += dt;
    const t = this.introT;
    const refs = g.ctx.refs;
    const sofa = refs.sofa;
    g.ui.setFade(Math.max(0, 1 - t / 1.8));
    const stage = (n: number, at: number, fn: () => void) => {
      if (this.introStage === n && t >= at) {
        this.introStage++;
        fn();
      }
    };
    // záběr 1: Tiger spí na gauči ve zlatém světle
    if (t < 4.2) {
      const k = t / 4.2;
      g.camera.cutToShot({
        position: new THREE.Vector3(sofa.cx - 1.25 + k * 0.25, 0.86, sofa.cz + 1.45),
        target: new THREE.Vector3(sofa.sleepPos.x + 0.05, sofa.sleepPos.y + 0.1, sofa.sleepPos.z),
        fov: 34,
      });
    }
    stage(0, 2.6, () => {
      audio.play('doorLock', { pos: refs.entryDoorPos });
      g.ui.say('Klap. Zámek. Jana a Tomáš odjeli na víkend.', 3.4);
    });
    // záběr 2: vchodové dveře
    if (t >= 4.2 && t < 7.2) {
      const k = (t - 4.2) / 3;
      g.camera.cutToShot({ position: new THREE.Vector3(1.0 + k * 0.2, 1.25, 0.9), target: refs.entryDoorPos, fov: 40 });
    }
    // záběr 3: dávkovač
    stage(1, 7.2, () => {
      audio.play('click', { pos: refs.feeder.pos, volume: 2 });
      g.later(0.5, () => audio.play('beep', { pos: refs.feeder.pos, volume: 1.4 }));
      refs.feeder.error = true;
      g.ui.say('Cvak. Dávkovač granulí: ERROR.', 3.2);
    });
    if (t >= 7.2 && t < 10.6) {
      const k = (t - 7.2) / 3.4;
      const p: THREE.Vector3 = refs.feeder.pos;
      g.camera.cutToShot({ position: new THREE.Vector3(p.x - 0.62 + k * 0.08, 0.2, p.z + 0.2), target: new THREE.Vector3(p.x + 0.05, 0.13, p.z), fov: 36 });
    }
    // záběr 4: Tiger se probouzí
    stage(2, 10.6, () => {
      g.tiger.anim.action = 'lie';
      audio.play('meowAsk', { pos: g.cat.position });
      g.ui.showTitle('Tiger má hlad. A pamlsky jsou zamčené.');
    });
    if (t >= 10.6) {
      const k = Math.min(1, (t - 10.6) / 4.6);
      g.camera.cutToShot({
        position: new THREE.Vector3(sofa.sleepPos.x + 0.85 - k * 0.12, sofa.sleepPos.y + 0.22, sofa.sleepPos.z + 0.75),
        target: new THREE.Vector3(sofa.sleepPos.x, sofa.sleepPos.y + 0.13, sofa.sleepPos.z),
        fov: 36,
      });
    }
    stage(3, 12.6, () => (g.tiger.anim.action = 'sit'));
    stage(4, 14.4, () => g.ui.hideTitle());
    if (t >= 15.4) this.endIntro();
  }

  // ------------------------------------------------------------------ pauza, deník, nápovědy
  pause(): void {
    const g = this.game;
    if (g.state !== 'playing') return;
    g.setState('paused');
    g.input.exitLock();
    g.ui.showPause();
    audio.suspend();
  }

  openJournal(): void {
    const g = this.game;
    if (g.state !== 'playing') return;
    g.setState('paused');
    g.input.exitLock();
    g.ui.showJournal('none');
  }

  /** Čtení stopy (pauzuje hru, rozostří scénu). */
  openReader(id: string, after?: () => void): void {
    const g = this.game;
    const entry = g.journal.get(id);
    if (!entry) {
      after?.();
      return;
    }
    g.journal.add(id);
    g.setState('paused');
    g.input.exitLock();
    g.gfx.setDof(true, 0.2, 0.15, 4.5);
    g.ui.read(entry, () => {
      g.gfx.setDof(false);
      this.resume();
      after?.();
    });
  }

  resume(): void {
    const g = this.game;
    if (g.state !== 'paused') return;
    g.ui.closeModal();
    g.gfx.setDof(false);
    g.setState('playing');
    g.input.requestLock();
    audio.resume();
  }

  /** H – Tiger zamňouká a zobrazí se nápověda (další úroveň nejdřív po 60 s). */
  hint(): void {
    const g = this.game;
    if (g.state !== 'playing' || g.cat.inputLocked) return;
    const graph = g.graph;
    // krok, ke kterému nápověda patří
    const active = graph.order
      .filter((id) => graph.isActive(id))
      .filter((id) => !(OBSOLETE_AFTER[id] && graph.isSolved(OBSOLETE_AFTER[id])));
    const main = active.filter((id) => !graph.steps.get(id)!.optional);
    const id = main[0] ?? active[0];
    audio.play('meowAsk', { pos: g.cat.position });
    g.tiger.anim.mouth = 0.8;
    g.later(0.5, () => (g.tiger.anim.mouth = 0));
    if (!id) {
      g.ui.hint('Všechno je hotovo. Užij si západ slunce.', 3);
      return;
    }
    const step = graph.steps.get(id)!;
    const now = g.playTime;
    let h = this.hintLevel.get(id);
    if (!h) {
      h = { level: 1, at: now };
      this.hintLevel.set(id, h);
      g.stats.hints++;
    } else if (h.level < 3 && now - h.at >= 60) {
      h.level++;
      h.at = now;
      g.stats.hints++;
    }
    let text = step.hints[h.level - 1];
    if (h.level < 3) {
      const wait = Math.max(0, Math.ceil(60 - (now - h.at)));
      text += `<div class="panel-note">Další nápověda za ${wait} s.</div>`;
    }
    g.ui.hint(text, h.level);
  }

  // ------------------------------------------------------------------ postup, ukládání
  private onSolved(id: string): void {
    const g = this.game;
    if (!this.started) return;
    this.syncPhase(false);
    if (id !== 'finale') {
      audio.play('chime', { volume: 0.5 });
      this.save();
    }
  }

  /** Fáze západu slunce podle vyřešených kroků. */
  syncPhase(immediate: boolean): void {
    const g = this.game;
    let phase = 0;
    for (const id of g.graph.solved()) phase = Math.max(phase, SUNSET_PHASE[id] ?? 0);
    if (immediate) g.lighting.setPhaseImmediate(phase);
    else g.lighting.goToPhase(phase, 7);
    audio.setMusicIntensity(phase / 7);
  }

  save(): void {
    const g = this.game;
    const bodies: Record<string, number[]> = {};
    for (const key of ['taburet', 'boot', 'laundry']) {
      const e = g.ctx.refs[key];
      if (!e) continue;
      const t = e.body.translation();
      const r = e.body.rotation();
      bodies[key] = [t.x, t.y, t.z, r.x, r.y, r.z, r.w];
    }
    const bin = g.ctx.refs.trashBin;
    if (bin) {
      const t = bin.entry.body.translation();
      const r = bin.entry.body.rotation();
      bodies.trashBin = [t.x, t.y, t.z, r.x, r.y, r.z, r.w];
    }
    // ukládá se jen bezpečná poloha (na zemi); jinak poslední známá
    const c = g.cat;
    const data: SaveData = {
      v: 1,
      solved: g.graph.solved(),
      journal: [...g.journal.found],
      flags: { ...g.flags },
      stats: { time: g.playTime, hints: g.stats.hints, wrongCodes: g.stats.wrongCodes, golden: g.stats.golden },
      cat: { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.yaw },
      bodies,
      lockDigits: [...g.ctx.refs.lock.digits],
      savedAt: Date.now(),
    };
    Save.write(data);
    bus.emit('saved', {});
  }

  private applySave(d: SaveData): void {
    const g = this.game;
    Object.assign(g.flags, d.flags);
    g.stats.hints = d.stats.hints;
    g.stats.wrongCodes = d.stats.wrongCodes;
    g.stats.golden = d.stats.golden;
    g.playTime = d.stats.time;
    g.ctx.refs.feeder.error = true;
    g.graph.start(d.solved);
    g.journal.load(d.journal);
    for (const [key, arr] of Object.entries(d.bodies)) {
      const e = key === 'trashBin' ? g.ctx.refs.trashBin?.entry : g.ctx.refs[key];
      if (!e) continue;
      e.body.setTranslation({ x: arr[0], y: arr[1], z: arr[2] }, true);
      e.body.setRotation({ x: arr[3], y: arr[4], z: arr[5], w: arr[6] }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (d.lockDigits?.length === 4) g.ctx.refs.lock.digits.splice(0, 4, ...d.lockDigits);
    g.cat.teleport(new THREE.Vector3(d.cat.x, d.cat.y + 0.02, d.cat.z), d.cat.yaw);
    g.tiger.snap();
  }

  // ------------------------------------------------------------------ finále
  startFinale(): void {
    const g = this.game;
    if (this.finaleT >= 0) return;
    this.finaleT = 0;
    g.setState('finale');
    g.input.exitLock();
    g.ui.setPrompt(null);
    g.ui.clearSubtitles();
    g.cat.inputLocked = true;
    g.cat.mode = 'scripted';
    g.cat.scriptSpeed = 0.55;
    g.cat.scriptTarget = new THREE.Vector3(BALCONY.minX + 0.5, BALCONY.floorY, (BALCONY_DOOR.z0 + BALCONY_DOOR.z1) / 2 + 0.05);
    g.cat.scriptYaw = -Math.PI / 2; // čelem k západu
    g.lighting.goToPhase(8, 34);
    audio.setMusicIntensity(1);
    this.city?.setVolume(1.6);
    Save.clear();
  }

  private updateFinale(dt: number): void {
    const g = this.game;
    this.finaleT += dt;
    const t = this.finaleT;
    const cat = g.cat.position;
    if (t > 2.6 && g.tiger.anim.action === 'none' && !g.cat.scriptTarget) {
      // se zlatým pamlskem si Tiger lehne jako socha lva, jinak sedí
      g.tiger.anim.action = g.stats.golden ? 'lie' : 'sit';
      g.tiger.anim.tailMood = g.stats.golden ? 'happy' : 'neutral';
      g.tiger.anim.breathRate = 1.5;
      this.purr = audio.loop('purrLoop', cat, 0.9);
      g.ui.say(g.stats.golden ? 'Král výšek. A celé město mi leží u tlapek.' : 'Slunce zapadá. Břicho plné. Dobrý den.', 5);
    }
    // kamera pomalu odjíždí dozadu a nahoru
    const k = Math.min(1, t / 30);
    const e = k * k * (3 - 2 * k);
    g.camera.setShot(
      {
        position: new THREE.Vector3(cat.x + 0.7 + e * 2.3, cat.y + 0.3 + e * 0.75, cat.z + 0.38 - e * 0.25),
        target: new THREE.Vector3(cat.x - 0.6 - e * 2.5, cat.y + 0.3 + e * 0.35, cat.z - 0.05),
        fov: 46 - e * 8,
      },
      1.6,
    );
    g.gfx.setDof(true, cat.distanceTo(g.gfx.camera.position), 1.2 + e * 3, 2.2);
    if (t > 7 && !this.creditsShown) {
      this.creditsShown = true;
      g.ui.setHudVisible(false);
      g.ui.showCredits({
        time: g.playTime,
        hints: g.stats.hints,
        wrongCodes: g.stats.wrongCodes,
        golden: g.stats.golden,
        journal: g.journal.found.length,
        journalTotal: 7,
      });
    }
    this.purr?.setPosition(cat);
  }

  get finaleRunning(): boolean {
    return this.finaleT >= 0;
  }
  get finaleDone(): boolean {
    return this.creditsShown;
  }

  // ------------------------------------------------------------------ každý snímek
  update(dt: number): void {
    const g = this.game;
    if (g.state === 'menu') this.updateMenuCamera(dt);
    if (g.state === 'intro' && this.introT >= 0) this.updateIntro(dt);
    if (g.state === 'finale') this.updateFinale(dt);
    // tikání hodin
    if (g.state === 'playing' || g.state === 'intro' || g.state === 'finale') {
      this.tickAcc += dt;
      if (this.tickAcc >= 1) {
        this.tickAcc -= 1;
        audio.play('tick', { pos: g.ctx.refs.clock.pos, volume: 0.8 });
      }
    }
    // blikající displej dávkovače
    const feeder = g.ctx.refs.feeder;
    this.blink += dt;
    const on = feeder.error ? this.blink % 1.1 < 0.65 : false;
    const tex = on ? feeder.texOn : feeder.texOff;
    if (feeder.dispMat.map !== tex) {
      feeder.dispMat.map = tex;
      feeder.dispMat.emissiveMap = tex;
    }
    // ruch města je slyšet víc, když jsou dveře otevřené
    if (this.city && this.finaleT < 0) this.city.setVolume(g.flags.doorOpen ? 1.2 : 0.45);
  }
}
