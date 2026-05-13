/**
 * Terrain coloring — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 terrainColor(float elevation, float ridgeMap, float erosionDepth,
 *                     float trees, float hardness, vec3 normal, vec3 detailNoise)
 *   vec3 waterColor(float elevation, vec3 normal, vec3 detailNoise)
 *   vec3 computeWaterNormal(vec2 worldXZ)
 *
 * Classification (trees, hardness, isWater, isGrass, isTree) is baked in the
 * elevation compute pass and read from the attribute texture (attrData.g int+fract
 * packing and attrData.b) — NOT recomputed here.
 *
 * Requires in scope (concatenated before this string):
 *   TerrainSample struct + debug constants — from terrainSampleGLSL
 *   simplexFbm, snoise                    — from simplexGLSL
 *   clamp01                               — from shaderUtilsGLSL
 *
 * Colors are exposed as uniforms. Use createTerrainColorUniforms / syncTerrainColorUniforms.
 */

import * as THREE from 'three';
import { terrainSampleGLSL }  from '@core/shaders/terrainSampleGLSL';
import { shaderUtilsGLSL }    from '@core/shaders/shaderUtilsGLSL';
import { TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';

export const TERRAIN_WATER_HEIGHT = 0.35;

// ── Default color palette ─────────────────────────────────────────────────────

export const DEFAULT_CLIFF_COLOR:       [number, number, number] = [0.22, 0.20, 0.20];
export const DEFAULT_DIRT_COLOR:        [number, number, number] = [0.60, 0.50, 0.40];
export const DEFAULT_GRASS_COLOR1:      [number, number, number] = [0.15, 0.30, 0.10];
export const DEFAULT_GRASS_COLOR2:      [number, number, number] = [0.40, 0.50, 0.20];
export const DEFAULT_TREE_COLOR:        [number, number, number] = [0.12, 0.26, 0.10];
export const DEFAULT_SAND_COLOR:        [number, number, number] = [0.76, 0.70, 0.50];
export const DEFAULT_WATER_DEEP_COLOR:   [number, number, number] = [0.04, 0.10, 0.22];
export const DEFAULT_WATER_SHORE_COLOR:  [number, number, number] = [0.14, 0.32, 0.46];
export const DEFAULT_WATER_NORMAL_FREQ      = 52.0;  // waves per world unit
export const DEFAULT_WATER_NORMAL_STRENGTH  = 0.05;  // normal tilt at full strength
export const DEFAULT_WATER_ROUGHNESS        = 0.35;  // PBR roughness — spread specular, not mirror
export const DRAINAGE_WIDTH                 = 0.3;   // ridge-map threshold below which drainage color appears
export const DEFAULT_DRAINAGE_COLOR:        [number, number, number] = [1.0, 1.0, 1.0];

export interface TerrainColorState {
  cliffColor:          [number, number, number];
  dirtColor:           [number, number, number];
  grassColor1:         [number, number, number];
  grassColor2:         [number, number, number];
  treeColor:           [number, number, number];
  sandColor:           [number, number, number];
  waterDeepColor:      [number, number, number];
  waterShoreColor:     [number, number, number];
  waterNormalFreq:     number;
  waterNormalStrength: number;
  waterRoughness:      number;
  drainageColor:       [number, number, number];
  debugMode:           number;
}

export const DEFAULT_TERRAIN_COLORS: TerrainColorState = {
  cliffColor:          DEFAULT_CLIFF_COLOR,
  dirtColor:           DEFAULT_DIRT_COLOR,
  grassColor1:         DEFAULT_GRASS_COLOR1,
  grassColor2:         DEFAULT_GRASS_COLOR2,
  treeColor:           DEFAULT_TREE_COLOR,
  sandColor:           DEFAULT_SAND_COLOR,
  waterDeepColor:      DEFAULT_WATER_DEEP_COLOR,
  waterShoreColor:     DEFAULT_WATER_SHORE_COLOR,
  waterNormalFreq:     DEFAULT_WATER_NORMAL_FREQ,
  waterNormalStrength: DEFAULT_WATER_NORMAL_STRENGTH,
  waterRoughness:      DEFAULT_WATER_ROUGHNESS,
  drainageColor:       DEFAULT_DRAINAGE_COLOR,
  debugMode:           0,
};

export function createTerrainColorUniforms(s: TerrainColorState): Record<string, THREE.IUniform> {
  return {
    uCliffColor:      { value: new THREE.Color(...s.cliffColor) },
    uDirtColor:       { value: new THREE.Color(...s.dirtColor) },
    uGrassColor1:     { value: new THREE.Color(...s.grassColor1) },
    uGrassColor2:     { value: new THREE.Color(...s.grassColor2) },
    uTreeColor:       { value: new THREE.Color(...s.treeColor) },
    uSandColor:       { value: new THREE.Color(...s.sandColor) },
    uWaterDeepColor:      { value: new THREE.Color(...s.waterDeepColor) },
    uWaterShoreColor:     { value: new THREE.Color(...s.waterShoreColor) },
    uWaterNormalFreq:     { value: s.waterNormalFreq },
    uWaterNormalStrength: { value: s.waterNormalStrength },
    uWaterRoughness:      { value: s.waterRoughness },
    uDrainageColor:       { value: new THREE.Color(...s.drainageColor) },
    uDebugMode:           { value: s.debugMode },
  };
}

export function syncTerrainColorUniforms(u: Record<string, THREE.IUniform>, s: TerrainColorState): void {
  (u.uCliffColor.value      as THREE.Color).setRGB(...s.cliffColor);
  (u.uDirtColor.value       as THREE.Color).setRGB(...s.dirtColor);
  (u.uGrassColor1.value     as THREE.Color).setRGB(...s.grassColor1);
  (u.uGrassColor2.value     as THREE.Color).setRGB(...s.grassColor2);
  (u.uTreeColor.value       as THREE.Color).setRGB(...s.treeColor);
  (u.uSandColor.value       as THREE.Color).setRGB(...s.sandColor);
  (u.uWaterDeepColor.value  as THREE.Color).setRGB(...s.waterDeepColor);
  (u.uWaterShoreColor.value as THREE.Color).setRGB(...s.waterShoreColor);
  u.uWaterNormalFreq.value     = s.waterNormalFreq;
  u.uWaterNormalStrength.value = s.waterNormalStrength;
  u.uWaterRoughness.value      = s.waterRoughness;
  (u.uDrainageColor.value as THREE.Color).setRGB(...s.drainageColor);
  u.uDebugMode.value           = s.debugMode;
}

// ── GLSL chunk replacements ───────────────────────────────────────────────────

/**
 * Replaces Three.js `#include <map_fragment>`.
 * Samples the detail noise texture and the attribute texture, then writes
 * diffuseColor via terrainColor().
 * Defines `terrainNorWorld` and `colorNormal` for reuse in the normal chunk.
 *
 * The attribute texture (uAttrTex, NearestFilter) is sampled here — in the
 * fragment shader — rather than being read in the vertex shader and passed as
 * varyings.  Varyings are linearly interpolated across triangles, which would
 * re-introduce the same blending artefacts that the NearestFilter is meant to
 * prevent.  Sampling directly in the fragment shader with the world-space UV
 * guarantees exact per-texel values with no cross-boundary mixing.
 */
export const terrainFragmentMapChunk = /* glsl */`
// 1. Sample detail noise.
vec3 detailNoise = vec3(0.0);
if (uDetailNoiseEnabled == 1) {
  vec2 detailUV = (vTerrainWorldPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
  detailNoise = texture2D(uDetailNoiseTex, detailUV).xyz;
}

// 2. Read elevation and pre-baked classification from the attribute and classification textures.
//    Trees, hardness, and boolean flags were computed in the elevation compute pass
//    (classifyTerrain), using the exact vertex-shader normalY — no recomputation needed here.
float shiftedElev = vTerrainElev + uElevOffset;
vec2 attrUV   = (vTerrainWorldPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
vec4 attrData = texture2D(uAttrTex, attrUV);
// attrData.r = ridgeMap     [-1, 1]  (direct)
// attrData.g = erosionDepth [0, 1]   (packed: ×0.5+0.5; unpack: ×2−1)
// attrData.b = trees        float    (direct; isTree when > 0.36)
// attrData.a = hardness     [0, 1]   (direct)
float erosionDepth = attrData.g * 2.0 - 1.0;
float trees        = clamp01(attrData.b);  // ComputeTreeMap output is unbounded (negative = no trees); clamp once at the read site.
float hardness     = attrData.a;

// 3. Read terrain flags from the dedicated classification texture (NearestFilter, RGBA8).
//    isGrass and isTree come from the exact baked classifyTerrain() result — no drift
//    from fragment-side recomputation.
//    isWater is computed dynamically from shiftedElev so it responds to uElevOffset
//    changes without requiring a full elevation recompute.
vec4 classif = texture2D(uClassifTex, attrUV);
bool isWater = shiftedElev < uSeaLevel;
bool isGrass = classif.g > 0.5;
bool isTree  = classif.b > 0.5;

// 4. Perturb the normal — two independent contributions:
//    - hardness × detail noise: rock/cliff micro-roughness; zero on grass/tree surfaces.
//    - tree canopy bump: two snoise samples give independent XZ tilt, gated by tree
//      density. Uses its own uniforms (uTreeBumpFreq, uTreeBumpStrength) and runs
//      regardless of uDetailNoiseEnabled, so tree shading is always distinct from grass.
vec4 bumpData    = texture2D(uBumpTex, attrUV);
vec3 treeBumpVec = vec3(bumpData.b, 0.0, bumpData.a) * trees * uTreeBumpStrength;
vec3 terrainNorWorld = normalize(
    vTerrainWorldNormal
    + vec3(detailNoise.y, 0.0, detailNoise.z) * uDetailNoiseStrength * hardness
    + treeBumpVec
);
vec3 waterNorWorld = computeWaterNormal(
    bumpData.r * uWaterNormalStrength,
    bumpData.g * uWaterNormalStrength
);
vec3 colorNormal = isWater ? waterNorWorld : terrainNorWorld;

// 5. Output color.
bool _terrainIsWater = isWater;   // shared with roughness/metalness chunks below
if (uDebugMode == TERRAIN_DEBUG_CLASSIFICATION) {
  vec3 classColor = vec3(0.35, 0.30, 0.25);        // rock / cliff / dirt / snow
  if (isGrass) classColor = vec3(0.30, 0.60, 0.10);
  if (isTree)  classColor = vec3(0.05, 0.25, 0.05);
  if (isWater) classColor = vec3(0.05, 0.10, 0.45);
  diffuseColor.rgb = classColor;
} else if (isWater && uDebugMode == TERRAIN_DEBUG_COLOR) {
  diffuseColor.rgb = waterColor(shiftedElev, colorNormal, detailNoise);
} else {
  diffuseColor.rgb = terrainColor(shiftedElev, attrData.r, erosionDepth, trees, hardness, colorNormal, detailNoise);
}
`;

/**
 * Replaces Three.js `#include <normal_fragment_begin>`.
 * Transforms the terrain world-space normal into view space for lighting.
 * `colorNormal` is defined in terrainFragmentMapChunk (chunks share scope).
 */
export const terrainFragmentNormalChunk = /* glsl */`
vec3 normal = normalize(mat3(viewMatrix) * colorNormal);
vec3 nonPerturbedNormal = normal;
`;

/**
 * Replaces Three.js `#include <roughnessmap_fragment>`.
 * Water uses uWaterRoughness (default ~0.2) — noticeably rougher than a mirror
 * so specular highlights are spread out rather than pin-sharp.
 * `_terrainIsWater` is declared in terrainFragmentMapChunk (same main() scope).
 */
export const terrainFragmentRoughnessChunk = /* glsl */`
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = texture2D(roughnessMap, vRoughnessMapUv);
  roughnessFactor *= texelRoughness.g;
#endif
if (_terrainIsWater) roughnessFactor = uWaterRoughness;
`;

/**
 * Replaces Three.js `#include <metalnessmap_fragment>`.
 * Water is a dielectric — metalness must be 0 so the PBR Fresnel term
 * (not conductor reflectance) drives the specular.  This gives the correct
 * view-angle-dependent glint without the tinted, overly-bright metallic look.
 */
export const terrainFragmentMetalnessChunk = /* glsl */`
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
  vec4 texelMetalness = texture2D(metalnessMap, vMetalnessMapUv);
  metalnessFactor *= texelMetalness.b;
#endif
if (_terrainIsWater) metalnessFactor = 0.0;
`;

// ── GLSL source ───────────────────────────────────────────────────────────────

export const terrainColorGLSL = /* glsl */`

${terrainSampleGLSL}
${shaderUtilsGLSL}

#define GRASS_HEIGHT    ${TERRAIN_GRASS_HEIGHT.toFixed(2)}
#define DRAINAGE_WIDTH  ${DRAINAGE_WIDTH.toFixed(2)}

uniform float uSeaLevel;

uniform vec3      uCliffColor;
uniform vec3      uDirtColor;
uniform vec3      uGrassColor1;
uniform vec3      uGrassColor2;
uniform vec3      uTreeColor;
uniform vec3      uSandColor;
uniform vec3      uDrainageColor;
// Water colors — visible through the semi-transparent WaterMesh plane.
// uWaterDeepColor  : deep water (high diff from sea level) — dark navy.
// uWaterShoreColor : shallow water (diff ≈ 0) — lighter teal/blue.
uniform vec3      uWaterDeepColor;
uniform vec3      uWaterShoreColor;
// Water normal perturbation.
// uWaterNormalFreq     : spatial frequency in world units (e.g. 1.0 = 1 wave per world unit)
// uWaterNormalStrength : normal tilt at full strength (0 = flat, 0.5 = moderate, 1+ = choppy)
uniform float     uWaterNormalFreq;
uniform float     uWaterNormalStrength;
uniform float     uWaterRoughness;
uniform int       uDebugMode;
uniform float     uTreeBumpStrength;
// Attribute texture (LinearFilter) — four continuous float channels baked in the compute pass.
// R = ridgeMap, G = erosionDepth (packed), B = trees, A = hardness.
uniform sampler2D uAttrTex;
// Classification texture (NearestFilter, RGBA8) — boolean flags from the compute pass.
// R = isWater, G = isGrass, B = isTree, A = unused.  Values are 0.0 or 1.0.
uniform sampler2D uClassifTex;
// Bump texture (TerrainBumpGL) — baked once, static per terrain build.
// R = water normal dx, G = water normal dz (gradient at uWaterNormalFreq, strength = 1).
// B = tree bump X snoise, A = tree bump Z snoise (at uTreeBumpFreq).
uniform sampler2D uBumpTex;

// ── Water normal perturbation ─────────────────────────────────────────────────
//
// Reconstructs the world-space surface normal for water from the pre-baked
// gradient stored in uBumpTex.rg (computed by TerrainBumpGL, strength = 1).
// uWaterNormalStrength scales the tilt at render time without requiring a rebake.
//
// Clamps tilt so the normal never points below ~18° from vertical (sin18°≈0.3),
// preventing waves from creating lighting black-holes.
vec3 computeWaterNormal(float dx, float dz) {
  vec3 n = normalize(vec3(-dx, 1.0, -dz));
  n.y = max(n.y, 0.3);
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
//   normal               world-space surface normal (flat vec3(0,1,0) for water)
//   detailNoise  vec3    suppNoise sample: .x = FBM [-1,1], .yz = derivatives
vec3 waterColor(float elevation, vec3 normal, vec3 detailNoise) {
  float breakup = detailNoise.x;
  float diff    = max(0.0, uSeaLevel - elevation);  // depth below sea level [0, uSeaLevel]

  float shore = normal.y > 1e-2 ? exp(-diff * 60.0)                           : 0.0;
  float foam  = normal.y > 1e-2 ? smoothstep(0.005, 0.0, diff + breakup * 0.005) : 0.0;

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
//   normal                surface normal in world space (may be perturbed by detail noise)
//   detailNoise  vec3      suppNoise texture sample: .x = FBM value [-1,1], .yz = derivatives
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

`;
