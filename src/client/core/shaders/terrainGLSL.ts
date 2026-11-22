/**
 * Terrain elevation layer — coordinates the noise-to-elevation pipeline.
 *
 * Steps:
 *   1. Range normalisation: raw noise [-1, 1] → elevation [0, 1]
 *   2. Optional hydraulic erosion (applyErosion3 from erosion3GLSL)
 *
 * Exposes:
 *   void applyTerrain(p, up, rawNoise, rawSlope, fadeTarget, erosion params…,
 *                     texelSize, out outElev, out outRidge, out outErosionDepth)
 *
 * The position p is 3D (a point on the planet, in terrain units) and rawSlope is
 * the surface gradient of rawNoise at p (a vec3 tangent to the surface).
 *
 * Note: TerrainSample is NOT used as a function parameter type — many WebGL2
 * drivers reject struct types in `in`/`out`/`inout` parameter positions.
 * Callers assemble the struct from the out values after the call.
 *
 * Requires in scope:
 *   applyErosion3() — from erosion3GLSL
 */
export const terrainGLSL = /* glsl */`

void applyTerrain(
  vec3  p,
  vec3  up,
  float rawNoise,
  vec3  rawSlope,
  float fadeTarget,
  int   erosionEnabled,
  int   erosionOctaves,
  float erosionScale,
  float erosionStrength,
  float erosionGullyWeight,
  float erosionDetail,
  float erosionLacunarity,
  float erosionGain,
  float erosionCellScale,
  float erosionNormalization,
  float erosionRidgeRounding,
  float erosionCreaseRounding,
  float texelSize,
  out float outElev,
  out float outRidge,
  out float outErosionDepth
) {
  outRidge        = 0.0;
  outErosionDepth = 0.0;

  // Step 1: normalise [-1, 1] → [0, 1].
  float elev = rawNoise * 0.5 + 0.5;

  // Step 2: hydraulic erosion (optional).
  // rawSlope is in [-1, 1] space; divide by 2 to match [0, 1] elevation scale.
  if (erosionEnabled == 1) {
    elev += applyErosion3(
      p, up, elev, rawSlope * 0.5, fadeTarget,
      erosionOctaves, erosionScale, erosionStrength,
      erosionGullyWeight, erosionDetail, erosionLacunarity,
      erosionGain, erosionCellScale, erosionNormalization,
      erosionRidgeRounding, erosionCreaseRounding,
      texelSize,
      outRidge, outErosionDepth
    );
    elev = clamp(elev, 0.0, 1.0);
  }

  outElev = elev;
}

`;
