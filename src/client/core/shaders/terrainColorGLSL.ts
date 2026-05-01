/**
 * Terrain coloring — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 terrainColor(inout TerrainSample s, vec3 worldPos, vec3 normal, vec3 detailNoise)
 *
 * `s` is a TerrainSample with elevation and ridgeMap already filled (unpacked
 * from the elevation texture in the vertex stage and passed via varyings).
 * The function fills s.trees as a side-effect so callers can inspect it.
 *
 * When uDebugMode ≠ TERRAIN_DEBUG_COLOR the function returns a diagnostic
 * visualisation instead of the full color — see TERRAIN_DEBUG_* constants.
 *
 * Requires in scope (concatenated before this string):
 *   TerrainSample struct + debug constants — from terrainSampleGLSL
 *   simplexFbm, snoise                    — from simplexGLSL
 *   shaderUtilsGLSL macros (clamp01, …)   — from shaderUtilsGLSL
 *   ComputeTreeMap                         — from treeGLSL
 *
 * Sea level is controlled by the `uSeaLevel` uniform (default 0.35), shared
 * with the vertex shader. Adjust via terrain.seaLevel on the TS side.
 *
 * Colors are exposed as uniforms so they can be tweaked at runtime without
 * recompiling. Use createTerrainColorUniforms / syncTerrainColorUniforms from
 * TypeScript.
 */

