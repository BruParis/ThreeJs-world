// Terrain coloring — land and water colors, classification, debug views.
//
// Exposes:
//   vec3 terrainColor(float elevation, float ridgeMap, float erosionDepth,
//                     float trees, float hardness, vec3 normal, vec3 detailNoise)
//   vec3 waterColor(float elevation, float normalY, vec3 detailNoise)
//   vec3 computeWaterNormal(vec3 up, vec3 grad)
//   TerrainClassification classifyTerrain(...)   (terrainClassification.glsl)
//
// Classification (isWater, isGrass, isTree, trees, hardness) is computed per
// fragment from the shifted elevation, so it follows uElevOffset without a
// re-bake.
//
// Requires these defines (set from TypeScript, see TerrainMaterial):
//   GRASS_HEIGHT    upper elevation of the grass zone (TERRAIN_GRASS_HEIGHT)
//   DRAINAGE_WIDTH  ridge-map threshold of the drainage color
// Colors are uniforms: createTerrainColorUniforms / syncTerrainColorUniforms.


#include "terrainSample.glsl"
#include "shaderUtils.glsl"

// uSeaLevel declared before treeGLSL/terrainClassificationGLSL (required in scope).
uniform float uSeaLevel;

// ── Color uniforms ────────────────────────────────────────────────────────────
uniform vec3      uCliffColor;
uniform vec3      uDirtColor;
uniform vec3      uGrassColor1;
uniform vec3      uGrassColor2;
uniform vec3      uTreeColor;
uniform vec3      uSandColor;
uniform vec3      uDrainageColor;
uniform vec3      uWaterDeepColor;
uniform vec3      uWaterShoreColor;
uniform float     uWaterNormalFreq;
uniform float     uWaterNormalStrength;
uniform float     uWaterRoughness;
uniform int       uDebugMode;
// Attribute texture (NearestFilter) — R = ridgeMap, G = erosionDepth (packed).
uniform sampler2D uAttrTex;
// Bump textures — 3D tangent vectors baked by the bump pass.
uniform sampler2D uBumpWaterTex;  // xyz = gradient of the wave height field
uniform sampler2D uBumpTreeTex;   // xyz = canopy tilt vector

// ── Classification pipeline (trees → classify) ───────────────────────────────
#include "tree.glsl"
#include "terrainClassification.glsl"

// ── Water normal perturbation ─────────────────────────────────────────────────
//
// Reconstructs the surface normal for water from the pre-baked gradient stored
// in uBumpWaterTex (strength = 1).  The caller scales the gradient by
// uWaterNormalStrength, so the tilt changes at render time without a rebake.
//
//   up   – unit normal of the undisturbed water surface
//   grad – gradient of the wave height field (tangent to the surface)
//
// Clamps tilt so the normal never points below ~18° from the surface (sin18°≈0.3),
// preventing waves from creating lighting black-holes.
vec3 computeWaterNormal(vec3 up, vec3 grad) {
  vec3  n  = normalize(up - grad);
  float ny = dot(n, up);
  n += up * (max(ny, 0.3) - ny);
  return normalize(n);
}

// ── Water color ───────────────────────────────────────────────────────────────
//
// Called for fragments below sea level (tc.isWater == true).
// The terrain mesh below the water plane is visible through the semi-transparent
// WaterMesh (MeshPhysicalMaterial, opacity 0.82), so this color shows through.
//
// shore is a smooth blend weight — NOT a classifier.  It fades from the shore
// color (shore = 1 at the waterline, diff = 0) to the deep color (shore → 0
// exponentially as depth increases).  foam adds a white fringe exactly at the
// waterline.  Both are gated on normal.y to skip vertical underwater cliffs.
//
// Parameters:
//   elevation   [0, 1]   terrain elevation (< uSeaLevel for water)
//   normalY              cosine between the surface normal and "up"
//   detailNoise  vec3    detail noise sample: .x = FBM [-1,1]
vec3 waterColor(float elevation, float normalY, vec3 detailNoise) {
  float breakup = detailNoise.x;
  float diff    = max(0.0, uSeaLevel - elevation);  // depth below sea level [0, uSeaLevel]

  float shore = normalY > 1e-2 ? exp(-diff * 60.0)                           : 0.0;
  float foam  = normalY > 1e-2 ? smoothstep(0.005, 0.0, diff + breakup * 0.005) : 0.0;

  vec3 color = mix(uWaterDeepColor, uWaterShoreColor, shore);
  color = mix(color, vec3(1.0), foam);
  return color;
}

