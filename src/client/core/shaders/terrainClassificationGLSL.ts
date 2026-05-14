/**
 * Terrain classification — reusable GLSL fragment.
 *
 * Exposes:
 *   struct TerrainClassification
 *   TerrainClassification classifyTerrain(float elevation, float ridgeMap,
 *                                         float normalY, vec2 worldXZ)
 *
 * Called once per fragment in the dynamic pass. All classification —
 * isWater, isGrass, isTree, trees, hardness — is computed here and nowhere else.
 *
 * Requires in scope:
 *   ComputeTreeMap — from treeGLSL
 *   clamp01        — from shaderUtilsGLSL
 *   GRASS_HEIGHT   — #define
 *   uSeaLevel      — uniform float
 */

export const terrainClassificationGLSL = /* glsl */`

struct TerrainClassification {
  float trees;
  float hardness;
  bool  isWater;
  bool  isGrass;
  bool  isTree;
};

TerrainClassification classifyTerrain(float elevation, float ridgeMap, float normalY, vec2 worldXZ) {
  TerrainClassification tc;
  tc.isWater = elevation < uSeaLevel;

  bool grassZone = !tc.isWater
                 && elevation < GRASS_HEIGHT + 0.04
                 && normalY   > 0.85;

  tc.trees   = ComputeTreeMap(elevation, ridgeMap, normalY, worldXZ, tc.isWater, grassZone);
  tc.isTree  = !tc.isWater && tc.trees > 0.36;
  tc.isGrass = grassZone && !tc.isTree;

  float grassSmooth = smoothstep(GRASS_HEIGHT + 0.05, GRASS_HEIGHT + 0.02, elevation)
                    * smoothstep(0.80, 1.0, normalY);
  float treeSmooth  = clamp01(tc.trees * 2.2 - 0.8);
  tc.hardness = 1.0 - clamp01(grassSmooth + treeSmooth);
  return tc;
}

`;
