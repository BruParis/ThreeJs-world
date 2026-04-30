/**
 * Terrain elevation layer — coordinates the noise-to-elevation pipeline.
 *
 * Steps:
 *   1. Range normalisation: raw noise [-1, 1] → elevation [0, 1]
 *   2. Optional hydraulic erosion (applyErosion from erosionGLSL)
 *
 * Exposes:
 *   void applyTerrain(..., out float outElev, out float outRidge)
 *
 * Note: TerrainSample is NOT used as a function parameter type — many WebGL2
 * drivers reject struct types in `in`/`out`/`inout` parameter positions.
 * Callers assemble the struct from the out values after the call.
 *
 * Requires in scope:
 *   applyErosion() — from erosionGLSL
 */
export const terrainGLSL = /* glsl */`

void applyTerrain(
  vec2  p,
  float rawNoise,
  vec2  rawSlope,
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
    elev += applyErosion(
      p, elev, rawSlope * 0.5, fadeTarget,
      erosionOctaves, erosionScale, erosionStrength,
      erosionGullyWeight, erosionDetail, erosionLacunarity,
      erosionGain, erosionCellScale, erosionNormalization,
      erosionRidgeRounding, erosionCreaseRounding,
      outRidge, outErosionDepth
    );
    elev = clamp(elev, 0.0, 1.0);
  }

  outElev = elev;
}

`;
