// Settings specific to the Shaders-tab view of the terrain.
// The terrain parameters themselves (noise, erosion, scale…) live in the shared
// store: shared/terrain/TerrainParams.

export const DEFAULT_SUBDIVISION = 256;    // grid cells per side of one patch (power of 2)
export const DEFAULT_NUM_PATCHES = 1;      // total patches (must be a perfect square: 1, 4, 9, 16…)

/** Samples per side of the grid that maps the flat patch onto the planet. */
export const DIRECTION_GRID_RES = 65;
/** Texels per side of the baked bump textures. */
export const BUMP_TEXTURE_RES   = 512;
/** Texels per side of the baked detail noise texture. */
export const DETAIL_TEXTURE_RES = 512;

// ── GUI option maps ────────────────────────────────────────────────────────────

export const SUBDIVISION_OPTIONS: Record<string, number> = {
  '32': 32, '64': 64, '128': 128, '256': 256, '512': 512, '1024': 1024,
};

export const PATCH_OPTIONS: Record<string, number> = {
  '1 (1×1)': 1, '4 (2×2)': 4, '9 (3×3)': 9, '16 (4×4)': 16,
};
