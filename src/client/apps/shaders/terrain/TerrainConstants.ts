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
  amp:       number;
}

export interface GaussianParams {
  sigma:     number;  // [0.05, 2.0] normalized to patchHalfSize
  amplitude: number;  // [0.0, 1.0] peak value
}

// ── Defaults ───────────────────────────────────────────────────────────────────

export const DEFAULT_NOISE_PARAMS: NoiseParams = {
  seed:        42,
  scale:       2.0,
  octaves:     4,
  persistence: 0.5,
  lacunarity:  2.0,
};

export const DEFAULT_GAUSSIAN_PARAMS: GaussianParams = {
  sigma:     0.4,
  amplitude: 1.0,
};

export const DEFAULT_FRACTAL_NOISE_PARAMS: FractalNoiseParams = {
  freq:       3.0,
  octaves:    3,
  lacunarity: 2.0,
  gain:       0.1,
  amp:        0.125
};

export const DEFAULT_ELEV_OFFSET = 0.0;   // uniform shift applied to elevation before sea-level test
export const DEFAULT_AMPLITUDE   = 1.0;   // world units — max Y displacement
export const DEFAULT_PATCH_SIZE  = 2.0;   // world units — XZ extent of the whole grid
export const DEFAULT_SUBDIVISION = 256;    // grid cells per side (power of 2)
export const DEFAULT_NUM_PATCHES = 1;     // total patches (must be a perfect square: 1, 4, 9, 16…)

// ── GUI option maps ────────────────────────────────────────────────────────────

export const SUBDIVISION_OPTIONS: Record<string, number> = {
  '32': 32, '64': 64, '128': 128, '256': 256, '512': 512, '1024': 1024,
};

export const PATCH_OPTIONS: Record<string, number> = {
  '1 (1×1)': 1, '4 (2×2)': 4, '9 (3×3)': 9, '16 (4×4)': 16,
};
