/**
 * Terrain pipeline data carrier — GLSL struct + texture channel contract.
 *
 * `TerrainSample` is the central struct that flows through the terrain shader
 * pipeline, populated incrementally across stages:
 *
 *   xz → baseNoise → Elevation ─┐
 *                                ├─ applyTerrain → { elevation, ridgeMap }
 *                    Erosion  ───┘
 *                                         ↓
 *                               computeElevation (compute pass)
 *                                         ↓ (baked into two textures)
 *                               unpackElevationChannel (vertex shader)
 *                                         ↓
 *                               terrainColor → s.trees filled   (fragment)
 *
 * The compute pass writes two textures (MRT):
 *
 *   Elevation texture  (LinearFilter — smooth geometry interpolation)
 *     R = elevation [0, 1]
 *     G = dDisplNorm/dX  (finite-difference gradient, amplitude-normalised)
 *     B = dDisplNorm/dZ
 *     A = unused
 *
 *   Attribute texture  (NearestFilter — discrete per-vertex data, must NOT be interpolated)
 *     R = ridgeMap     [-1, 1]
 *     G = erosionDepth  [0, 1]  (packed from [-1,1] with * 0.5 + 0.5; unpack with * 2.0 - 1.0)
 *     BA = unused
 *
 * Keeping ridgeMap and erosionDepth in a separate NearestFilter texture is
 * intentional: LinearFilter on the elevation texture would interpolate the A
 * channel across texel boundaries and corrupt any integer+fractional packing
 * scheme.  These values are purely color/shading signals — they are sampled
 * directly in the fragment shader (not via vertex varyings) using the same
 * world-space UV as the elevation texture.
 *
 * All reads and writes to the elevation texture go through
 * packElevationChannel / unpackElevationChannel so the layout is defined
 * in exactly one place.
 *
 * Debug mode constants are defined both here (TypeScript) and in the GLSL
 * string as matching `#define` values, so the TS side can drive the uniform
 * without a separate lookup table.
 */

// ── TypeScript debug mode constants ───────────────────────────────────────────

export const TERRAIN_DEBUG_COLOR          = 0; // full shaded output (default)
export const TERRAIN_DEBUG_ELEVATION      = 1; // grayscale elevation
export const TERRAIN_DEBUG_RIDGEMAP       = 2; // red = ridge, blue = gully
export const TERRAIN_DEBUG_TREES          = 3; // tree coverage mask
export const TERRAIN_DEBUG_NORMALS        = 4; // world-space normal as RGB
export const TERRAIN_DEBUG_STEEPNESS      = 5; // 1 - normal.y  (slope angle proxy)
export const TERRAIN_DEBUG_EXPOSURE       = 6; // erosion-derived surface exposure [0,1]
export const TERRAIN_DEBUG_BREAKUP        = 7; // detail noise breakup [-1,1] remapped to [0,1]
export const TERRAIN_DEBUG_CLASSIFICATION = 8; // terrain type: water/grass/tree/rock

// ── GLSL source ───────────────────────────────────────────────────────────────

export const terrainSampleGLSL = /* glsl */`

// Terrain pipeline data carrier — populated incrementally across stages.
//   elevation : eroded elevation [0, 1]
//   ridgeMap  : erosion ridge signal [-1, 1]  (negative = gully / crease)
//   trees     : tree coverage density [0, 1], filled during the fragment stage
struct TerrainSample {
  float elevation;
  float ridgeMap;
  float trees;
};

// ── Elevation texture — pack / unpack ────────────────────────────────────────
// Stores geometry data only (elevation + gradients). Sampled with LinearFilter
// in the vertex shader so that normals and displacement interpolate smoothly.
//
//   R = elevation [0, 1]
//   G = dDisplNorm/dX  (amplitude-normalised finite-difference derivative)
//   B = dDisplNorm/dZ
//   A = unused
//
// ridgeMap and erosionDepth live in the separate attribute texture (NearestFilter)
// and are sampled directly in the fragment shader — see terrainColorGLSL.

vec4 packElevationChannel(float elev, float gradX, float gradZ) {
  return vec4(elev, gradX, gradZ, 0.0);
}

void unpackElevationChannel(vec4 ch, out float elev, out float gradX, out float gradZ) {
  elev  = ch.r;
  gradX = ch.g;
  gradZ = ch.b;
}

// ── Debug mode — must match TS-side TERRAIN_DEBUG_* constants ─────────────────
#define TERRAIN_DEBUG_COLOR          0
#define TERRAIN_DEBUG_ELEVATION      1
#define TERRAIN_DEBUG_RIDGEMAP       2
#define TERRAIN_DEBUG_TREES          3
#define TERRAIN_DEBUG_NORMALS        4
#define TERRAIN_DEBUG_STEEPNESS      5
#define TERRAIN_DEBUG_EXPOSURE       6
#define TERRAIN_DEBUG_BREAKUP        7
#define TERRAIN_DEBUG_CLASSIFICATION 8

`;
