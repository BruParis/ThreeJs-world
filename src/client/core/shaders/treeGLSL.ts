/**
 * Tree coverage — reusable GLSL fragment.
 *
 * Exposes:
 *   float ComputeTreeMap(float elevation, float ridgeMap, float normalY,
 *                        vec3 P, bool isWater, bool isGrass, float noiseFade)
 *
 * Returns an unclamped tree density value.  Positive = tree-covered, negative =
 * bare ground.  Callers must clamp before use (threshold for isTree is 0.36).
 *
 * Parameters:
 *   elevation – normalised elevation [0, 1]
 *   ridgeMap  – erosion ridge signal [-1, 1]; negative values indicate gullies
 *   normalY   – cosine between the surface normal and "up" (flat = 1, cliff = 0)
 *   P         – 3D position in terrain units (used for high-frequency tree noise)
 *   isWater   – pre-classified water flag; returns 0 immediately if true
 *   isGrass   – preliminary grass-zone flag (elevation + slope, without !isTree)
 *   noiseFade – 1 = full tree noise, 0 = noise replaced by its mean; lower it when
 *               the noise is finer than the sampling footprint (distant terrain)
 *
 * Requirements before including this snippet:
 *   GRASS_HEIGHT  must be defined (upper elevation limit for trees)
 *   uSeaLevel     uniform must be in scope (declared in the fragment shader)
 */
import * as THREE from 'three';
import { fractalNoise3GLSL } from '@core/noise/fractalNoise3GLSL';

export const TERRAIN_GRASS_HEIGHT = 0.465;

export const DEFAULT_TREE_ELEV_MAX   = TERRAIN_GRASS_HEIGHT + 0.05;  // 0.515
export const DEFAULT_TREE_ELEV_MIN   = TERRAIN_GRASS_HEIGHT + 0.01;  // 0.475
export const DEFAULT_TREE_SLOPE_MIN  = 0.90;
export const DEFAULT_TREE_RIDGE_MIN  = -1.4;
export const DEFAULT_TREE_NOISE_FREQ = 200.0;
export const DEFAULT_TREE_NOISE_POW  = 2.0;
export const DEFAULT_TREE_DENSITY      = 1.5;
export const DEFAULT_TREE_BUMP_STRENGTH = 0.4;
export const DEFAULT_TREE_BUMP_FREQ     = 80.0;

export const treeGLSL = /* glsl */`

${fractalNoise3GLSL}

uniform int   uTreeEnabled;
uniform float uTreeElevMax;
uniform float uTreeElevMin;
uniform float uTreeSlopeMin;
uniform float uTreeRidgeMin;
uniform float uTreeNoiseFreq;
uniform float uTreeNoisePow;
uniform float uTreeDensity;
uniform float uTreeBumpStrength;

// Returns a signed tree-density value.
// Positive  → trees present; negative → no trees (bare ground / water / cliff).
float _treesAmount(float height, float normalY, float ridgeMap) {
    return ((
        // Elevation gate: trees only in the grass/low-land zone.
        smoothstep(uTreeElevMax, uTreeElevMin, height + 0.01)
        // Slope gate: trees on reasonably flat surfaces, absent on cliffs.
        * smoothstep(uTreeSlopeMin, 1.0, normalY)
        // Ridge gate: suppress trees along erosion ridges / gullies.
        * smoothstep(uTreeRidgeMin, 0.0, ridgeMap)
    ) - 0.5) / 0.6;
}

// Returns raw tree coverage density for the given surface.
// Takes individual fields instead of a struct — many WebGL2 drivers reject
// struct types in function parameter positions.
//
// isWater — pre-classified water flag from terrainClassificationGLSL; if true,
//           returns 0 immediately (replaces the per-sample uSeaLevel smoothstep).
// isGrass — preliminary grass-zone flag (elevation + slope, without !isTree);
//           gates trees to grass-zone areas by design.
//
// Output range: roughly [-(uTreeDensity * 1.83), +(uTreeDensity * 0.83)].
//   Positive  → tree cover (threshold for isTree is 0.36).
//   Negative  → bare ground / water / cliff.
// The output is NOT clamped to [0, 1] by design — callers must clamp before use.
float ComputeTreeMap(float elevation, float ridgeMap, float normalY, vec3 P, bool isWater, bool isGrass, float noiseFade) {
    if (uTreeEnabled == 0) return 0.0;
    if (isWater) return 0.0;
    if (!isGrass) return 0.0;

    float treesAmount = _treesAmount(elevation, normalY, ridgeMap);

    // Noise breaks up the tree boundary organically.
    // treeNoise ∈ [0, 1]; pow() sharpens the cutoff (higher uTreeNoisePow = patchier).
    float treeNoise = 0.5;
    if (noiseFade > 0.0) {
        treeNoise = mix(0.5, noised3(P * uTreeNoiseFreq).x * 0.5 + 0.5, noiseFade);
    }
    return (treesAmount - pow(treeNoise, uTreeNoisePow)) * uTreeDensity;
}

`;



// ── Uniform helpers ───────────────────────────────────────────────────────────

export interface TreeUniformState {
  treeEnabled:      boolean;
  treeElevMax:      number;
  treeElevMin:      number;
  treeSlopeMin:     number;
  treeRidgeMin:     number;
  treeNoiseFreq:    number;
  treeNoisePow:     number;
  treeDensity:      number;
  treeBumpStrength: number;
  treeBumpFreq:     number;
}

export function createTreeUniforms(s: TreeUniformState): Record<string, THREE.IUniform> {
  return {
    uTreeEnabled:      { value: s.treeEnabled ? 1 : 0 },
    uTreeElevMax:      { value: s.treeElevMax },
    uTreeElevMin:      { value: s.treeElevMin },
    uTreeSlopeMin:     { value: s.treeSlopeMin },
    uTreeRidgeMin:     { value: s.treeRidgeMin },
    uTreeNoiseFreq:    { value: s.treeNoiseFreq },
    uTreeNoisePow:     { value: s.treeNoisePow },
    uTreeDensity:      { value: s.treeDensity },
    uTreeBumpStrength: { value: s.treeBumpStrength },
    uTreeBumpFreq:     { value: s.treeBumpFreq },
  };
}

export function syncTreeUniforms(u: Record<string, THREE.IUniform>, s: TreeUniformState): void {
  u.uTreeEnabled.value      = s.treeEnabled ? 1 : 0;
  u.uTreeElevMax.value      = s.treeElevMax;
  u.uTreeElevMin.value      = s.treeElevMin;
  u.uTreeSlopeMin.value     = s.treeSlopeMin;
  u.uTreeRidgeMin.value     = s.treeRidgeMin;
  u.uTreeNoiseFreq.value    = s.treeNoiseFreq;
  u.uTreeNoisePow.value     = s.treeNoisePow;
  u.uTreeDensity.value      = s.treeDensity;
  u.uTreeBumpStrength.value = s.treeBumpStrength;
  u.uTreeBumpFreq.value     = s.treeBumpFreq;
}
