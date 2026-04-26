/**
 * Advanced Terrain Erosion — reusable GLSL fragment.
 *
 * Based on the ErosionFilter by Rune Skovbo Johansen (MPL 2.0).
 * Uses PhacelleNoise to produce directional gullies.
 *
 * Exposes:
 *   float applyErosion(p, noise, slope, octaves, scale, strength,
 *                      gullyWeight, detail, lacunarity, gain,
 *                      cellScale, normalization, ridgeRounding, creaseRounding)
 *
 * Returns the height delta to add to the base elevation.
 * Requires no other GLSL dependencies.
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

export const erosionGLSL = /* glsl */`

#ifndef TAU
#define TAU 6.28318530717959
#endif

#ifndef clamp01
#define clamp01(t) clamp(t, 0.0, 1.0)
#endif

// 2D hash used by PhacelleNoise.
vec2 erosion_hash(in vec2 x) {
  const vec2 k = vec2(0.3183099, 0.3678794);
  x = x * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}

// Phacelle Noise — produces a stripe pattern aligned with normDir.
// Returns vec4(cosWave, sinWave, dSin/dx, dSin/dy).
// Copyright (c) 2025 Rune Skovbo Johansen — MPL 2.0
vec4 erosion_PhacelleNoise(in vec2 p, vec2 normDir, float freq, float offset, float normalization) {
  vec2 sideDir = normDir.yx * vec2(-1.0, 1.0) * freq * TAU;
  offset *= TAU;

  vec2 pInt = floor(p);
  vec2 pFrac = fract(p);
  vec2 phaseDir = vec2(0.0);
  float weightSum = 0.0;

  for (int i = -1; i <= 2; i++) {
    for (int j = -1; j <= 2; j++) {
      vec2 gridOffset = vec2(i, j);
      vec2 gridPoint  = pInt + gridOffset;
      vec2 randomOffset = erosion_hash(gridPoint) * 0.5;
      vec2 vectorFromCellPoint = pFrac - gridOffset - randomOffset;

      float sqrDist = dot(vectorFromCellPoint, vectorFromCellPoint);
      float weight  = max(0.0, exp(-sqrDist * 2.0) - 0.01111);
      weightSum += weight;

      float waveInput = dot(vectorFromCellPoint, sideDir) + offset;
      phaseDir += vec2(cos(waveInput), sin(waveInput)) * weight;
    }
  }

  vec2 interpolated = phaseDir / weightSum;
  float magnitude   = sqrt(dot(interpolated, interpolated));
  magnitude = max(1.0 - normalization, magnitude);
  return vec4(interpolated / magnitude, sideDir);
}

// ── Utility functions ────────────────────────────────────────────────────────

float erosion_pow_inv(float t, float power) {
  return 1.0 - pow(1.0 - clamp01(t), power);
}

float erosion_ease_out(float t) {
  float v = 1.0 - clamp01(t);
  return 1.0 - v * v;
}

float erosion_smooth_start(float t, float smoothing) {
  if (t >= smoothing) return t - 0.5 * smoothing;
  return 0.5 * t * t / smoothing;
}

vec2 erosion_safe_normalize(vec2 n) {
  float l = length(n);
  return (abs(l) > 1e-10) ? (n / l) : n;
}

// ── ErosionFilter ─────────────────────────────────────────────────────────────
// Advanced Terrain Erosion Filter copyright (c) 2025 Rune Skovbo Johansen — MPL 2.0

vec4 erosion_ErosionFilter(
  in vec2 p, vec3 heightAndSlope, float fadeTarget,
  float strength, float gullyWeight, float detail, vec4 rounding, vec4 onset, vec2 assumedSlope,
  float scale, int octaves, float lacunarity,
  float gain, float cellScale, float normalization,
  out float ridgeMap, out float debug
) {
  strength *= scale;
  fadeTarget = clamp(fadeTarget, -1.0, 1.0);

  vec3 inputHeightAndSlope = heightAndSlope;
  float freq        = 1.0 / (scale * cellScale);
  float slopeLength = max(length(heightAndSlope.yz), 1e-10);
  float magnitude   = 0.0;
  float roundingMult = 1.0;

  float roundingForInput = mix(rounding.y, rounding.x, clamp01(fadeTarget + 0.5)) * rounding.z;
  float combiMask = erosion_ease_out(erosion_smooth_start(slopeLength * onset.x, roundingForInput * onset.x));

  // float ridgeMapCombiMask  = erosion_ease_out(slopeLength * onset.z);
  float ridgeMapCombiMask  = erosion_ease_out(slopeLength);
  float ridgeMapFadeTarget = fadeTarget;

  vec2 gullySlope = mix(heightAndSlope.yz,
                        heightAndSlope.yz / slopeLength * assumedSlope.x,
                        assumedSlope.y);

  for (int i = 0; i < octaves; i++) {
    // Calculate and add gullies to the height and slope.
    vec4 phacelle = erosion_PhacelleNoise(p * freq, erosion_safe_normalize(gullySlope), cellScale, 0.25, normalization);
    // Multiply with freq since p was multiplied with freq.
    // Negate since we use slope directions that point down.
    phacelle.zw *= -freq;

    // Amount of slope as value from 0 to 1.
    float sloping = abs(phacelle.y);

    // Add non-masked, normalized slope to gullySlope, for use by subsequent octaves.
    // It's normalized to use the steepest part of the sine wave everywhere.
    gullySlope += sign(phacelle.y) * phacelle.zw * strength * gullyWeight;

    // Gullies has height offset (from -1 to 1) in x and derivative in yz.
    vec3 gullies     = vec3(phacelle.x, phacelle.y * phacelle.zw);
    // Fade gullies towards fadeTarget based on combiMask.
    vec3 fadedGullies = mix(vec3(fadeTarget, 0.0, 0.0), gullies * gullyWeight, combiMask);
    // Apply height offset and derivative (slope) according to strength of current octave.
    heightAndSlope  += fadedGullies * strength;
    magnitude       += strength;

    fadeTarget = fadedGullies.x;

    float roundingForOctave = mix(rounding.y, rounding.x, clamp01(phacelle.x + 0.5)) * roundingMult;
    float newMask = erosion_ease_out(erosion_smooth_start(sloping * onset.y, roundingForOctave * onset.y));
    combiMask = erosion_pow_inv(combiMask, detail) * newMask;

    ridgeMapFadeTarget = mix(ridgeMapFadeTarget, gullies.x, ridgeMapCombiMask);
    float newRidgeMapMask = erosion_ease_out(sloping * onset.w);
    ridgeMapCombiMask = ridgeMapCombiMask * newRidgeMapMask;

    strength  *= gain;
    freq      *= lacunarity;
    roundingMult *= rounding.w;
  }

  ridgeMap = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
  // ridgeMap = ridgeMapCombiMask; // for dev purposes
  // ridgeMap = ridgeMapFadeTarget; // for dev purposes
  debug    = fadeTarget;

  return vec4(heightAndSlope - inputHeightAndSlope, magnitude);
}

// ── applyErosion wrapper ─────────────────────────────────────────────────────
// p              – 2D world-space XZ position
// noise          – base elevation in [0, 1]
// slope          – gradient vec2(dh/dx, dh/dz) in world space
// Returns the height delta to add to noise (before clamping).

float applyErosion(
  vec2  p,
  float noise,
  vec2  slope,
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
  out float ridgeOut,
  out float erosionDepth
) {
  vec3 heightAndSlope = vec3(noise, slope);

  // float fadeTarget    = clamp(noise * 2.0 - 1.0, -1.0, 1.0);
  // Define the erosion fade target based on the altitude of the pre-eroded terrain.
  // The fade target should strive to be -1 at valleys and 1 at peaks, but overshooting is ok.
  // float fadeTarget = clamp(n.x / (HEIGHT_AMP * 0.6), -1.0, 1.0);
  float fadeTarget = clamp(noise / (0.125 * 0.6), -1.0, 1.0);

  vec4 rounding     = vec4(ridgeRounding, creaseRounding, 0.1, 2.0);
  vec4 onset        = vec4(1.25, 1.25, 2.8, 1.5);
  vec2 assumedSlope = vec2(0.7, 1.0);

  float ridgeMap, dbg;
  vec4 h = erosion_ErosionFilter(
    p, heightAndSlope, fadeTarget,
    strength, gullyWeight, detail,
    rounding, onset, assumedSlope,
    scale, octaves, lacunarity,
    gain, cellScale, normalization,
    ridgeMap, dbg
  );

  ridgeOut = ridgeMap;

  // Normalised erosion depth: how much erosion raised or lowered this point
  // relative to the total accumulated octave magnitude.
  // Range [-1, 1]: negative in eroded gullies, positive on deposited ridges.
  erosionDepth = (h.w > 0.0) ? clamp(h.x / h.w, -1.0, 1.0) : 0.0;

  // Height offset: pull terrain down slightly (TERRAIN_HEIGHT_OFFSET.x = -0.65).
  float offset = -0.65 * h.w;
  return h.x + offset;
}

`;
