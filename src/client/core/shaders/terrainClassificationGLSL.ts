/**
 * Terrain classification — reusable GLSL fragment.
 *
 * Exposes:
 *   struct TerrainClassification
 *   TerrainClassification classifyTerrain(float elevation, float ridgeMap,
 *                                         float normalY, vec3 P, float treeNoiseFade)
 *
 * Called once per fragment in the rendering pass.
 * The tree density compute pass (treeDensityComputeGLSL) also classifies isWater
 * and grassZone independently to bake per-texel density into uTreeDensityTex.
 *
 * Requires in scope:
 *   ComputeTreeMap — from treeGLSL
 *   clamp01        — from shaderUtilsGLSL
 *   GRASS_HEIGHT   — #define
 *   uSeaLevel      — uniform float
 */

import terrainClassificationGLSLSource from './terrainClassification.glsl';

/** GLSL source: terrainClassification.glsl (flattened). */
export const terrainClassificationGLSL = terrainClassificationGLSLSource;
