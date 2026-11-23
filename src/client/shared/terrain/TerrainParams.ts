/**
 * Shared terrain parameters.
 *
 * One store holds every parameter of the terrain shader pipeline (noise,
 * erosion, vegetation, colors) together with the real-world scale.  The
 * Shaders tab edits it; both the Shaders tab (flat patch) and the World tab
 * (sphere LOD patches) render from it, so the two views always describe the
 * same terrain.
 *
 * Scale conventions
 *   Horizontal — positions fed to the noise are in "terrain units":
 *                  P = position_km / kmPerUnit
 *   Vertical   — normalised elevation [0, 1] maps to kilometres above sea level:
 *                  heightKm = (elevation - seaLevel) * elevationAmplitudeKm
 *                and is displayed exaggerated by elevationDisplayScale.
 */

import {
  WORLD_RADIUS_KM,
  DEFAULT_KM_PER_TERRAIN_UNIT,
  ELEVATION_DISPLAY_SCALE,
} from '../world/World';
import {
  DEFAULT_EROSION_OCTAVES,
  DEFAULT_EROSION_SCALE,
  DEFAULT_EROSION_STRENGTH,
  DEFAULT_EROSION_GULLY_WEIGHT,
  DEFAULT_EROSION_DETAIL,
  DEFAULT_EROSION_GAIN,
  DEFAULT_EROSION_LACUNARITY,
  DEFAULT_EROSION_CELL_SCALE,
  DEFAULT_EROSION_NORMALIZATION,
  DEFAULT_EROSION_RIDGE_ROUNDING,
  DEFAULT_EROSION_CREASE_ROUNDING,
} from '@core/shaders/erosion3GLSL';
import {
  DEFAULT_TREE_ELEV_MAX,
  DEFAULT_TREE_ELEV_MIN,
  DEFAULT_TREE_SLOPE_MIN,
  DEFAULT_TREE_RIDGE_MIN,
  DEFAULT_TREE_NOISE_FREQ,
  DEFAULT_TREE_NOISE_POW,
  DEFAULT_TREE_DENSITY,
  DEFAULT_TREE_BUMP_STRENGTH,
  DEFAULT_TREE_BUMP_FREQ,
} from '@core/shaders/treeGLSL';
import { DEFAULT_TERRAIN_COLORS, type TerrainColorState } from '@core/shaders/terrainColorGLSL';
import { TERRAIN_SEA_LEVEL } from '@core/shaders/terrainVertexGLSL';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NoiseParams {
  seed:        number;
  scale:       number;
  octaves:     number;
  persistence: number;
  lacunarity:  number;
}

export interface FractalNoiseParams {
  freq:       number;
  octaves:    number;
  lacunarity: number;
  gain:       number;
  amp:        number;
}

export interface GaussianParams {
  sigma:     number;  // [0.05, 2.0] in units of half the reference patch size
  amplitude: number;  // [0.0, 1.0] peak value
}

/** Noise type ids — must match the uNoiseType branches in terrainNoiseGLSL. */
export const NOISE_TYPE_SIMPLEX  = 0;
export const NOISE_TYPE_PERLIN   = 1;
export const NOISE_TYPE_GAUSSIAN = 3;
export const NOISE_TYPE_FRACTAL  = 4;

/**
 * What a parameter change invalidates.
 *   elevation — the elevation bake (and everything derived from it)
 *   trees     — the tree density bake (cheap; depends on elevation offset)
 *   bump      — the water / canopy bump bake
 *   detail    — the detail noise bake
 *   display   — uniforms only, no bake
 */
export type TerrainChange = 'elevation' | 'trees' | 'bump' | 'detail' | 'display';

export type TerrainChangeListener = (change: TerrainChange) => void;

// ── Store ──────────────────────────────────────────────────────────────────────

export class TerrainParams {
  // ── Real-world scale ────────────────────────────────────────────────────────
  /** Kilometres covered by one terrain unit. */
  kmPerUnit = DEFAULT_KM_PER_TERRAIN_UNIT;
  /** Real kilometres of relief per unit of normalised elevation. */
  elevationAmplitudeKm = 10;
  /** Visual exaggeration applied to the relief. */
  elevationDisplayScale = ELEVATION_DISPLAY_SCALE;

  // ── Reference patch (the region the Shaders tab looks at) ───────────────────
  /** Latitude of the patch centre, degrees. */
  anchorLatDeg = 20;
  /** Longitude of the patch centre, degrees. */
  anchorLonDeg = 30;
  /** Edge length of the reference patch, terrain units. */
  patchSize = 2.0;

  // ── Elevation ───────────────────────────────────────────────────────────────
  gaussianParams: GaussianParams = { sigma: 0.4, amplitude: 1.0 };
  noiseParams: NoiseParams = { seed: 42, scale: 2.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };
  fractalNoiseParams: FractalNoiseParams = { freq: 3.0, octaves: 3, lacunarity: 2.0, gain: 0.1, amp: 0.125 };
  noiseType = NOISE_TYPE_FRACTAL;

