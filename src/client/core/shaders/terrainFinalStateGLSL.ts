/**
 * terrainFinalStateGLSL — pipeline entry point.
 *
 * Composes the two downstream terrain stages:
 *   1. terrainClassificationGLSL  — domain state: isWater, isGrass, isTree, trees, hardness
 *   2. terrainColorGLSL           — visual output: terrainColor(), waterColor(), computeWaterNormal()
 *
 * Classification depends on symbols (uSeaLevel, GRASS_HEIGHT, ComputeTreeMap, clamp01)
 * that are part of the terrainColorGLSL preamble, so the two stages are composed
 * internally in the correct order. terrainFinalStateGLSL is the single entry point
 * for consumers — neither sub-module should be embedded directly.
 */

export { terrainColorGLSL as terrainFinalStateGLSL } from '@core/shaders/terrainColorGLSL';