import * as THREE from 'three';
import { terrainSampleGLSL }  from '@core/shaders/terrainSampleGLSL';
import { simplexNoiseGLSL }   from '@core/noise/simplexGLSL';
import { shaderUtilsGLSL }    from '@core/shaders/shaderUtilsGLSL';
import { treeGLSL, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';

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
export const DEFAULT_WATER_NORMAL_FADE_DIST = 6.0;   // world units before waves fade out
export const DEFAULT_WATER_ROUGHNESS        = 0.35;  // PBR roughness — spread specular, not mirror

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
  waterNormalFadeDist: number;
  waterRoughness:      number;
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
  waterNormalFadeDist: DEFAULT_WATER_NORMAL_FADE_DIST,
  waterRoughness:      DEFAULT_WATER_ROUGHNESS,
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
    uWaterNormalFadeDist: { value: s.waterNormalFadeDist },
    uWaterRoughness:      { value: s.waterRoughness },
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
  u.uWaterNormalFadeDist.value = s.waterNormalFadeDist;
  u.uWaterRoughness.value      = s.waterRoughness;
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

// 2. Terrain inputs — elevation and attribute texture (ridgeMap, erosionDepth).
float shiftedElev = vTerrainElev + uElevOffset;
vec2 attrUV   = (vTerrainWorldPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
vec4 attrData = texture2D(uAttrTex, attrUV);
// attrData.r = ridgeMap      [-1, 1]  (stored directly)
// attrData.g = erosionPacked  [0, 1]  (packed: 0 = deep gully, 0.5 = neutral, 1 = ridge)
float erosionDepth = attrData.g * 2.0 - 1.0;  // unpack [0,1] → [-1,1]

// 3. Classify terrain using the UNPERTURBED vertex normal.
//    The classification must precede normal perturbation so it can gate it.
TerrainClassification tc = classifyTerrain(shiftedElev, attrData.r, vTerrainWorldNormal.y, vTerrainWorldPos.xz);

// 4. Perturb the normal — faded out on soft surfaces (grass/tree) using the
//    smooth hardness scalar so no visible edge appears at the boundary.
vec3 terrainNorWorld = normalize(vTerrainWorldNormal + vec3(detailNoise.y, 0.0, detailNoise.z) * uDetailNoiseStrength * tc.hardness);
vec3 waterNorWorld   = computeWaterNormal(vTerrainWorldPos.xz);
vec3 colorNormal = tc.isWater ? waterNorWorld : terrainNorWorld;

// 5. Output color.
//    TERRAIN_DEBUG_COLOR (0) → full shading, branching on tc.isWater.
//    All other debug modes fall through to terrainColor() for a universal
//    visualization that works on both land and water pixels.
bool _terrainIsWater = tc.isWater;   // shared with roughness/metalness chunks below
if (uDebugMode == TERRAIN_DEBUG_CLASSIFICATION) {
  vec3 classColor = vec3(0.35, 0.30, 0.25);        // rock / cliff / dirt / snow
  if (tc.isGrass) classColor = vec3(0.30, 0.60, 0.10);
  if (tc.isTree)  classColor = vec3(0.05, 0.25, 0.05);
  if (tc.isWater) classColor = vec3(0.05, 0.10, 0.45);
  diffuseColor.rgb = classColor;
} else if (tc.isWater && uDebugMode == TERRAIN_DEBUG_COLOR) {
  diffuseColor.rgb = waterColor(shiftedElev, colorNormal, detailNoise);
} else {
  diffuseColor.rgb = terrainColor(shiftedElev, attrData.r, erosionDepth, tc.trees, tc.hardness, colorNormal, detailNoise);
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
${simplexNoiseGLSL}
${shaderUtilsGLSL}

#define GRASS_HEIGHT  ${TERRAIN_GRASS_HEIGHT.toFixed(2)}

uniform float uSeaLevel;

uniform vec3      uCliffColor;
uniform vec3      uDirtColor;
uniform vec3      uGrassColor1;
uniform vec3      uGrassColor2;
uniform vec3      uTreeColor;
uniform vec3      uSandColor;
// Water colors — visible through the semi-transparent WaterMesh plane.
// uWaterDeepColor  : deep water (high diff from sea level) — dark navy.
// uWaterShoreColor : shallow water (diff ≈ 0) — lighter teal/blue.
uniform vec3      uWaterDeepColor;
uniform vec3      uWaterShoreColor;
// Water normal perturbation.
// uWaterNormalFreq     : spatial frequency in world units (e.g. 1.0 = 1 wave per world unit)
// uWaterNormalStrength : normal tilt at full strength (0 = flat, 0.5 = moderate, 1+ = choppy)
// uWaterNormalFadeDist : camera distance at which the perturbation fully fades out,
//                        preventing continent-scale waves when zoomed out
uniform float     uWaterNormalFreq;
uniform float     uWaterNormalStrength;
uniform float     uWaterNormalFadeDist;
uniform float     uWaterRoughness;
uniform int       uDebugMode;
// Attribute texture (NearestFilter) — ridgeMap (R) and erosionDepth (G).
// Sampled here in the fragment shader rather than being carried as vertex varyings,
// so that NearestFilter is respected and no linear interpolation crosses texel boundaries.
uniform sampler2D uAttrTex;

${treeGLSL}

// Terrain classification — computed once per fragment from the UNPERTURBED normal
// and shared between the normal-perturbation step and the color step.
//
// Fields:
//   trees    float  continuous tree density [0, 1] — used for color blending
//   isWater  bool   elevation below sea level
//   isGrass  bool   grass zone: low elevation, flat surface, no tree cover
//   isTree   bool   tree cover above density threshold
//   (implicitly: isRock = !isWater && !isGrass && !isTree)
//
// Priority order: water > tree > grass > rock.
// Thresholds are deliberately simple — they do not need to exactly match the
// smooth color blends in terrainColor(); they only drive domain decisions such
// as normal-noise masking.
struct TerrainClassification {
  float trees;
  float hardness; // [0, 1] — 0 = soft (grass/tree), 1 = hard (rock/cliff/snow)
                  // smooth signal for normal-perturbation weight; avoids the sharp
                  // edge that boolean gating produces at terrain-type boundaries
  bool  isWater;
  bool  isGrass;
  bool  isTree;
};

TerrainClassification classifyTerrain(float elevation, float ridgeMap, float normalY, vec2 worldXZ) {
  TerrainClassification tc;
  tc.trees   = ComputeTreeMap(elevation, ridgeMap, normalY, worldXZ);
  tc.isWater = elevation < uSeaLevel;
  tc.isTree  = !tc.isWater && tc.trees > 0.36;
  tc.isGrass = !tc.isWater && !tc.isTree
             && elevation < GRASS_HEIGHT + 0.04
             && normalY   > 0.85;

  // Smooth version of the rock/soft boundary — mirrors the transition bands
  // used in terrainColor() so the fade-out is invisible against the color blend.
  float grassSmooth = smoothstep(GRASS_HEIGHT + 0.05, GRASS_HEIGHT + 0.02, elevation)
                    * smoothstep(0.80, 1.0, normalY);
  float treeSmooth  = clamp01(tc.trees * 2.2 - 0.8);
  tc.hardness = 1.0 - clamp01(grassSmooth + treeSmooth);
  return tc;
}

// ── Water normal perturbation ─────────────────────────────────────────────────
//
// Computes a world-space surface normal for water using two octaves of simplex
// noise evaluated at world XZ.  The gradient is derived via central finite
// differences (3 snoise calls total after the shared h0 sample).
//
// Scale is explicit in world units: uWaterNormalFreq = 1.0 means one wave
// feature per world unit, independent of patchSize or camera zoom.
//
// Strength is faded by camera distance so that water seen from far away does
// not show artificially large waves.  Beyond uWaterNormalFadeDist the normal
// collapses to vec3(0,1,0) (flat mirror), which looks correct and is cheaper.
//
// cameraPosition is a Three.js built-in uniform available in all shaders.
vec3 computeWaterNormal(vec2 worldXZ) {
  float camDist = length(cameraPosition - vec3(worldXZ.x, uSeaLevel, worldXZ.y));
  float lodFade = 1.0 - smoothstep(uWaterNormalFadeDist * 0.5, uWaterNormalFadeDist, camDist);
  if (lodFade < 1e-3) return vec3(0.0, 1.0, 0.0);

  // 2-octave FBM — inlined so the three sample positions share octave weights.
  vec2 p = worldXZ * uWaterNormalFreq;
  float eps = 0.3;  // finite-difference step; keep in the same order as the feature size

  // Sample at centre and two offset positions.
  #define _WFBM(uv) (snoise(vec3(uv,           0.0)) * 0.65 \
                   + snoise(vec3((uv) * 2.13,   0.0)) * 0.35)
  float h0 = _WFBM(p);
  float hx = _WFBM(p + vec2(eps, 0.0));
  float hz = _WFBM(p + vec2(0.0, eps));
  #undef _WFBM

  float scale = uWaterNormalStrength * lodFade / eps;
  float dx = (hx - h0) * scale;
  float dz = (hz - h0) * scale;
  // Clamp tilt so the normal never points below ~18° from vertical (sin18°≈0.3).
  // Prevents waves from creating lighting black-holes when the normal faces away
  // from the light — physically, ocean waves don't overhang.
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
  landColor = mix(landColor, uTreeColor * pow(trees, 8.0), clamp01(trees * 2.2 - 0.8) * 0.6);
  landColor *= 1.0 + breakup * 0.5;

  // ── Sand beach ────────────────────────────────────────────────────────────
  landColor = mix(landColor, uSandColor, smoothstep(uSeaLevel + 0.005, uSeaLevel, elevation + breakup * 0.01));

  vec3 result = clamp(landColor, 0.0, 1.0);

  // ── Debug modes ─────────────────────────────────────────────────────────────
  if (uDebugMode == TERRAIN_DEBUG_ELEVATION)  return vec3(elevation);
  if (uDebugMode == TERRAIN_DEBUG_RIDGEMAP)   return vec3(max(0.0, ridgeMap), 0.0, max(0.0, -ridgeMap));
  if (uDebugMode == TERRAIN_DEBUG_TREES)      return vec3(clamp(trees, 0.0, 1.0));
  if (uDebugMode == TERRAIN_DEBUG_NORMALS)    return normal * 0.5 + 0.5;
  if (uDebugMode == TERRAIN_DEBUG_STEEPNESS)  return vec3(1.0 - normal.y);
  if (uDebugMode == TERRAIN_DEBUG_EXPOSURE)   return vec3(exposure);
  if (uDebugMode == TERRAIN_DEBUG_BREAKUP)    return vec3(breakup * 0.5 + 0.5);

  return result;
}

`;
