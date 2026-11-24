/**
 * Terrain coloring — TypeScript side: default palette and color uniforms.
 *
 * The GLSL is in terrainColor.glsl (color functions, classification) and
 * terrainMaterial.frag.glsl (the per-fragment terrain stages).
 */

import * as THREE from 'three';

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
