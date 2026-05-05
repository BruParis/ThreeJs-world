/**
 * Terrain classification — reusable GLSL fragment.
 *
 * Exposes:
 *   struct TerrainClassification
 *   TerrainClassification classifyTerrain(float elevation, float ridgeMap,
 *                                         float normalY, vec2 worldXZ)
 *
 * Called from the elevation compute pass (terrainNoiseGLSL) — NOT from the
 * color/fragment shader.  Results are baked into the attribute texture and
 * read back by the fragment shader without recomputing.
 *
 * Requires in scope (concatenated before this string):
 *   ComputeTreeMap — from treeGLSL
 *   clamp01        — from shaderUtilsGLSL
 *   GRASS_HEIGHT   — #define set by the including shader
 *   uSeaLevel      — uniform float
 */

export const terrainClassificationGLSL = /* glsl */`

// Terrain classification — populated from the vertex normal and the tree
// density baked during the elevation compute pass.
//
// Fields:
//   trees    float  continuous tree density (pre-computed, passed in)
//   hardness float  [0, 1] — 0 = soft (grass/tree), 1 = hard (rock/cliff/snow)
//                   smooth signal for normal-perturbation weight; avoids the
//                   sharp edge that boolean gating produces at type boundaries
//   isWater  bool   elevation below sea level
//   isGrass  bool   grass zone: low elevation, flat surface, no tree cover
//   isTree   bool   tree cover above density threshold
//
// Priority order: water > tree > grass > rock.
struct TerrainClassification {
  float trees;
  float hardness;
  bool  isWater;
  bool  isGrass;
  bool  isTree;
};

TerrainClassification classifyTerrain(float elevation, float ridgeMap, float normalY, vec2 worldXZ) {
  TerrainClassification tc;
  tc.trees   = ComputeTreeMap(elevation, ridgeMap, normalY, worldXZ);
  tc.isWater = elevation < uSeaLevel;
  tc.isTree  = !tc.isWater && tc.trees > 0.36;
  tc.isGrass = !tc.isWater && !tc.isTree
             && elevation < GRASS_HEIGHT + 0.04
             && normalY   > 0.85;

  // Smooth version of the rock/soft boundary — mirrors the transition bands
  // used in terrainColor() so the fade-out is invisible against the color blend.
  float grassSmooth = smoothstep(GRASS_HEIGHT + 0.05, GRASS_HEIGHT + 0.02, elevation)
                    * smoothstep(0.80, 1.0, normalY);
  float treeSmooth  = clamp01(tc.trees * 2.2 - 0.8);
  tc.hardness = 1.0 - clamp01(grassSmooth + treeSmooth);
  return tc;
}

`;
