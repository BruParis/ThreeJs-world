/**
 * Terrain noise routing — world XZ → elevation + ridgeMap.
 *
 * Exposes:
 *   float baseNoise(vec3 wPos)
 *     Raw noise in [-1, 1] for the active noise type.
 *
 *   void computeElevation(vec3 wPos, out float outElev, out float outRidge)
 *     Full pipeline: baseNoise → applyTerrain (with optional erosion).
 *
 *   float displNorm(vec3 wPos)
 *     Elevation normalised to displacement space (sea level removed),
 *     used for finite-difference gradient baking in the compute pass.
 *
 * Note: TerrainSample is NOT used as a function parameter type — many WebGL2
 * drivers reject struct types in parameter positions. Callers assemble the
 * struct from the out values after calling computeElevation.
 *
 * Requires in scope:
 *   TerrainSample struct    — from terrainSampleGLSL
 *   simplexFbm, perlinFbm   — from simplexGLSL, perlinGLSL
 *   FractalNoise            — from fractalNoiseGLSL
 *   heightmapElevation      — from heightmapGLSL
 *   applyTerrain            — from terrainGLSL
 *
 * Uniforms referenced (declared in the compute pass before this include):
 *   uNoiseType, uNoiseScale, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity
 *   uGaussSigma, uGaussAmplitude, uPatchHalfSize
 *   uFractalAmp, uFractalFreq, uFractalOctaves, uFractalLacunarity, uFractalGain
 *   uErosionEnabled + all uErosion* params
 */

export const terrainNoiseGLSL = /* glsl */`

const float TERRAIN_SEA_LEVEL = 0.35;

// ── Noise type routing ────────────────────────────────────────────────────────

float _noiseFbm(vec3 p) {
  if (uNoiseType == 1) return perlinFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
  return simplexFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
}

float _gaussian2D(vec3 wPos) {
  float sigma = max(uGaussSigma * uPatchHalfSize, 0.001);
  return uGaussAmplitude * exp(-(wPos.x * wPos.x + wPos.z * wPos.z) / (2.0 * sigma * sigma));
}

// Returns raw noise in [-1, 1] for the active noise type.
float baseNoise(vec3 wPos) {
  if (uNoiseType == 3) return _gaussian2D(wPos) * 2.0 - 1.0;
  if (uNoiseType == 4) return uFractalAmp * FractalNoise(wPos.xz, uFractalFreq, uFractalOctaves, uFractalLacunarity, uFractalGain).x;
  return _noiseFbm(wPos * uNoiseScale);
}

// ── Pipeline: xz → elevation + ridgeMap + erosionDepth ───────────────────────

void computeElevation(vec3 wPos, out float outElev, out float outRidge, out float outErosionDepth) {
  outElev         = 0.0;
  outRidge        = 0.0;
  outErosionDepth = 0.0;

  if (uNoiseType == 2) {
    outElev = clamp(heightmapElevation(wPos.xz).x, 0.0, 1.0);
    return;
  }

  float rawN = baseNoise(wPos);
  vec2  rawSlope = vec2(0.0);
  if (uErosionEnabled == 1) {
    float GE = 0.5 / max(uNoiseScale, 0.5);
    float fL = baseNoise(wPos - vec3(GE, 0.0, 0.0));
    float fR = baseNoise(wPos + vec3(GE, 0.0, 0.0));
    float fD = baseNoise(wPos - vec3(0.0, 0.0, GE));
    float fU = baseNoise(wPos + vec3(0.0, 0.0, GE));
    rawSlope = vec2(fR - fL, fU - fD) / (2.0 * GE);
  }

  applyTerrain(
    wPos.xz, rawN, rawSlope, uErosionEnabled,
    uErosionOctaves, uErosionScale, uErosionStrength,
    uErosionGullyWeight, uErosionDetail, uErosionLacunarity,
    uErosionGain, uErosionCellScale, uErosionNormalization,
    uErosionRidgeRounding, uErosionCreaseRounding,
    outElev, outRidge, outErosionDepth
  );
}

// Elevation normalised to displacement space — no sea-level clamp so that
// underwater slopes are preserved. Used for finite-difference gradient baking.
float displNorm(vec3 wPos) {
  float e, _r, _ed;
  computeElevation(wPos, e, _r, _ed);
  return (e - TERRAIN_SEA_LEVEL) / (1.0 - TERRAIN_SEA_LEVEL);
}

`;
