/**
 * Terrain noise routing — 3D position → elevation + ridgeMap.
 *
 * Every function takes a 3D position P in terrain units (a point on the planet)
 * and the unit vector `up` normal to the undisplaced surface at P.  Sampling the
 * noise in 3D makes the terrain continuous over the whole sphere and independent
 * of the patch grid it is baked on.
 *
 * Exposes:
 *   float baseNoise(vec3 P)
 *     Raw noise in [-1, 1] for the active noise type.
 *
 *   void baseNoiseAndSlope(vec3 P, vec3 up, bool needSlope,
 *                          out float rawN, out vec3 slope)
 *     Raw noise plus its surface gradient (tangent vec3, per terrain unit).
 *
 *   void computeElevation(vec3 P, vec3 up,
 *                         out float outElev, out float outRidge, out float outErosionDepth)
 *     Full pipeline: baseNoise → applyTerrain (with optional erosion).
 *
 *   float displNorm(vec3 P, vec3 up)
 *     Elevation only — used for finite-difference gradient baking.
 *
 * Note: TerrainSample is NOT used as a function parameter type — many WebGL2
 * drivers reject struct types in parameter positions.
 *
 * Requires in scope:
 *   terrainTangentBasis            — from terrainSampleGLSL
 *   snoise, perlinNoise            — from simplexGLSL, perlinGLSL
 *   FractalNoise3, terrainBandWeight — from fractalNoise3GLSL
 *   applyTerrain                   — from terrainGLSL
 *
 * Uniforms referenced (declared in the compute pass before this include):
 *   uNoiseType, uNoiseScale, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity
 *   uGaussCenter, uGaussSigma, uGaussAmplitude
 *   uFractalAmp, uFractalFreq, uFractalOctaves, uFractalLacunarity, uFractalGain
 *   uErosionEnabled + all uErosion* params
 *   uBandTexel   — grid spacing used to fade unresolved octaves (0 = no fading)
 */

export const terrainNoiseGLSL = /* glsl */`

// ── Noise type routing ────────────────────────────────────────────────────────

// Band-limited FBM over simplex (type 0) or Perlin (type 1) noise.  Output in [-1, 1].
float _noiseFbm(vec3 P) {
  float total  = 0.0;
  float amp    = 1.0;
  float freq   = uNoiseScale;
  float maxVal = 0.0;
  for (int i = 0; i < uNoiseOctaves; i++) {
    float w = terrainBandWeight(1.0 / freq, uBandTexel);
    if (w > 0.0) {
      vec3 q = P * freq;
      float n = 0.0;
      if (uNoiseType == 1) n = perlinNoise(q.x, q.y, q.z);
      else                 n = snoise(q);
      total += n * amp * w;
    }
    maxVal += amp;
    amp    *= uNoisePersistence;
    freq   *= uNoiseLacunarity;
  }
  return total / max(maxVal, 1e-6);
}

// Gaussian bump centred on uGaussCenter (terrain units), sigma in terrain units.
float _gaussian3D(vec3 P) {
  vec3  d     = P - uGaussCenter;
  float sigma = max(uGaussSigma, 0.001);
  return uGaussAmplitude * exp(-dot(d, d) / (2.0 * sigma * sigma));
}

// Returns raw noise in [-1, 1] for the active noise type.
float baseNoise(vec3 P) {
  if (uNoiseType == 3) return _gaussian3D(P) * 2.0 - 1.0;
  if (uNoiseType == 4) return uFractalAmp * FractalNoise3(P, uFractalFreq, uFractalOctaves, uFractalLacunarity, uFractalGain, uBandTexel).x;
  return _noiseFbm(P);
}

// Raw noise and its surface gradient.  The gradient is only computed when
// needSlope is true (it costs four extra noise evaluations for the noise
// types that have no analytic derivative).
void baseNoiseAndSlope(vec3 P, vec3 up, bool needSlope, out float rawN, out vec3 slope) {
  slope = vec3(0.0);

  if (uNoiseType == 4) {
    // FractalNoise3 tracks its derivative analytically.
    vec4 n = uFractalAmp * FractalNoise3(P, uFractalFreq, uFractalOctaves, uFractalLacunarity, uFractalGain, uBandTexel);
    rawN  = n.x;
    slope = n.yzw - up * dot(n.yzw, up);
    return;
  }

  rawN = baseNoise(P);
  if (!needSlope) return;

  vec3 t1, t2;
  terrainTangentBasis(up, t1, t2);
  float GE = 0.5 / max(uNoiseScale, 0.5);
  float fL = baseNoise(P - t1 * GE);
  float fR = baseNoise(P + t1 * GE);
  float fD = baseNoise(P - t2 * GE);
  float fU = baseNoise(P + t2 * GE);
  slope = (t1 * (fR - fL) + t2 * (fU - fD)) / (2.0 * GE);
}

// ── Pipeline: position → elevation + ridgeMap + erosionDepth ─────────────────

void computeElevation(vec3 P, vec3 up, out float outElev, out float outRidge, out float outErosionDepth) {
  outElev         = 0.0;
  outRidge        = 0.0;
  outErosionDepth = 0.0;

  float rawN;
  vec3  rawSlope;
  baseNoiseAndSlope(P, up, uErosionEnabled == 1, rawN, rawSlope);

  // Compute fadeTarget normalised to [-1, 1], matching the shadertoy's
  //   clamp(n.x / (HEIGHT_AMP * 0.6), -1, 1)
  // For fractal noise, rawN = uFractalAmp * FractalNoise3.x is much smaller than 1,
  // so a plain clamp(rawN, -1, 1) leaves fadeTarget near 0 everywhere — the erosion
  // filter cannot distinguish peaks from valleys, breaking the drainage pattern.
  float fadeTarget;
  if (uNoiseType == 4) {
    fadeTarget = clamp(rawN / max(uFractalAmp * 0.6, 1e-6), -1.0, 1.0);
  } else {
    fadeTarget = clamp(rawN, -1.0, 1.0);
  }

  applyTerrain(
    P, up, rawN, rawSlope, fadeTarget, uErosionEnabled,
    uErosionOctaves, uErosionScale, uErosionStrength,
    uErosionGullyWeight, uErosionDetail, uErosionLacunarity,
    uErosionGain, uErosionCellScale, uErosionNormalization,
    uErosionRidgeRounding, uErosionCreaseRounding,
    uBandTexel,
    outElev, outRidge, outErosionDepth
  );
}

// Elevation only.  uElevOffset is a render-time uniform not available here, so the
// compute pass bakes gradients at offset = 0; the offset is a uniform shift that
// does not change the gradient.
float displNorm(vec3 P, vec3 up) {
  float e, _r, _ed;
  computeElevation(P, up, e, _r, _ed);
  return e;
}

`;
