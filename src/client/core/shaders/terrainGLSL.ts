/**
 * Terrain elevation layer — coordinates the noise-to-elevation pipeline.
 *
 * Currently wraps two steps:
 *   1. Range normalisation: raw noise [-1, 1] → elevation [0, 1]
 *   2. Optional hydraulic erosion
 *
 * Designed as a central coordination point; colour, sedimentation, and other
 * terrain passes can be added here as the pipeline grows.
 *
 * Requires: applyErosion() from erosionGLSL to be in scope.
 *
 * Exposes:
 *   float applyTerrain(p, rawNoise, rawSlope, erosionEnabled, <erosion params>)
 *     p          – world XZ position
 *     rawNoise   – blended noise value in [-1, 1]
 *     rawSlope   – finite-difference gradient of rawNoise in the same [-1, 1] scale
 *     Returns elevation in [0, 1].
 */
export const terrainGLSL = /* glsl */`

float applyTerrain(
  vec2  p,
  float rawNoise,
  vec2  rawSlope,
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
  out float ridgeOut
) {
  ridgeOut = 0.0;

  // Step 1: normalise [-1, 1] → [0, 1].
  float elev = rawNoise * 0.5 + 0.5;

  // Step 2: hydraulic erosion (optional).
  // rawSlope is the gradient in [-1, 1] space; divide by 2 to match the [0, 1] elevation scale.
  if (erosionEnabled == 1) {
    elev += applyErosion(
      p, elev, rawSlope * 0.5,
      erosionOctaves, erosionScale, erosionStrength,
      erosionGullyWeight, erosionDetail, erosionLacunarity,
      erosionGain, erosionCellScale, erosionNormalization,
      erosionRidgeRounding, erosionCreaseRounding,
      ridgeOut
    );
    elev = clamp(elev, 0.0, 1.0);
  }

  return elev;
}

`;
