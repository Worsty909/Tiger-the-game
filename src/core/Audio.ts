import * as THREE from 'three';
import { settings } from './Settings';
import { bus } from './Events';
import { slots } from 'virtual:tiger-audio';
import { assetUrl } from './Assets';

/**
 * Zvuk: Web Audio s prostorovými zdroji (PannerNode).
 * Všechny zvuky se syntetizují procedurálně; pokud v `public/audio/` existuje soubor
 * `<název>.ogg`, použije se místo syntézy (seznam souborů dodává Vite plugin při buildu/startu).
 */

export type Sfx =
  | 'meow' | 'meowAsk' | 'meowAnnoyed' | 'purr' | 'step' | 'land' | 'jump' | 'scratch' | 'swipe'
  | 'click' | 'lockClick' | 'lockOpen' | 'beep' | 'paper' | 'glass' | 'thud' | 'clank' | 'doorLock'
  | 'doorCreak' | 'crunch' | 'chime' | 'whoosh' | 'bump' | 'bag' | 'tick';

export type LoopName = 'fridge' | 'draft' | 'vacuum' | 'city' | 'purrLoop';

interface PlayOpts {
  pos?: THREE.Vector3;
  volume?: number;
  pitch?: number;
  surface?: string;
}

export interface LoopHandle {
  setVolume(v: number): void;
  setPosition(p: THREE.Vector3): void;
  stop(): void;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private samples = new Map<string, AudioBuffer>();
  private loops = new Set<{ gain: GainNode; panner: PannerNode | null; stop: () => void }>();
  private musicNodes: { filter: BiquadFilterNode; gains: GainNode[]; shimmer: GainNode } | null = null;
  private musicIntensity = 0;
  private unlocked = false;
  /** Počet přehraných zvuků podle jména (pro testy). */
  readonly counts: Record<string, number> = {};

