/**
 * Erosion filter on a 3D domain — self-contained GLSL fragment.
 *
 * 3D counterpart of erosionGLSL.  The filter is evaluated at a 3D position
 * (a point on the planet, in terrain units) so that gullies are continuous
 * over the whole sphere, whatever patch grid they are sampled on.
 *
 * Differences with the 2D filter:
 *   - positions and slopes are vec3; slopes are tangent to the surface,
 *   - Phacelle cells live on a 3D lattice (4x4x4 neighbourhood),
 *   - the stripe direction is cross(slopeDir, up) instead of a 2D rotation,
 *   - octaves finer than the sampling grid are faded out (texelSize).
 *
 * Exposes:
 *   float applyErosion3(p, up, noise, slope, fadeTarget, octaves, scale, strength,
 *                       gullyWeight, detail, lacunarity, gain,
 *                       cellScale, normalization, ridgeRounding, creaseRounding,
 *                       texelSize, out ridgeOut, out erosionDepth)
 *
 * Returns the height delta to add to the base elevation.
 * Requires hash33 / terrainBandWeight (fractalNoise3GLSL) in scope.
 */

// ── TypeScript defaults ────────────────────────────────────────────────────────

export const DEFAULT_EROSION_OCTAVES          = 5;
export const DEFAULT_EROSION_SCALE            = 0.15;
export const DEFAULT_EROSION_STRENGTH         = 0.22;
export const DEFAULT_EROSION_GULLY_WEIGHT     = 0.5;
export const DEFAULT_EROSION_DETAIL           = 1.5;
export const DEFAULT_EROSION_LACUNARITY       = 2.0;
export const DEFAULT_EROSION_GAIN             = 0.5;
export const DEFAULT_EROSION_CELL_SCALE       = 0.7;
export const DEFAULT_EROSION_NORMALIZATION    = 0.5;
export const DEFAULT_EROSION_RIDGE_ROUNDING   = 0.1;
export const DEFAULT_EROSION_CREASE_ROUNDING  = 0.0;

// ── GLSL source ───────────────────────────────────────────────────────────────

