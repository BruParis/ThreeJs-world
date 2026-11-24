// Terrain pipeline data carrier — GLSL struct + texture channel contract.
//
// `TerrainSample` is the central struct that flows through the terrain shader
// pipeline, populated incrementally across stages:
//
//   xz → baseNoise → Elevation ─┐
//                                ├─ applyTerrain → { elevation, ridgeMap }
//                    Erosion  ───┘
//                                         ↓
//                               computeElevation (compute pass)
//                                         ↓ (baked into two textures)
//                               unpackElevationChannel (vertex shader)
//                                         ↓
//                               classifyTerrain() → TerrainClassification (fragment)
//
// The compute pass writes two textures (MRT):
//
//   Elevation texture  (LinearFilter — smooth geometry interpolation)
//     R   = elevation [0, 1]
//     GBA = surface gradient of the elevation (3D tangent vector, per terrain unit)
//
//   Attribute texture  (NearestFilter — discrete per-texel data, must NOT be interpolated)
//     R = ridgeMap     [-1, 1]
//     G = erosionDepth  [0, 1]  (packed from [-1,1] with * 0.5 + 0.5; unpack with * 2.0 - 1.0)
//     B = ocean biome weight [0, 1]
//     A = unused
//
// Keeping ridgeMap and erosionDepth in a separate NearestFilter texture is
// intentional: LinearFilter on the elevation texture would interpolate the A
// channel across texel boundaries and corrupt any integer+fractional packing
// scheme.  These values are purely color/shading signals — they are sampled
// directly in the fragment shader (not via vertex varyings) using the same
// patch UV as the elevation texture.
//
// All reads and writes to the elevation texture go through
// packElevationChannel / unpackElevationChannel so the layout is defined
// in exactly one place.
//
// Debug mode constants are defined both here (TypeScript) and in the GLSL
// string as matching `#define` values, so the TS side can drive the uniform
// without a separate lookup table.
//
#ifndef TERRAIN_SAMPLE_GLSL
#define TERRAIN_SAMPLE_GLSL

// Terrain pipeline data carrier — populated by the compute pass.
//   elevation : eroded elevation [0, 1]
//   ridgeMap  : erosion ridge signal [-1, 1]  (negative = gully / crease)
struct TerrainSample {
  float elevation;
  float ridgeMap;
};

// ── Elevation texture — pack / unpack ────────────────────────────────────────
// Stores geometry data only (elevation + surface gradient). Sampled with
// LinearFilter so that normals and displacement interpolate smoothly.
//
//   R   = elevation [0, 1]
//   GBA = surface gradient of the elevation: a 3D vector tangent to the
//         undisplaced surface, in elevation units per terrain unit.
//         Storing it as a 3D vector keeps it independent of the patch grid
//         (which is neither square nor evenly spaced on a sphere).
//
// ridgeMap and erosionDepth live in the separate attribute texture and are
// sampled directly in the fragment shader — see terrainColorGLSL.

vec4 packElevationChannel(float elev, vec3 grad) {
  return vec4(elev, grad);
}

void unpackElevationChannel(vec4 ch, out float elev, out vec3 grad) {
  elev = ch.r;
  grad = ch.gba;
}

// ── Patch texture addressing ─────────────────────────────────────────────────
// Baked patch textures are vertex-centred: texel 0 sits exactly on the patch
// edge (uv = 0) and the last texel on the opposite edge (uv = 1), so two
// neighbouring patches hold identical samples along their shared edge.
// Converts a patch uv in [0, 1] to the matching texture coordinate.
vec2 terrainTexelUv(vec2 uv, vec2 texSize) {
  return (uv * (texSize - 1.0) + 0.5) / texSize;
}

// ── Tangent basis ────────────────────────────────────────────────────────────
// Any orthonormal basis (t1, t2) of the plane perpendicular to the unit vector up.
// Only use it for quantities that do not depend on the choice of basis
// (e.g. a gradient rebuilt as d1 * t1 + d2 * t2).
void terrainTangentBasis(vec3 up, out vec3 t1, out vec3 t2) {
  vec3 helper = (abs(up.y) < 0.9) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  t1 = normalize(cross(helper, up));
  t2 = cross(up, t1);
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
#define TERRAIN_DEBUG_BIOME          9

#endif
