// ── Types ──────────────────────────────────────────────────────────────────────

export interface NoiseParams {
  seed:        number;
  scale:       number;
  octaves:     number;
  persistence: number;
  lacunarity:  number;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

export const DEFAULT_NOISE_PARAMS: NoiseParams = {
  seed:        42,
  scale:       2.0,
  octaves:     4,
  persistence: 0.5,
  lacunarity:  2.0,
};

export const DEFAULT_AMPLITUDE   = 0.4;   // world units — max Y displacement
export const DEFAULT_PATCH_SIZE  = 2.0;   // world units — XZ extent of the whole grid
export const DEFAULT_SUBDIVISION = 256;    // grid cells per side (power of 2)
export const DEFAULT_NUM_PATCHES = 1;     // total patches (must be a perfect square: 1, 4, 9, 16…)
export const DEFAULT_LAYER_MIX   = 0.5;   // 0 = gradient only, 1 = simplex only

// ── GUI option maps ────────────────────────────────────────────────────────────

export const SUBDIVISION_OPTIONS: Record<string, number> = {
  '1': 1, '2': 2, '4': 4, '8': 8, '16': 16,
  '32': 32, '64': 64, '128': 128, '256': 256, '512': 512,
};

export const PATCH_OPTIONS: Record<string, number> = {
  '1 (1×1)': 1, '4 (2×2)': 4, '9 (3×3)': 9, '16 (4×4)': 16,
};
