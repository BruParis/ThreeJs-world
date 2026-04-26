/**
 * Terrain coloring — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal,
 *                    float ridgeMap, vec3 detailNoise)
 *
 * Computes a slope-aware terrain color from a normalised elevation value [0, 1],
 * the displaced world position (used for breakup noise), a pre-computed smooth
 * surface normal, an erosion ridge signal, and the pre-sampled supplemental
 * noise data (RGB from the detailNoise texture — sampled once by the caller and
 * passed through so all layers share the same value).
 *
 * Biome stack (bottom → top):
 *   ocean floor  →  sand  →  cliff (base)  →  dirt (moderate slopes)  →  grass (flat terrain)  →  cliff override (steep)  →  snow
 *
 * Must be included in a GLSL 3 fragment shader that already has simplexNoiseGLSL
 * (i.e. snoise and simplexFbm) available in scope.
 *
 * Constant WATER_HEIGHT (0.35) is the sea-level threshold and must match the
 * value used in the vertex shader (TERRAIN_SEA).
 *
 * Colors are exposed as uniforms (uCliffColor, uDirtColor, uGrassColor1/2,
 * uTreeColor, uWaterColor, uWaterShoreColor) so they can be tweaked at runtime
 * without recompiling the shader. Use createTerrainColorUniforms /
 * syncTerrainColorUniforms to manage them from TypeScript.
 */

import * as THREE from 'three';
import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';
import { shaderUtilsGLSL } from '@core/shaders/shaderUtilsGLSL';
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
}

export const DEFAULT_TERRAIN_COLORS: TerrainColorState = {
  cliffColor:      DEFAULT_CLIFF_COLOR,
  dirtColor:       DEFAULT_DIRT_COLOR,
  grassColor1:     DEFAULT_GRASS_COLOR1,
  grassColor2:     DEFAULT_GRASS_COLOR2,
  treeColor:       DEFAULT_TREE_COLOR,
  waterColor:      DEFAULT_WATER_COLOR,
  waterShoreColor: DEFAULT_WATER_SHORE_COLOR,
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
}

// ── GLSL source ───────────────────────────────────────────────────────────────

export const terrainColorGLSL = /* glsl */`

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

${treeGLSL}

vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal, float ridgeMap, vec3 detailNoise) {
  elevation = clamp(elevation, 0.0, 1.0);

  float breakup = detailNoise.x;

  float occlusion = 1.0;
  float erosion = 0.0;

  // ── Water color (shore + foam) ─────────────────────────────────────────────
  // diff clamped ≥ 0 so exp() stays safe even when e > WATER_HEIGHT.
  float diff  = max(0.0, WATER_HEIGHT - elevation);
  float shore = normal.y > 1e-2 ? exp(-diff * 60.0) : 0.0;
  float foam  = normal.y > 1e-2 ? smoothstep(0.005, 0.0, diff + breakup * 0.005) : 0.0;
  vec3 waterColor = mix(uWaterColor, uWaterShoreColor, shore);
  waterColor = mix(waterColor, vec3(1.0), foam);

  // ── Slope helpers ──────────────────────────────────────────────────────────
  // normal.y ≈ 1 = flat ground, ≈ 0 = vertical cliff face.
  float slopeCliff = smoothstep(0.65, 0.45, normal.y); // 1 on steep, 0 on flat
  // slopeFlatness: 1 = flat, 0 = cliff. Squared so suppression kicks in hard
  // even when smooth normals keep normal.y above zero on steep faces.
  float slopeFlatness = smoothstep(0.5, 0.80, normal.y);
  slopeFlatness *= slopeFlatness;

  // ── Tree coverage ──────────────────────────────────────────────────────────
  float trees = ComputeTreeMap(elevation, normal.y, occlusion, ridgeMap, worldPos);

  // ── Land color ─────────────────────────────────────────────────────────────
  vec3 landColor = vec3(0.0);

  // Base: bare cliff — fallback for anything steep or uncovered.
  landColor = uCliffColor * smoothstep(0.4, 0.52, elevation);
  landColor = mix(landColor, uDirtColor, smoothstep(0.6, 0.0, occlusion + breakup * 1.5));

  // Snow
  landColor = mix(landColor, vec3(1.0), smoothstep(0.53, 0.6, elevation + breakup * 0.1));

  // Grass
  // vec3 grassMix = mix(uGrassColor1, uGrassColor2, smoothstep(0.4, 0.6, elevation - erosion * 0.05 + breakup * 0.3));
  // landColor = mix(landColor, grassMix,
  //   smoothstep(GRASS_HEIGHT + 0.05, GRASS_HEIGHT + 0.02, elevation + 0.01 + (occlusion - 0.8) * 0.05 - breakup * 0.02)
  //   * smoothstep(0.8, 1.0, 1.0 - (1.0 - normal.y) * (1.0 - trees) + breakup * 0.1));

  // ── Tree color ─────────────────────────────────────────────────────────────
  // vec3 treeColor = mix(uTreeColor, uTreeColor2, treeNoise);
  landColor = mix(landColor, uTreeColor * pow(trees, 8.0), clamp01(trees * 2.2 - 0.8) * 0.6);

  landColor *= 1.0 + breakup * 0.5;

  // ── Shoreline blend: smooth gradient between water and land ────────────────
  // Blend width shrinks from 0.01 (flat) to 0.001 (cliff).
  float blendHalf = mix(0.001, 0.01, slopeFlatness);
  float waterFactor = 1.0 - smoothstep(WATER_HEIGHT - blendHalf, WATER_HEIGHT + blendHalf, elevation);

  return clamp(mix(landColor, waterColor, waterFactor), 0.0, 1.0);
}

`;