// ── Land / terrain color ──────────────────────────────────────────────────────
//
// Takes individual floats rather than a TerrainSample struct — many WebGL2 drivers
// reject struct types in function parameter positions.
//
// trees is pre-computed by classifyTerrain() so ComputeTreeMap is not called twice.
//
// Parameters (all expected ranges):
//   elevation    [0, 1]    eroded terrain height; 0 = deepest water, 1 = highest peak
//   ridgeMap     [-1, 1]   erosion ridge signal: -1 = deep gully/crease, +1 = sharp ridge
//   erosionDepth [-1, 1]   erosion proxy AO: -1 = concave/sheltered, 0 = neutral, +1 = convex/exposed
//                          caller must unpack from [0,1] storage with * 2.0 - 1.0
//   trees        [0, 1]    tree density, pre-computed by classifyTerrain()
//   hardness     [0, 1]    smooth rock/soft boundary from classifyTerrain() — 0 = grass/tree,
//                          1 = rock/cliff/snow.  Grass blend weight is derived from this so
//                          the color boundary stays aligned with the normal-perturbation boundary.
//   normal                surface normal in the local frame of the surface, y = "up"
//                          (may be perturbed by detail noise)
//   detailNoise  vec3      detail noise texture sample: .x = FBM value [-1,1]
//
// Also handles all debug visualisations (elevation, ridgeMap, trees, normals, etc.) so
// they apply universally to land and — when not in TERRAIN_DEBUG_COLOR — water pixels too.
vec3 terrainColor(float elevation, float ridgeMap,
                  float erosionDepth, float trees, float hardness, vec3 normal, vec3 detailNoise) {
  elevation = clamp(elevation, 0.0, 1.0);

  float breakup = detailNoise.x;

  float ridgeMap01 = clamp01(ridgeMap * 0.5 + 0.5); // Ridge map as [0, 1] value.
  float drainage = clamp01((1.0 - clamp01(ridgeMap01 / DRAINAGE_WIDTH)) * 1.5);

  // Exposure: erosion-derived proxy for how open/exposed the surface is.
  // Eroded gullies (erosionDepth ≈ -1) are concave, sheltered → low exposure.
  // Ridges (erosionDepth ≈ +1) are convex and open → high exposure.
  // The +0.5 bias sets the neutral point so flat un-eroded terrain sits at 0.5.
  // low exposure → sheltered gully → dirt/sediment visible.
  // high exposure → clean rock.
  float exposure = clamp01(erosionDepth + 0.5);

  // ── Land color ─────────────────────────────────────────────────────────────
  vec3 landColor = vec3(0.0);

  landColor = uCliffColor * smoothstep(0.0, 0.52, elevation);
  landColor = mix(landColor, uDirtColor, smoothstep(0.6, 0.0, exposure + breakup * 1.5));

  // Snow
  landColor = mix(landColor, vec3(1.0), smoothstep(0.53, 0.6, elevation + breakup * 0.1));

  // Grass — blend weight derived from classification hardness so the color boundary
  // stays locked to the normal-perturbation boundary.  Breakup and exposure apply
  // small organic offsets on top without moving the base transition.
  vec3 grassMix = mix(uGrassColor1, uGrassColor2, smoothstep(0.4, 0.6, elevation - erosionDepth * 0.05 + breakup * 0.3));
  float grassWeight = clamp01((1.0 - hardness) + (exposure - 0.8) * 0.05 - breakup * 0.02);
  landColor = mix(landColor, grassMix, grassWeight);

  // Tree color
  // landColor = mix(landColor, uTreeColor * pow(trees, 8.0), clamp01(trees * 2.2 - 0.8) * 0.6);
  landColor = mix(landColor, uTreeColor * trees, trees);
  landColor *= 1.0 + breakup * 0.5;

  // ── Sand beach ────────────────────────────────────────────────────────────
  landColor = mix(landColor, uSandColor, smoothstep(uSeaLevel + 0.005, uSeaLevel, elevation + breakup * 0.01));

  // ── Drainage ──────────────────────────────────────────────────────────────
  landColor = mix(landColor, uDrainageColor, drainage);

  vec3 result = clamp(landColor, 0.0, 1.0);

  // ── Debug modes ─────────────────────────────────────────────────────────────
  if (uDebugMode == TERRAIN_DEBUG_ELEVATION)  return vec3(elevation);
  if (uDebugMode == TERRAIN_DEBUG_RIDGEMAP)   return vec3(max(0.0, ridgeMap), 0.0, max(0.0, -ridgeMap));
  if (uDebugMode == TERRAIN_DEBUG_TREES)      return vec3(trees);
  if (uDebugMode == TERRAIN_DEBUG_NORMALS)    return normal * 0.5 + 0.5;
  if (uDebugMode == TERRAIN_DEBUG_STEEPNESS)  return vec3(1.0 - normal.y);
  if (uDebugMode == TERRAIN_DEBUG_EXPOSURE)   return vec3(exposure);
  if (uDebugMode == TERRAIN_DEBUG_BREAKUP)    return vec3(breakup * 0.5 + 0.5);

  return result;
}
