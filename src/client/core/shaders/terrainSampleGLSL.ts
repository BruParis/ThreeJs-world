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
 *                                         ↓ (baked into elevation texture)
 *                               unpackElevationChannel (vertex shader)
 *                                         ↓
 *                               terrainColor → s.trees filled   (fragment)
 *
 * Elevation texture channel 0 layout — one texel per grid vertex:
 *   R = elevation [0, 1]
 *   G = dDisplNorm/dX  (finite-difference gradient, amplitude-normalised)
 *   B = dDisplNorm/dZ
 *   A = ridgeMap + erosionDepth packed into a single float (RGBA32F):
 *         floor(A) / 255  → ridgeMap     [-1, 1]  (256 quantisation steps)
 *         fract(A)        → erosionDepth [-1, 1]  (full float precision)
 *
 * All reads and writes to the texture go through packElevationChannel /
 * unpackElevationChannel so the layout is defined in exactly one place.
 *
 * Debug mode constants are defined both here (TypeScript) and in the GLSL
 * string as matching `#define` values, so the TS side can drive the uniform
 * without a separate lookup table.
 */

// ── TypeScript debug mode constants ───────────────────────────────────────────

export const TERRAIN_DEBUG_COLOR      = 0; // full shaded output (default)
export const TERRAIN_DEBUG_ELEVATION  = 1; // grayscale elevation
export const TERRAIN_DEBUG_RIDGEMAP   = 2; // red = ridge, blue = gully
export const TERRAIN_DEBUG_TREES      = 3; // tree coverage mask
export const TERRAIN_DEBUG_NORMALS    = 4; // world-space normal as RGB
export const TERRAIN_DEBUG_STEEPNESS  = 5; // 1 - normal.y  (slope angle proxy)

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

// ── Elevation texture channel 0 — pack / unpack ───────────────────────────────
// R = elevation, G = gradX, B = gradZ (amplitude-normalised finite-difference derivatives).
//
// A encodes two values in one RGBA32F float using integer + fractional parts:
//
//   ridge        (ridgeMap)    — floor(A) / 255, quantised to 256 steps.
//                                 +1 = ridge crest, -1 = gully/crease.
//                                 Produced by the erosion filter's ridge-tracking signal.
//
//   erosionDepth (erosionDepth) — fract(A) remapped to [-1, 1], full float precision.
//                                 This is h.x / h.w from ErosionFilter: the height change
//                                 applied by erosion, normalised by the total octave magnitude.
//                                 +1 = point barely touched (ridge preserved / raised).
//                                 -1 = point deeply carved (bottom of a gully).
//                                 Used as an ambient-occlusion proxy in terrainColor:
//                                 gullies collect sediment (dirt), ridges stay bare.
//
// All reads and writes go through these two functions.

vec4 packElevationChannel(float elev, float gradX, float gradZ, float ridge, float erosionDepth) {
  float r01 = ridge * 0.5 + 0.5;
  float e01 = erosionDepth * 0.5 + 0.5;
  return vec4(elev, gradX, gradZ, floor(r01 * 255.0) + e01);
}

void unpackElevationChannel(
  vec4 ch,
  out float elev, out float gradX, out float gradZ, out float ridge, out float erosionDepth
) {
  elev         = ch.r;
  gradX        = ch.g;
  gradZ        = ch.b;
  ridge        = (floor(ch.a) / 255.0) * 2.0 - 1.0;  // integer part → ridgeMap
  erosionDepth = fract(ch.a) * 2.0 - 1.0;             // fractional part → erosion depth
}

// ── Debug mode — must match TS-side TERRAIN_DEBUG_* constants ─────────────────
#define TERRAIN_DEBUG_COLOR     0
#define TERRAIN_DEBUG_ELEVATION 1
#define TERRAIN_DEBUG_RIDGEMAP  2
#define TERRAIN_DEBUG_TREES     3
#define TERRAIN_DEBUG_NORMALS   4
#define TERRAIN_DEBUG_STEEPNESS 5

`;