  /** Musí se zavolat po prvním uživatelském gestu (klik v menu). */
  unlock(): void {
    if (this.unlocked) {
      void this.ctx?.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.unlocked = true;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.applyVolumes();
    bus.on('settingsChanged', () => this.applyVolumes());
    // šum pro syntézu
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    void this.loadSlots();
    this.startMusic();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.sfxGain.gain.value = settings.data.sfxVolume;
    this.musicGain.gain.value = settings.data.musicVolume * 0.5;
  }

  /** Načte přepisující soubory z public/audio/*.ogg. */
  private async loadSlots(): Promise<void> {
    if (!this.ctx) return;
    for (const file of slots) {
      const name = file.replace(/\.(ogg|mp3|wav)$/i, '');
      try {
        const res = await fetch(assetUrl(`audio/${file}`));
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.samples.set(name, buf);
      } catch {
        /* vadný soubor → zůstane syntéza */
      }
    }
  }

  setListener(pos: THREE.Vector3, forward: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(forward.x, t, 0.05);
      l.forwardY.setTargetAtTime(forward.y, t, 0.05);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.05);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  private panner(pos?: THREE.Vector3): PannerNode | null {
    if (!this.ctx || !pos) return null;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.8;
    p.rolloffFactor = 1.4;
    p.maxDistance = 30;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    return p;
  }

  private out(pos?: THREE.Vector3): AudioNode {
    const p = this.panner(pos);
    if (p) {
      p.connect(this.sfxGain);
      return p;
    }
    return this.sfxGain;
  }

  // ------------------------------------------------------------------ stavební kameny syntézy
  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, attack = 0.005): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dest: AudioNode, filterType: BiquadFilterType, f0: number, f1: number, q: number, dur: number, vol: number, delay = 0, attack = 0.004): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Mňouknutí: formantová syntéza s klouzavou výškou. */
  private meow(dest: AudioNode, kind: 'normal' | 'ask' | 'annoyed', vol: number, pitch: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = kind === 'annoyed' ? 0.45 : kind === 'ask' ? 0.62 : 0.7;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = (kind === 'annoyed' ? 480 : 560) * pitch;
    o.frequency.setValueAtTime(base * 0.8, t);
    o.frequency.linearRampToValueAtTime(base * 1.35, t + dur * 0.25);
    o.frequency.linearRampToValueAtTime(kind === 'ask' ? base * 1.5 : base * 0.72, t + dur);
    // vibrato
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.5;
    const lg = ctx.createGain();
    lg.gain.value = 9;
    lfo.connect(lg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    f1.frequency.setValueAtTime(900, t);
    f1.frequency.linearRampToValueAtTime(1700, t + dur * 0.3); // „m-i-a-u“
    f1.frequency.linearRampToValueAtTime(800, t + dur);
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 7;
    f2.frequency.setValueAtTime(2300, t);
    f2.frequency.linearRampToValueAtTime(3100, t + dur * 0.3);
    f2.frequency.linearRampToValueAtTime(2000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;
    o.connect(f1).connect(g);
    o.connect(f2).connect(g2).connect(g);
    g.connect(dest);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ jednorázové zvuky
  play(name: Sfx, opts: PlayOpts = {}): void {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const vol = opts.volume ?? 1;
    const pitch = opts.pitch ?? 1;
    const dest = this.out(opts.pos);
    const sample = this.samples.get(name);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = pitch;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(dest);
      src.start();
      return;
    }
    switch (name) {
      case 'meow':
        this.meow(dest, 'normal', 0.3 * vol, pitch);
        break;
      case 'meowAsk':
        this.meow(dest, 'ask', 0.3 * vol, pitch * 1.06);
        break;
      case 'meowAnnoyed':
        this.meow(dest, 'annoyed', 0.3 * vol, pitch * 0.9);
        break;
      case 'purr':
        for (let i = 0; i < 12; i++) this.noise(dest, 'lowpass', 180, 90, 2, 0.05, 0.22 * vol, i * 0.04);
        break;
      case 'step': {
        // krok podle povrchu
        const s = opts.surface ?? 'wood';
        if (s === 'carpet' || s === 'fabric') this.noise(dest, 'lowpass', 500, 200, 0.7, 0.07, 0.05 * vol);
        else if (s === 'tile' || s === 'stone') {
          this.noise(dest, 'bandpass', 2600, 1800, 2.5, 0.035, 0.05 * vol);
          this.tone(dest, 'sine', 240, 120, 0.04, 0.03 * vol);
        } else if (s === 'metal') this.tone(dest, 'triangle', 900 * pitch, 500, 0.08, 0.04 * vol);
        else {
          this.noise(dest, 'bandpass', 1300, 700, 1.6, 0.045, 0.06 * vol);
          this.tone(dest, 'sine', 170, 90, 0.05, 0.05 * vol);
        }
        break;
      }
      case 'land':
        this.tone(dest, 'sine', 150, 55, 0.14, 0.4 * vol);
        this.noise(dest, 'lowpass', 900, 200, 0.8, 0.1, 0.22 * vol);
        break;
      case 'jump':
        this.noise(dest, 'bandpass', 500, 1600, 1, 0.14, 0.1 * vol);
        break;
      case 'scratch':
        for (let i = 0; i < 3; i++) this.noise(dest, 'bandpass', 2400 + i * 300, 3800, 3, 0.07, 0.13 * vol, i * 0.06);
        break;
      case 'swipe':
        this.noise(dest, 'bandpass', 700, 2600, 1.2, 0.16, 0.13 * vol);
        break;
      case 'click':
        this.tone(dest, 'square', 1900 * pitch, 900, 0.025, 0.07 * vol);
        break;
      case 'lockClick':
        this.tone(dest, 'square', 1500 * pitch, 700, 0.03, 0.12 * vol);
        this.noise(dest, 'highpass', 4000, 3000, 1, 0.03, 0.08 * vol);
        break;
      case 'lockOpen':
        this.tone(dest, 'square', 700, 300, 0.07, 0.18 * vol);
        this.tone(dest, 'triangle', 1200, 1800, 0.18, 0.14 * vol, 0.09);
        this.noise(dest, 'bandpass', 2500, 1200, 2, 0.12, 0.14 * vol, 0.05);
        break;
      case 'beep':
        this.tone(dest, 'square', 880 * pitch, 880 * pitch, 0.11, 0.07 * vol);
        this.tone(dest, 'square', 660 * pitch, 660 * pitch, 0.16, 0.07 * vol, 0.15);
        break;
      case 'paper':
        this.noise(dest, 'highpass', 2500, 5000, 0.8, 0.22, 0.09 * vol);
        this.noise(dest, 'bandpass', 1800, 3000, 2, 0.1, 0.07 * vol, 0.1);
        break;
      case 'glass':
        for (let i = 0; i < 9; i++) this.tone(dest, 'triangle', 2200 + Math.random() * 4200, 1800 + Math.random() * 2500, 0.2 + Math.random() * 0.3, 0.09 * vol, Math.random() * 0.12);
        this.noise(dest, 'highpass', 5000, 3000, 1, 0.3, 0.3 * vol);
        break;
      case 'thud':
        this.tone(dest, 'sine', 110 * pitch, 45, 0.2, 0.5 * vol);
        this.noise(dest, 'lowpass', 600, 150, 0.7, 0.14, 0.25 * vol);
        break;
      case 'clank':
        this.tone(dest, 'triangle', 1250 * pitch, 900, 0.3, 0.14 * vol);
        this.tone(dest, 'triangle', 2040 * pitch, 1600, 0.22, 0.09 * vol);
        this.noise(dest, 'bandpass', 3000, 2000, 3, 0.06, 0.12 * vol);
        break;
      case 'doorLock':
        this.tone(dest, 'square', 420, 260, 0.05, 0.2 * vol);
        this.noise(dest, 'bandpass', 1800, 900, 2, 0.06, 0.2 * vol, 0.02);
        this.tone(dest, 'square', 380, 220, 0.06, 0.22 * vol, 0.42);
        this.noise(dest, 'bandpass', 1500, 800, 2, 0.08, 0.2 * vol, 0.44);
        this.tone(dest, 'sine', 90, 50, 0.25, 0.3 * vol, 0.5);
        break;
      case 'doorCreak':
        this.tone(dest, 'sawtooth', 190, 320, 0.7, 0.05 * vol, 0, 0.1);
        this.noise(dest, 'bandpass', 700, 1500, 6, 0.7, 0.06 * vol, 0, 0.1);
        this.tone(dest, 'sine', 80, 50, 0.3, 0.3 * vol, 0.6);
        break;
      case 'crunch':
        for (let i = 0; i < 3; i++) this.noise(dest, 'bandpass', 1600 + Math.random() * 1400, 900, 2.5, 0.05, 0.16 * vol, i * 0.09 + Math.random() * 0.02);
        break;
      case 'chime':
        [880, 1318.5, 1760].forEach((f, i) => this.tone(dest, 'sine', f, f, 0.9, 0.09 * vol, i * 0.11));
        break;
      case 'whoosh':
        this.noise(dest, 'bandpass', 300, 1500, 0.8, 0.35, 0.12 * vol, 0, 0.12);
        break;
      case 'bump':
        this.tone(dest, 'sine', 130, 70, 0.1, 0.3 * vol);
        this.noise(dest, 'lowpass', 1200, 400, 1, 0.06, 0.15 * vol);
        break;
      case 'bag':
        this.noise(dest, 'highpass', 3000, 6000, 0.6, 0.25, 0.12 * vol);
        for (let i = 0; i < 8; i++) this.tone(dest, 'triangle', 1500 + Math.random() * 1500, 900, 0.03, 0.05 * vol, 0.18 + Math.random() * 0.35);
        break;
      case 'tick':
        this.tone(dest, 'square', 2600, 2000, 0.012, 0.035 * vol);
        break;
    }
  }

  // ------------------------------------------------------------------ smyčky
  loop(name: LoopName, pos?: THREE.Vector3, volume = 1): LoopHandle {
    const ctx = this.ctx;
    const dummy: LoopHandle = { setVolume() {}, setPosition() {}, stop() {} };
    if (!ctx) return dummy;
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = this.panner(pos);
    if (p) g.connect(p).connect(this.sfxGain);
    else g.connect(this.sfxGain);
    const nodes: Array<AudioScheduledSourceNode> = [];
    const noiseSrc = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      nodes.push(s);
      return s;
    };
    const osc = (type: OscillatorType, f: number): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      nodes.push(o);
      return o;
    };
    let base = 0.1;
    const sample = this.samples.get(name);
    if (sample) {
      const s = ctx.createBufferSource();
      s.buffer = sample;
      s.loop = true;
      nodes.push(s);
      s.connect(g);
      base = 1;
    } else if (name === 'fridge') {
      // brum 50 Hz + harmonické + jemný šum kompresoru
      for (const [f, v] of [[50, 0.5], [100, 0.3], [150, 0.12], [200, 0.05]] as const) {
        const og = ctx.createGain();
        og.gain.value = v;
        osc('sine', f).connect(og).connect(g);
      }
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 320;
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      noiseSrc().connect(f).connect(ng).connect(g);
      base = 0.09;
    } else if (name === 'draft') {
      // pískání průvanu: úzkopásmový šum s kolísající výškou
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 28;
      f.frequency.value = 1450;
      const lfo = osc('sine', 0.23);
      const lg = ctx.createGain();
      lg.gain.value = 260;
      lfo.connect(lg).connect(f.frequency);
      const lfo2 = osc('sine', 0.61);
      const lg2 = ctx.createGain();
      lg2.gain.value = 90;
      lfo2.connect(lg2).connect(f.frequency);
      noiseSrc().connect(f).connect(g);
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = 500;
      const wg = ctx.createGain();
      wg.gain.value = 0.12;
      noiseSrc().connect(f2).connect(wg).connect(g);
      base = 0.5;
    } else if (name === 'vacuum') {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.9;
      f.frequency.value = 900;
      noiseSrc().connect(f).connect(g);
      for (const [fr, v] of [[142, 0.25], [284, 0.12], [710, 0.04]] as const) {
        const og = ctx.createGain();
        og.gain.value = v;
        osc('sawtooth', fr).connect(og).connect(g);
      }
      base = 0.16;
    } else if (name === 'city') {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const lfo = osc('sine', 0.07);
      const lg = ctx.createGain();
      lg.gain.value = 140;
      lfo.connect(lg).connect(f.frequency);
      noiseSrc().connect(f).connect(g);
      base = 0.22;
    } else if (name === 'purrLoop') {
      // předení: nízký šum modulovaný ~25 Hz
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 240;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = osc('sawtooth', 24);
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      const breath = osc('sine', 0.55);
      const bg = ctx.createGain();
      bg.gain.value = 0.25;
      breath.connect(bg).connect(am.gain);
      noiseSrc().connect(f).connect(am).connect(g);
      base = 0.6;
    }
    for (const n of nodes) n.start();
    g.gain.setTargetAtTime(base * volume, ctx.currentTime, 0.25);
    const entry = {
      gain: g,
      panner: p,
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
        setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop();
            } catch {
              /* už zastaveno */
            }
          }
          g.disconnect();
        }, 900);
        this.loops.delete(entry);
      },
    };
    this.loops.add(entry);
    return {
      setVolume: (v: number) => g.gain.setTargetAtTime(base * v, ctx.currentTime, 0.15),
      setPosition: (np: THREE.Vector3) => {
        if (p) {
          p.positionX.setTargetAtTime(np.x, ctx.currentTime, 0.05);
          p.positionY.setTargetAtTime(np.y, ctx.currentTime, 0.05);
          p.positionZ.setTargetAtTime(np.z, ctx.currentTime, 0.05);
        }
      },
      stop: entry.stop,
    };
  }

  // ------------------------------------------------------------------ hudba
  /** Jemné ambientní pady; intenzita 0..1 roste s postupem hrou. */
  private startMusic(): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.6;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.61;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    filter.connect(this.musicGain);
    filter.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(this.musicGain);
    // akord Dmaj9 / Bm11 – pomalu se přelévající hlasy
    const freqs = [73.42, 110, 146.83, 185, 220, 277.18, 329.63, 440];
    const gains: GainNode[] = [];
    freqs.forEach((f, i) => {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = i < 2 ? 'sine' : 'triangle';
      o2.type = 'sine';
      o1.frequency.value = f;
      o2.frequency.value = f * 1.003;
      const g = ctx.createGain();
      g.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + i * 0.011;
      const lg = ctx.createGain();
      lg.gain.value = 0.02;
      lfo.connect(lg).connect(g.gain);
      o1.connect(g);
      o2.connect(g);
      g.connect(filter);
      o1.start();
      o2.start();
      lfo.start();
      gains.push(g);
    });
    const shimmer = ctx.createGain();
    shimmer.gain.value = 0;
    const so = ctx.createOscillator();
    so.type = 'sine';
    so.frequency.value = 880;
    const sl = ctx.createOscillator();
    sl.frequency.value = 0.13;
    const slg = ctx.createGain();
    slg.gain.value = 0.012;
    sl.connect(slg).connect(shimmer.gain);
    so.connect(shimmer).connect(filter);
    so.start();
    sl.start();
    this.musicNodes = { filter, gains, shimmer };
    this.setMusicIntensity(this.musicIntensity);
  }

  setMusicIntensity(v: number): void {
    this.musicIntensity = THREE.MathUtils.clamp(v, 0, 1);
    const m = this.musicNodes;
    if (!m || !this.ctx) return;
    const t = this.ctx.currentTime;
    m.filter.frequency.setTargetAtTime(380 + 1900 * this.musicIntensity, t, 3);
    m.gains.forEach((g, i) => {
      // hlubší hlasy hrají vždy, vyšší přibývají s intenzitou
      const on = i < 3 ? 1 : THREE.MathUtils.clamp(this.musicIntensity * 6 - (i - 3), 0, 1);
      g.gain.setTargetAtTime(0.035 * on * (i < 2 ? 1.4 : 1), t, 4);
    });
  }

  suspend(): void {
    void this.ctx?.suspend();
  }
  resume(): void {
    void this.ctx?.resume();
  }
}

export const audio = new AudioEngine();
