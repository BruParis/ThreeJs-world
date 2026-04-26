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
 * Constant WATER_HEIGHT (0.35) is the sea-level threshold and must match the
 * value used in the vertex shader (TERRAIN_SEA in terrainVertexGLSL).
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

export const DEFAULT_CLIFF_COLOR:        [number, number, number] = [0.22, 0.20, 0.20];
export const DEFAULT_DIRT_COLOR:         [number, number, number] = [0.60, 0.50, 0.40];
export const DEFAULT_GRASS_COLOR1:       [number, number, number] = [0.15, 0.30, 0.10];
export const DEFAULT_GRASS_COLOR2:       [number, number, number] = [0.40, 0.50, 0.20];
export const DEFAULT_TREE_COLOR:         [number, number, number] = [0.12, 0.26, 0.10];
export const DEFAULT_WATER_COLOR:        [number, number, number] = [0.05, 0.10, 0.40];
export const DEFAULT_WATER_SHORE_COLOR:  [number, number, number] = [0.15, 0.55, 0.80];

export interface TerrainColorState {
  cliffColor:      [number, number, number];
  dirtColor:       [number, number, number];
  grassColor1:     [number, number, number];
  grassColor2:     [number, number, number];
  treeColor:       [number, number, number];
  waterColor:      [number, number, number];
  waterShoreColor: [number, number, number];
  debugMode:       number;
}

export const DEFAULT_TERRAIN_COLORS: TerrainColorState = {
  cliffColor:      DEFAULT_CLIFF_COLOR,
  dirtColor:       DEFAULT_DIRT_COLOR,
  grassColor1:     DEFAULT_GRASS_COLOR1,
  grassColor2:     DEFAULT_GRASS_COLOR2,
  treeColor:       DEFAULT_TREE_COLOR,
  waterColor:      DEFAULT_WATER_COLOR,
  waterShoreColor: DEFAULT_WATER_SHORE_COLOR,
  debugMode:       0,
};

export function createTerrainColorUniforms(s: TerrainColorState): Record<string, THREE.IUniform> {
  return {
    uCliffColor:      { value: new THREE.Color(...s.cliffColor) },
    uDirtColor:       { value: new THREE.Color(...s.dirtColor) },
    uGrassColor1:     { value: new THREE.Color(...s.grassColor1) },
    uGrassColor2:     { value: new THREE.Color(...s.grassColor2) },
    uTreeColor:       { value: new THREE.Color(...s.treeColor) },
    uWaterColor:      { value: new THREE.Color(...s.waterColor) },
    uWaterShoreColor: { value: new THREE.Color(...s.waterShoreColor) },
    uDebugMode:       { value: s.debugMode },
  };
}

export function syncTerrainColorUniforms(u: Record<string, THREE.IUniform>, s: TerrainColorState): void {
  (u.uCliffColor.value      as THREE.Color).setRGB(...s.cliffColor);
  (u.uDirtColor.value       as THREE.Color).setRGB(...s.dirtColor);
  (u.uGrassColor1.value     as THREE.Color).setRGB(...s.grassColor1);
  (u.uGrassColor2.value     as THREE.Color).setRGB(...s.grassColor2);
  (u.uTreeColor.value       as THREE.Color).setRGB(...s.treeColor);
  (u.uWaterColor.value      as THREE.Color).setRGB(...s.waterColor);
  (u.uWaterShoreColor.value as THREE.Color).setRGB(...s.waterShoreColor);
  u.uDebugMode.value        = s.debugMode;
}

// ── GLSL chunk replacements ───────────────────────────────────────────────────

/**
 * Replaces Three.js `#include <map_fragment>`.
 * Samples the detail noise texture, builds a TerrainSample from varyings,
 * and writes diffuseColor via terrainColor().
 * Defines `terrainNorWorld` and `colorNormal` for reuse in the normal chunk.
 */
export const terrainFragmentMapChunk = /* glsl */`
vec3 detailNoise = vec3(0.0);
if (uDetailNoiseEnabled == 1) {
  vec2 detailUV = (vTerrainWorldPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
  detailNoise = texture2D(uDetailNoiseTex, detailUV).xyz;
}
vec3 terrainNorWorld = normalize(vTerrainWorldNormal + vec3(detailNoise.y, 0.0, detailNoise.z) * uDetailNoiseStrength);
float shiftedElev = vTerrainElev + uElevOffset;
vec3 colorNormal = shiftedElev < WATER_HEIGHT ? vTerrainWorldNormal : terrainNorWorld;
diffuseColor.rgb = terrainColor(shiftedElev, vTerrainRidge, vTerrainErosionDepth, vTerrainWorldPos.xz, colorNormal, detailNoise);
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

// ── GLSL source ───────────────────────────────────────────────────────────────

export const terrainColorGLSL = /* glsl */`

