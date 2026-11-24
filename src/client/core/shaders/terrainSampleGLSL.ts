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
 *                               classifyTerrain() → TerrainClassification (fragment)
 *
 * The compute pass writes two textures (MRT):
 *
 *   Elevation texture  (LinearFilter — smooth geometry interpolation)
 *     R   = elevation [0, 1]
 *     GBA = surface gradient of the elevation (3D tangent vector, per terrain unit)
 *
 *   Attribute texture  (NearestFilter — discrete per-texel data, must NOT be interpolated)
 *     R = ridgeMap     [-1, 1]
 *     G = erosionDepth  [0, 1]  (packed from [-1,1] with * 0.5 + 0.5; unpack with * 2.0 - 1.0)
 *     B = ocean biome weight [0, 1]
 *     A = unused
 *
 * Keeping ridgeMap and erosionDepth in a separate NearestFilter texture is
 * intentional: LinearFilter on the elevation texture would interpolate the A
 * channel across texel boundaries and corrupt any integer+fractional packing
 * scheme.  These values are purely color/shading signals — they are sampled
 * directly in the fragment shader (not via vertex varyings) using the same
 * patch UV as the elevation texture.
 *
 * All reads and writes to the elevation texture go through
 * packElevationChannel / unpackElevationChannel so the layout is defined
 * in exactly one place.
 *
 * Debug mode constants are defined both here (TypeScript) and in the GLSL
 * string as matching `#define` values, so the TS side can drive the uniform
 * without a separate lookup table.
 */

import terrainSampleGLSLSource from './terrainSample.glsl';

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
export const TERRAIN_DEBUG_BIOME          = 9; // biome weights (standard ↔ ocean)

// ── GLSL source ───────────────────────────────────────────────────────────────

/** GLSL source: terrainSample.glsl (flattened). */
export const terrainSampleGLSL = terrainSampleGLSLSource;
