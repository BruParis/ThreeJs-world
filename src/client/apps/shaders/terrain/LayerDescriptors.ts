import { NoiseParams } from './TerrainConstants';

export interface LayerDescriptor {
  readonly index: number;
  readonly label: string;
}

/**
 * Pipeline steps displayed in the layer overlay panels.
 * Each entry maps 1:1 to a uLayerIndex value in the overlay fragment shader.
 * Adding a new step here + a matching early-return in the shader is all that's needed.
 */
export const LAYER_DESCRIPTORS: readonly LayerDescriptor[] = [
  { index: 0, label: 'Gradient' },
  { index: 1, label: 'Noise' },
  { index: 2, label: 'Blended' },
  { index: 3, label: 'Erosion' },
  { index: 4, label: 'Water Clamp' },
];

/** Full set of uniforms the overlay panels need to mirror the elevation compute shader. */
export interface OverlayParams {
  noiseParams:           NoiseParams;
  noiseType:             number;
  gaussSigma:            number;
  gaussAmplitude:        number;
  layerMix:              number;
  patchHalfSize:         number;
  erosionEnabled:        boolean;
  erosionOctaves:        number;
  erosionTiles:          number;
  erosionStrength:       number;
  erosionSlopeStrength:  number;
  erosionBranchStrength: number;
  erosionGain:           number;
  erosionLacunarity:     number;
}