  /** Uniform shift applied to the elevation before the sea-level test. */
  elevationOffset = 0.0;
  seaLevel        = TERRAIN_SEA_LEVEL;

  /**
   * Fade out noise octaves that are too fine for the texel grid of the patch
   * being baked.  Keeps coarse LOD patches free of aliasing.
   */
  bandLimit = true;

  // ── Detail noise ────────────────────────────────────────────────────────────
  detailNoiseEnabled  = false;
  detailNoiseStrength = 0.3;

  // ── Erosion ─────────────────────────────────────────────────────────────────
  erosionEnabled        = false;
  erosionOctaves        = DEFAULT_EROSION_OCTAVES;
  erosionScale          = DEFAULT_EROSION_SCALE;
  erosionStrength       = DEFAULT_EROSION_STRENGTH;
  erosionGullyWeight    = DEFAULT_EROSION_GULLY_WEIGHT;
  erosionDetail         = DEFAULT_EROSION_DETAIL;
  erosionGain           = DEFAULT_EROSION_GAIN;
  erosionLacunarity     = DEFAULT_EROSION_LACUNARITY;
  erosionCellScale      = DEFAULT_EROSION_CELL_SCALE;
  erosionNormalization  = DEFAULT_EROSION_NORMALIZATION;
  erosionRidgeRounding  = DEFAULT_EROSION_RIDGE_ROUNDING;
  erosionCreaseRounding = DEFAULT_EROSION_CREASE_ROUNDING;

  // ── Colors ──────────────────────────────────────────────────────────────────
  terrainColors: TerrainColorState = { ...DEFAULT_TERRAIN_COLORS };

  // ── Trees ───────────────────────────────────────────────────────────────────
  treeEnabled      = true;
  treeElevMax      = DEFAULT_TREE_ELEV_MAX;
  treeElevMin      = DEFAULT_TREE_ELEV_MIN;
  treeSlopeMin     = DEFAULT_TREE_SLOPE_MIN;
  treeRidgeMin     = DEFAULT_TREE_RIDGE_MIN;
  treeNoiseFreq    = DEFAULT_TREE_NOISE_FREQ;
  treeNoisePow     = DEFAULT_TREE_NOISE_POW;
  treeDensity      = DEFAULT_TREE_DENSITY;
  treeBumpStrength = DEFAULT_TREE_BUMP_STRENGTH;
  treeBumpFreq     = DEFAULT_TREE_BUMP_FREQ;

  // ── Biomes ──────────────────────────────────────────────────────────────────
  // Where each biome lies is given per patch (biome boundaries); these are the
  // parameters of the transitions and of each biome.
  /** Full width of the transition between two biomes, km. */
  biomeTransitionKm = 40;
  /** Amplitude of the noise that makes boundaries irregular (coastlines), km. */
  biomeBoundaryNoiseKm = 15;
  /** Wavelength of the coarsest octave of that noise, km. */
  biomeBoundaryNoiseWavelengthKm = 80;
  /**
   * Ocean biome: depth of the flat ocean floor below sea level, normalised
   * elevation.  The floor stays at this depth whatever the elevation offset.
   */
  oceanFloorDepth = 0.05;

  // ── Derived scale values ────────────────────────────────────────────────────

  /** World radius in terrain units. */
  get planetRadiusUnits(): number {
    return WORLD_RADIUS_KM / this.kmPerUnit;
  }

  /** Displayed (exaggerated) kilometres of relief per unit of elevation. */
  get elevationAmplitudeApparentKm(): number {
    return this.elevationAmplitudeKm * this.elevationDisplayScale;
  }

  /**
   * Displayed relief, in terrain units, per unit of normalised elevation.
   * This is the rise-over-run factor that turns the baked elevation gradient
   * into the slope of the displayed surface.
   */
  get verticalScale(): number {
    return this.elevationAmplitudeApparentKm / this.kmPerUnit;
  }

  /** Edge length of the reference patch in kilometres. */
  get patchSizeKm(): number {
    return this.patchSize * this.kmPerUnit;
  }

  /**
   * Per-biome elevation parameters (indexed by biome id):
   *   elevation_b = base[b] + scale[b] * noiseElevation
   * The raw elevation is shifted by elevationOffset at render time, so the
   * ocean floor compensates for it.
   */
  biomeElevationParams(): { base: [number, number, number, number]; scale: [number, number, number, number] } {
    return {
      base:  [0, this.seaLevel - this.oceanFloorDepth - this.elevationOffset, 0, 0],
      scale: [1, 0, 1, 1],
    };
  }

  // ── Change notification ─────────────────────────────────────────────────────

  private readonly listeners = new Set<TerrainChangeListener>();

  /** Registers a listener. Returns the unsubscribe function. */
  onChange(listener: TerrainChangeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Tells every listener that parameters of the given kind changed. */
  notify(change: TerrainChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

/** The single terrain parameter set shared by every tab. */
export const terrainParams = new TerrainParams();
