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

import treeGLSLSource from './tree.glsl';
import * as THREE from 'three';

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

/** GLSL source: tree.glsl (flattened). */
export const treeGLSL = treeGLSLSource;



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
