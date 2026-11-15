import { bus } from './Events';

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  label: string;
  pixelRatio: number; // strop devicePixelRatio
  shadowMap: number;
  shadowRadius: number;
  ao: 'off' | 'low' | 'medium' | 'high' | 'ultra';
  aoHalfRes: boolean;
  volumetricSteps: number; // 0 = vypnuto
  bloom: boolean;
  smaa: boolean;
  furLayers: number;
  dust: number; // počet částic prachu
  gi: 'off' | 'coarse' | 'full';
  giBounces: number;
  lampShadows: boolean;
  anisotropy: number;
  envSize: number;
  city: number; // hustota města 0..1
}

export const QUALITY: Record<QualityName, QualityPreset> = {
  low: {
    label: 'Nízká', pixelRatio: 0.8, shadowMap: 1024, shadowRadius: 1.5, ao: 'off', aoHalfRes: true,
    volumetricSteps: 0, bloom: false, smaa: false, furLayers: 16, dust: 150, gi: 'off', giBounces: 0,
    lampShadows: false, anisotropy: 2, envSize: 64, city: 0.5,
  },
  medium: {
    label: 'Střední', pixelRatio: 1, shadowMap: 2048, shadowRadius: 2.5, ao: 'low', aoHalfRes: true,
    volumetricSteps: 12, bloom: true, smaa: true, furLayers: 20, dust: 350, gi: 'coarse', giBounces: 1,
    lampShadows: false, anisotropy: 4, envSize: 128, city: 0.8,
  },
  high: {
    label: 'Vysoká', pixelRatio: 1, shadowMap: 4096, shadowRadius: 3, ao: 'medium', aoHalfRes: true,
    volumetricSteps: 20, bloom: true, smaa: true, furLayers: 24, dust: 600, gi: 'full', giBounces: 2,
    lampShadows: true, anisotropy: 8, envSize: 256, city: 1,
  },
  ultra: {
    label: 'Ultra', pixelRatio: 1.5, shadowMap: 4096, shadowRadius: 3.5, ao: 'high', aoHalfRes: false,
    volumetricSteps: 32, bloom: true, smaa: true, furLayers: 32, dust: 900, gi: 'full', giBounces: 3,
    lampShadows: true, anisotropy: 16, envSize: 256, city: 1,
  },
};

export interface SettingsData {
  quality: QualityName;
  mouseSensitivity: number; // 0.2 .. 3
  invertY: boolean;
  fov: number; // 50 .. 100
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  subtitles: boolean;
  fur: boolean;
}

const KEY = 'tiger.settings.v1';

const defaults: SettingsData = {
  quality: 'high',
  mouseSensitivity: 1,
  invertY: false,
  fov: 62,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  subtitles: true,
  fur: true,
};

class SettingsStore {
  data: SettingsData = { ...defaults };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...defaults, ...JSON.parse(raw) };
    } catch {
      /* localStorage nemusí být dostupné */
    }
    // URL parametry mají přednost (testy): ?quality=low&fur=0
    const q = new URLSearchParams(location.search);
    const qq = q.get('quality');
    if (qq && qq in QUALITY) this.data.quality = qq as QualityName;
    if (q.has('fur')) this.data.fur = q.get('fur') !== '0';
  }

  get preset(): QualityPreset {
    return QUALITY[this.data.quality];
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
    bus.emit('settingsChanged', { key });
  }
}

export const settings = new SettingsStore();
