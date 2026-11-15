declare module 'n8ao' {
  import type { Scene, Camera, Color } from 'three';
  export class N8AOPostPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      halfRes: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      depthAwareUpsampling: boolean;
      transparencyAware: boolean;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
    };
    enabled: boolean;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