export const erosion3GLSL = /* glsl */`

#ifndef TAU
#define TAU 6.28318530717959
#endif

#ifndef clamp01
#define clamp01(t) clamp(t, 0.0, 1.0)
#endif

// Phacelle Noise — produces a stripe pattern whose stripes run along normDir.
// Returns vec2(cosWave, sinWave); sideDir receives the stripe phase gradient.
// Adapted to a 3D lattice from Phacelle Noise,
// Copyright (c) 2025 Rune Skovbo Johansen — MPL 2.0
vec2 erosion3_PhacelleNoise(in vec3 p, vec3 normDir, vec3 up, float freq, float offset,
                            float normalization, out vec3 sideDir) {
  sideDir = cross(normDir, up) * freq * TAU;
  offset *= TAU;

  vec3 pInt  = floor(p);
  vec3 pFrac = fract(p);
  vec2 phaseDir   = vec2(0.0);
  float weightSum = 0.0;

  for (int i = -1; i <= 2; i++) {
    for (int j = -1; j <= 2; j++) {
      for (int k = -1; k <= 2; k++) {
        vec3 gridOffset   = vec3(float(i), float(j), float(k));
        vec3 randomOffset = hash33(pInt + gridOffset) * 0.5;
        vec3 vectorFromCellPoint = pFrac - gridOffset - randomOffset;

        float sqrDist = dot(vectorFromCellPoint, vectorFromCellPoint);
        float weight  = max(0.0, exp(-sqrDist * 2.0) - 0.01111);
        weightSum += weight;

        float waveInput = dot(vectorFromCellPoint, sideDir) + offset;
        phaseDir += vec2(cos(waveInput), sin(waveInput)) * weight;
      }
    }
  }

  vec2 interpolated = phaseDir / max(weightSum, 1e-6);
  float magnitude   = sqrt(dot(interpolated, interpolated));
  magnitude = max(1.0 - normalization, magnitude);
  return interpolated / max(magnitude, 1e-6);
}

// ── Utility functions ────────────────────────────────────────────────────────

float erosion3_pow_inv(float t, float power) {
  return 1.0 - pow(1.0 - clamp01(t), power);
}

float erosion3_ease_out(float t) {
  float v = 1.0 - clamp01(t);
  return 1.0 - v * v;
}

float erosion3_smooth_start(float t, float smoothing) {
  if (t >= smoothing) return t - 0.5 * smoothing;
  return 0.5 * t * t / max(smoothing, 1e-6);
}

// ── ErosionFilter ─────────────────────────────────────────────────────────────
// Adapted from the Advanced Terrain Erosion Filter,
// Copyright (c) 2025 Rune Skovbo Johansen — MPL 2.0
//
// Returns vec2(height delta, accumulated octave magnitude).

vec2 erosion3_ErosionFilter(
  in vec3 p, vec3 up, vec3 slope, float fadeTarget,
  float strength, float gullyWeight, float detail, vec4 rounding, vec4 onset, vec2 assumedSlope,
  float scale, int octaves, float lacunarity,
  float gain, float cellScale, float normalization, float texelSize,
  out float ridgeMap
) {
  strength *= scale;
  fadeTarget = clamp(fadeTarget, -1.0, 1.0);

  float freq        = 1.0 / (scale * cellScale);
  float wavelength  = scale;                       // stripe period of the current octave
  float slopeLength = max(length(slope), 1e-10);
  float heightDelta = 0.0;
  float magnitude   = 0.0;
  float roundingMult = 1.0;

  float roundingForInput = mix(rounding.y, rounding.x, clamp01(fadeTarget + 0.5)) * rounding.z;
  float combiMask = erosion3_ease_out(erosion3_smooth_start(slopeLength * onset.x, roundingForInput * onset.x));

  float ridgeMapCombiMask  = erosion3_ease_out(slopeLength * onset.z);
  float ridgeMapFadeTarget = fadeTarget;

  vec3 gullySlope = mix(slope, slope / slopeLength * assumedSlope.x, assumedSlope.y);

  for (int i = 0; i < octaves; i++) {
    // Octaves whose stripes are finer than the sampling grid are faded out;
    // their mean contribution (the fade target) is kept so that the average
    // height does not depend on the level of detail.
    float band = terrainBandWeight(wavelength, texelSize);

    // Keep the gully direction tangent to the surface, then normalise it.
    vec3  gullyTangent = gullySlope - up * dot(gullySlope, up);
    float gullyLen     = length(gullyTangent);
    vec3  gullyDir     = (gullyLen > 1e-10) ? gullyTangent / gullyLen : gullyTangent;

    if (band > 0.0) {
      vec3 sideDir;
      vec2 phacelle = erosion3_PhacelleNoise(p * freq, gullyDir, up, cellScale, 0.25, normalization, sideDir);
      // Multiply with freq since p was multiplied with freq.
      // Negate since we use slope directions that point down.
      sideDir *= -freq;

      // Amount of slope as value from 0 to 1.
      float sloping = abs(phacelle.y);

      // Add non-masked, normalized slope to gullySlope, for use by subsequent octaves.
      gullySlope += sign(phacelle.y) * sideDir * strength * gullyWeight * band;

      // Gullies have a height offset from -1 to 1.
      float gullies = phacelle.x * band;
      // Fade gullies towards fadeTarget based on combiMask.
      float fadedGullies = mix(fadeTarget, gullies * gullyWeight, combiMask);
      heightDelta += fadedGullies * strength;
      fadeTarget   = fadedGullies;

      float roundingForOctave = mix(rounding.y, rounding.x, clamp01(phacelle.x + 0.5)) * roundingMult;
      float newMask = erosion3_ease_out(erosion3_smooth_start(sloping * onset.y, roundingForOctave * onset.y));
      combiMask = erosion3_pow_inv(combiMask, detail) * newMask;

      ridgeMapFadeTarget = mix(ridgeMapFadeTarget, phacelle.x, ridgeMapCombiMask * band);
      float newRidgeMapMask = erosion3_ease_out(sloping * onset.w);
      ridgeMapCombiMask = ridgeMapCombiMask * mix(1.0, newRidgeMapMask, band);
    } else {
      // Unresolved octave: gullies average to zero, only the fade target remains.
      float fadedGullies = mix(fadeTarget, 0.0, combiMask);
      heightDelta += fadedGullies * strength;
      fadeTarget   = fadedGullies;
    }
    magnitude += strength;

    strength   *= gain;
    freq       *= lacunarity;
    wavelength /= lacunarity;
    roundingMult *= rounding.w;
  }

  ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);

  return vec2(heightDelta, magnitude);
}

// ── applyErosion3 wrapper ────────────────────────────────────────────────────
// p              – 3D position, terrain units
// up             – unit surface normal of the undisplaced surface at p
// noise          – base elevation in [0, 1]
// slope          – surface gradient of the base elevation (tangent vec3, per terrain unit)
// texelSize      – grid spacing the result is sampled on (terrain units); <= 0 disables fading
// Returns the height delta to add to noise (before clamping).

float applyErosion3(
  vec3  p,
  vec3  up,
  float noise,
  vec3  slope,
  float fadeTarget,
  int   octaves,
  float scale,
  float strength,
  float gullyWeight,
  float detail,
  float lacunarity,
  float gain,
  float cellScale,
  float normalization,
  float ridgeRounding,
  float creaseRounding,
  float texelSize,
  out float ridgeOut,
  out float erosionDepth
) {
  vec4 rounding     = vec4(ridgeRounding, creaseRounding, 0.1, 2.0);
  vec4 onset        = vec4(1.25, 1.25, 2.8, 1.5);
  vec2 assumedSlope = vec2(0.7, 1.0);

  float ridgeMap;
  vec2 h = erosion3_ErosionFilter(
    p, up, slope, fadeTarget,
    strength, gullyWeight, detail,
    rounding, onset, assumedSlope,
    scale, octaves, lacunarity,
    gain, cellScale, normalization, texelSize,
    ridgeMap
  );

  ridgeOut = ridgeMap;

  // Normalised erosion depth: how much erosion raised or lowered this point
  // relative to the total accumulated octave magnitude.
  // Range [-1, 1]: negative in eroded gullies, positive on deposited ridges.
  erosionDepth = (h.y > 0.0) ? clamp(h.x / h.y, -1.0, 1.0) : 0.0;

  // Height offset: pull terrain down slightly by a fixed -0.65 bias.
  float offset = -0.65 * h.y;
  return h.x + offset;
}

`;