${terrainSampleGLSL}
${simplexNoiseGLSL}
${shaderUtilsGLSL}

#define WATER
#define WATER_HEIGHT  ${(0.35).toFixed(2)}
#define GRASS_HEIGHT  ${TERRAIN_GRASS_HEIGHT.toFixed(2)}

uniform vec3 uCliffColor;
uniform vec3 uDirtColor;
uniform vec3 uGrassColor1;
uniform vec3 uGrassColor2;
uniform vec3 uTreeColor;
uniform vec3 uWaterColor;
uniform vec3 uWaterShoreColor;
uniform int  uDebugMode;

${treeGLSL}

// Takes individual elevation/ridgeMap floats rather than a TerrainSample struct —
// many WebGL2 drivers reject struct types in function parameter positions.
vec3 terrainColor(float elevation, float ridgeMap, float erosionDepth, vec2 worldXZ, vec3 normal, vec3 detailNoise) {
  elevation = clamp(elevation, 0.0, 1.0);

  float breakup = detailNoise.x;

  // "Occlusion" here is an erosion-derived proxy for ambient occlusion (AO).
  // Eroded gullies (erosionDepth ≈ -1) are concave, sheltered surfaces — exactly
  // the geometry that gets low AO in real lighting (less sky exposure, darker).
  // Ridges (erosionDepth ≈ +1) are convex and exposed.  The +0.5 bias sets the
  // neutral point so flat un-eroded terrain sits at occlusion = 0.5.
  // This drives dirt placement: low occlusion → sheltered gully → sediment visible.
  float occlusion = clamp01(erosionDepth + 0.5);

  // ── Water color (shore + foam) ─────────────────────────────────────────────
  float diff  = max(0.0, WATER_HEIGHT - elevation);
  float shore = normal.y > 1e-2 ? exp(-diff * 60.0) : 0.0;
  float foam  = normal.y > 1e-2 ? smoothstep(0.005, 0.0, diff + breakup * 0.005) : 0.0;
  vec3 waterColor = mix(uWaterColor, uWaterShoreColor, shore);
  waterColor = mix(waterColor, vec3(1.0), foam);

  // ── Slope helpers ──────────────────────────────────────────────────────────
  float slopeFlatness = smoothstep(0.5, 0.80, normal.y);
  slopeFlatness *= slopeFlatness;

  // ── Tree coverage ──────────────────────────────────────────────────────────
  float trees = ComputeTreeMap(elevation, ridgeMap, normal.y, worldXZ);

  // ── Land color ─────────────────────────────────────────────────────────────
  vec3 landColor = vec3(0.0);

  landColor = uCliffColor * smoothstep(0.0, 1.0, occlusion);
  // landColor = uCliffColor * smoothstep(0.4, 0.52, elevation);
  // landColor = mix(landColor, uDirtColor, smoothstep(0.6, 0.0, occlusion + breakup * 1.5));

  // Snow
  //landColor = mix(landColor, vec3(1.0), smoothstep(0.53, 0.6, elevation + breakup * 0.1));

  // Tree color
  // landColor = mix(landColor, uTreeColor * pow(trees, 8.0), clamp01(trees * 2.2 - 0.8) * 0.6);

  // landColor *= 1.0 + breakup * 0.5;

  // ── Shoreline blend ────────────────────────────────────────────────────────
  float blendHalf   = mix(0.001, 0.01, slopeFlatness);
  float waterFactor = 1.0 - smoothstep(WATER_HEIGHT - blendHalf, WATER_HEIGHT + blendHalf, elevation);

  vec3 result = clamp(mix(landColor, waterColor, waterFactor), 0.0, 1.0);

  // ── Debug mode ─────────────────────────────────────────────────────────────
  if (uDebugMode == TERRAIN_DEBUG_ELEVATION)  return vec3(elevation);
  if (uDebugMode == TERRAIN_DEBUG_RIDGEMAP)   return vec3(max(0.0, ridgeMap), 0.0, max(0.0, -ridgeMap));
  if (uDebugMode == TERRAIN_DEBUG_TREES)      return vec3(clamp(trees, 0.0, 1.0));
  if (uDebugMode == TERRAIN_DEBUG_NORMALS)    return normal * 0.5 + 0.5;
  if (uDebugMode == TERRAIN_DEBUG_STEEPNESS)  return vec3(1.0 - normal.y);

  return result;
}

`;
