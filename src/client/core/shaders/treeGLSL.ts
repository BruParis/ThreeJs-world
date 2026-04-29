/**
 * Tree coverage — reusable GLSL fragment.
 *
 * Exposes:
 *   float GetTreesAmount(float height, float normalY, float exposure, float ridgeMap, vec3 detailNoise)
 *
 * Returns a density value centred on zero: positive = tree-covered, negative =
 * bare ground.  Callers typically remap or clamp before use.
 *
 * Parameters:
 *   height    – normalised elevation [0, 1]
 *   normalY   – world-space Y component of the surface normal (flat = 1, cliff = 0)
 *   exposure – ambient exposure / cavity in [0, 1]  (0 = fully occluded, 1 = open sky)
 *   ridgeMap  – erosion ridge signal; negative values indicate gullies / ridges
 *   detailNoise – pre-sampled supplemental noise RGB, shared with the caller
 *   worldPos  – displaced world-space position (used for high-frequency tree noise)
 *
 * Requirements before including this snippet:
 *   GRASS_HEIGHT  must be defined (upper elevation limit for trees)
 *   WATER_HEIGHT  must be defined when the WATER flag is set
 *   Define WATER to enable the below-water suppression term.
 */
// import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';

import * as THREE from 'three';

export const TERRAIN_GRASS_HEIGHT = 0.465;

export const DEFAULT_TREE_ELEV_MAX   = TERRAIN_GRASS_HEIGHT + 0.05;  // 0.515
export const DEFAULT_TREE_ELEV_MIN   = TERRAIN_GRASS_HEIGHT + 0.01;  // 0.475
export const DEFAULT_TREE_SLOPE_MIN  = 0.95;
export const DEFAULT_TREE_RIDGE_MIN  = -1.4;
export const DEFAULT_TREE_NOISE_FREQ = 200.0;
export const DEFAULT_TREE_NOISE_POW  = 2.0;
export const DEFAULT_TREE_DENSITY    = 1.5;

export const treeGLSL = /* glsl */`

uniform int   uTreeEnabled;
uniform float uTreeElevMax;
uniform float uTreeElevMin;
uniform float uTreeSlopeMin;
uniform float uTreeRidgeMin;
uniform float uTreeNoiseFreq;
uniform float uTreeNoisePow;
uniform float uTreeDensity;

vec2 hash_tree(in vec2 x) {
    const vec2 k = vec2(0.3183099, 0.3678794);
    x = x * k + k.yx;
    return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}


// Returns gradient noise (in x) and its derivatives (in yz).
// From https://www.shadertoy.com/view/XdXBRH
vec3 noised_tree(in vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0); 
    
    vec2 ga = hash_tree(i + vec2(0.0, 0.0));
    vec2 gb = hash_tree(i + vec2(1.0, 0.0));
    vec2 gc = hash_tree(i + vec2(0.0, 1.0));
    vec2 gd = hash_tree(i + vec2(1.0, 1.0));
    
    float va = dot(ga, f - vec2(0.0, 0.0));
    float vb = dot(gb, f - vec2(1.0, 0.0));
    float vc = dot(gc, f - vec2(0.0, 1.0));
    float vd = dot(gd, f - vec2(1.0, 1.0));

    return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd),
        ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) +
        du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va));
}

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
        // Water gate: suppress trees below the water line.
        * smoothstep(
            WATER_HEIGHT + 0.000,
            WATER_HEIGHT + 0.007,
            height
        )
    ) - 0.5) / 0.6;
}

// Returns tree coverage density for the given surface.
// Takes individual fields instead of a struct — many WebGL2 drivers reject
// struct types in function parameter positions.
float ComputeTreeMap(float elevation, float ridgeMap, float normalY, vec2 worldXZ) {
    if (uTreeEnabled == 0) return 0.0;

    float treesAmount = _treesAmount(elevation, normalY, ridgeMap);

    float treeNoise = noised_tree(worldXZ * uTreeNoiseFreq).x * 0.5 + 0.5;
    return (treesAmount + 1.0 - pow(treeNoise, uTreeNoisePow) - 1.0) * uTreeDensity;
}

`;



// ── Uniform helpers ───────────────────────────────────────────────────────────

export interface TreeUniformState {
  treeEnabled:   boolean;
  treeElevMax:   number;
  treeElevMin:   number;
  treeSlopeMin:  number;
  treeRidgeMin:  number;
  treeNoiseFreq: number;
  treeNoisePow:  number;
  treeDensity:   number;
}

export function createTreeUniforms(s: TreeUniformState): Record<string, THREE.IUniform> {
  return {
    uTreeEnabled:   { value: s.treeEnabled ? 1 : 0 },
    uTreeElevMax:   { value: s.treeElevMax },
    uTreeElevMin:   { value: s.treeElevMin },
    uTreeSlopeMin:  { value: s.treeSlopeMin },
    uTreeRidgeMin:  { value: s.treeRidgeMin },
    uTreeNoiseFreq: { value: s.treeNoiseFreq },
    uTreeNoisePow:  { value: s.treeNoisePow },
    uTreeDensity:   { value: s.treeDensity },
  };
}

export function syncTreeUniforms(u: Record<string, THREE.IUniform>, s: TreeUniformState): void {
  u.uTreeEnabled.value   = s.treeEnabled ? 1 : 0;
  u.uTreeElevMax.value   = s.treeElevMax;
  u.uTreeElevMin.value   = s.treeElevMin;
  u.uTreeSlopeMin.value  = s.treeSlopeMin;
  u.uTreeRidgeMin.value  = s.treeRidgeMin;
  u.uTreeNoiseFreq.value = s.treeNoiseFreq;
  u.uTreeNoisePow.value  = s.treeNoisePow;
  u.uTreeDensity.value   = s.treeDensity;
}
