/**
 * Terrain coloring — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 terrainColor(float elevation, float ridgeMap, float erosionDepth,
 *                     float trees, float hardness, vec3 normal, vec3 detailNoise)
 *   vec3 waterColor(float elevation, float normalY, vec3 detailNoise)
 *   vec3 computeWaterNormal(vec3 up, vec3 grad)
 *
 * Classification (isWater, isGrass, isTree, trees, hardness) is computed
 * dynamically in the fragment shader via classifyTerrain() using the shifted
 * elevation, so all flags respond to uElevOffset without recompute.
 *
 * Includes (self-contained — no external GLSL required):
 *   terrainSampleGLSL, shaderUtilsGLSL, simplexNoiseGLSL,
 *   treeGLSL, terrainClassificationGLSL
 *
 * Use terrainFinalStateGLSL as the pipeline entry point — it re-exports this
 * combined chunk and is the single import consumers should reference.
 *
 * Colors are exposed as uniforms. Use createTerrainColorUniforms / syncTerrainColorUniforms.
 */

import * as THREE from 'three';
import { terrainSampleGLSL }          from '@core/shaders/terrainSampleGLSL';
import { shaderUtilsGLSL }            from '@core/shaders/shaderUtilsGLSL';
import { simplexNoiseGLSL }           from '@core/noise/simplexGLSL';
import { treeGLSL, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';
import { terrainClassificationGLSL }  from '@core/shaders/terrainClassificationGLSL';
import { BIOME_COLORS, BIOME_STANDARD, BIOME_OCEAN } from '@core/terrain/BiomeBoundaries';

const glslVec3 = (c: [number, number, number]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

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
 * prevent.  Sampling directly in the fragment shader with the patch UV
 * guarantees exact per-texel values with no cross-boundary mixing.
 *
 * Elevation and its gradient are read per fragment too, so the shading keeps
 * the full resolution of the baked textures even when the mesh is coarser.
 */
export const terrainFragmentMapChunk = /* glsl */`
// 0. Per-fragment terrain state, read from the baked elevation texture.
//    Everything below is expressed in the domain (planet) frame; "up" is the
//    normal of the undisplaced surface, so no axis is assumed to be vertical.
vec3  terrain_up       = normalize(vTerrainUp);
vec2  terrain_elevUv   = terrainTexelUv(vTerrainUv, vec2(textureSize(uElevationTex, 0)));
vec2  terrain_treeUv   = terrainTexelUv(vTerrainUv, vec2(textureSize(uTreeDensityTex, 0)));
vec4  terrain_elevData = texture2D(uElevationTex, terrain_elevUv);
float terrain_elev     = terrain_elevData.r + uElevOffset
                       + texture2D(uTreeDensityTex, terrain_treeUv).r / 100.0;
vec3  terrain_grad     = terrain_elevData.gba;
bool  terrain_underwater = terrain_elev < uSeaLevel;

// Shape-space slope: cosine between the normal and "up" for a relief of one
// terrain unit per unit of elevation.  Classification uses it so that the look
// of the terrain does not depend on the vertical exaggeration.
float terrain_slopeY = terrain_underwater ? 1.0 : inversesqrt(1.0 + dot(terrain_grad, terrain_grad));

// Geometric normal of the displayed (exaggerated) surface — used for lighting.
vec3 terrain_baseNormal = terrain_underwater
  ? terrain_up
  : normalize(terrain_up - uVerticalScale * terrain_grad);

// 1. Sample detail noise: .x = FBM value, .yzw = its surface gradient.
vec4 detailTex = vec4(0.0);
if (uDetailNoiseEnabled == 1) {
  vec2 detailUV = terrainTexelUv(vTerrainUv, vec2(textureSize(uDetailNoiseTex, 0)));
  detailTex = texture2D(uDetailNoiseTex, detailUV);
}
vec3 detailNoise = vec3(detailTex.x, 0.0, 0.0);
vec3 detailGrad  = detailTex.yzw;

// 2. Read erosion attributes from the baked attribute texture (same size as the
//    elevation texture).  R = ridgeMap [-1,1], G = erosionDepth [0,1] packed (×0.5+0.5).
vec4 attrData  = texture2D(uAttrTex, terrain_elevUv);
float erosionDepth = attrData.g * 2.0 - 1.0;

// 3. Classify terrain dynamically. classifyTerrain() runs ComputeTreeMap in
//    the fragment shader.  The tree noise is faded out when it becomes finer
//    than a pixel, so distant forests do not shimmer.
float terrain_footprint = length(fwidth(vTerrainDomainPos));
float terrain_treeFade  = clamp01(1.0 / max(terrain_footprint * uTreeNoiseFreq, 1e-6) - 1.0);
TerrainClassification tc = classifyTerrain(terrain_elev, attrData.r, terrain_slopeY, vTerrainDomainPos, terrain_treeFade);
bool  isWater  = tc.isWater;
bool  isGrass  = tc.isGrass;
bool  isTree   = tc.isTree;
float trees    = clamp01(tc.trees);
float hardness = tc.hardness;

// 4. Perturb the normal — two independent contributions:
//    - hardness × detail noise: rock/cliff micro-roughness; zero on grass/tree surfaces.
//    - tree canopy bump: a baked tangent tilt vector, gated by tree density.
//      Uses its own uniforms (uTreeBumpFreq, uTreeBumpStrength) and runs
//      regardless of uDetailNoiseEnabled, so tree shading is always distinct from grass.
vec2 bumpUV      = terrainTexelUv(vTerrainUv, vec2(textureSize(uBumpWaterTex, 0)));
vec3 treeBumpVec = texture2D(uBumpTreeTex, bumpUV).xyz * trees * uTreeBumpStrength;
vec3 terrainNorDomain = normalize(
    terrain_baseNormal
    + detailGrad * uDetailNoiseStrength * hardness
    + treeBumpVec
);
vec3 waterNorDomain = computeWaterNormal(
    terrain_up,
    texture2D(uBumpWaterTex, bumpUV).xyz * uWaterNormalStrength
);
vec3  colorNormal  = isWater ? waterNorDomain : terrainNorDomain;
float colorNormalY = dot(colorNormal, terrain_up);
// Normal as seen from the surface (x, up, z) — for the debug views.
vec3 colorNormalLocal;
{
  vec3 terrain_t1, terrain_t2;
  terrainTangentBasis(terrain_up, terrain_t1, terrain_t2);
  colorNormalLocal = vec3(dot(colorNormal, terrain_t1), colorNormalY, dot(colorNormal, terrain_t2));
}

// 5. Output color.
bool _terrainIsWater = isWater;   // shared with roughness/metalness chunks below
if (uDebugMode == TERRAIN_DEBUG_BIOME) {
  // Biome weights, with the coastline (sea level) drawn as a dark line.
  vec3 biomeColor = mix(${glslVec3(BIOME_COLORS[BIOME_STANDARD])}, ${glslVec3(BIOME_COLORS[BIOME_OCEAN])}, attrData.b);
  float coast = 1.0 - smoothstep(0.0, max(1.5 * fwidth(terrain_elev), 1e-6), abs(terrain_elev - uSeaLevel));
  diffuseColor.rgb = mix(biomeColor, vec3(0.05), coast);
} else if (uDebugMode == TERRAIN_DEBUG_CLASSIFICATION) {
  vec3 classColor = vec3(0.35, 0.30, 0.25);        // rock / cliff / dirt / snow
  if (isGrass) classColor = vec3(0.30, 0.60, 0.10);
  if (isTree)  classColor = vec3(0.05, 0.25, 0.05);
  if (isWater) classColor = vec3(0.05, 0.10, 0.45);
  diffuseColor.rgb = classColor;
} else if (isWater && uDebugMode == TERRAIN_DEBUG_COLOR) {
  diffuseColor.rgb = waterColor(terrain_elev, colorNormalY, detailNoise);
} else {
  diffuseColor.rgb = terrainColor(terrain_elev, attrData.r, erosionDepth, trees, hardness, colorNormalLocal, detailNoise);
}
`;

/**
 * Replaces Three.js `#include <normal_fragment_begin>`.
 * Rotates the terrain normal from the domain frame to the world frame of the
 * scene, then into view space for lighting.
 * `colorNormal` is defined in terrainFragmentMapChunk (chunks share scope).
 */
export const terrainFragmentNormalChunk = /* glsl */`
vec3 normal = normalize(mat3(viewMatrix) * (uDomainToWorld * colorNormal));
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

// ── Classification pipeline (simplex → trees → classify) ─────────────────────
${simplexNoiseGLSL}
${treeGLSL}
${terrainClassificationGLSL}

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

`;
