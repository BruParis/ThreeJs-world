/**
 * Value noise with analytical derivatives and integrated directional erosion.
 *
 * The noise kernel assigns a pseudo-random scalar value to each integer lattice
 * corner (via a sin-based hash) and interpolates them with a quintic smoothstep.
 * Partial derivatives are computed analytically via the chain rule rather than
 * finite differences, which is what makes slope-driven erosion possible.
 * Based on IQ's derivative-based value noise FBM.
 *
 * Requires: applyErosion() from erosionGLSL must be in scope.
 *
 * Exposes:
 *   vec3 noised(vec2 x)
 *     2D gradient noise, returns vec3(value [-1,1], dvalue/dx, dvalue/dy).
 *
 *   vec2 heightmapElevation(vec2 p)
 *     FBM terrain with slope-derived erosion built in.
 *     Returns vec2(elevation [0,1], erosion component).
 *     Uses uniforms: uNoiseScale, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity,
 *       uErosionEnabled, uErosionOctaves, uErosionScale, uErosionStrength,
 *       uErosionGullyWeight, uErosionDetail, uErosionGain, uErosionLacunarity,
 *       uErosionCellScale, uErosionNormalization, uErosionRidgeRounding,
 *       uErosionCreaseRounding, SEA_LEVEL.
 */

export const heightmapGLSL = /* glsl */`

float hm_hash(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return -1.0 + 2.0 * fract(sin(h) * 43758.5453123);
}

// 2D value noise with analytical derivatives.
// Interpolates scalar hashes at the four surrounding lattice corners using a
// quintic smoothstep, and derives the partial derivatives analytically via the
// chain rule — no finite differences needed.
// Returns vec3(value [-1,1], dvalue/dx, dvalue/dy).
vec3 noised(vec2 x) {
  vec2 i  = floor(x);
  vec2 f  = fract(x);

  // Quintic smoothstep and its derivative for C2-continuous interpolation.
  vec2 u  = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  vec2 du = 30.0*f*f*(f*(f - 2.0) + 1.0);

  // Scalar noise values at the four surrounding lattice corners.
  float a = hm_hash(i + vec2(0.0, 0.0));
  float b = hm_hash(i + vec2(1.0, 0.0));
  float c = hm_hash(i + vec2(0.0, 1.0));
  float d = hm_hash(i + vec2(1.0, 1.0));

  // Bilinear coefficients.
  float k0 = a;
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;

  // Interpolated value and its analytical partial derivatives.
  return vec3(k0 + k1*u.x + k2*u.y + k4*u.x*u.y,
              du.x * (k1 + k4*u.y),
              du.y * (k2 + k4*u.x));
}

// FBM terrain with slope-derived directional erosion.
// p — world XZ position; uNoiseScale is applied internally.
// Returns vec2(elevation [0,1], erosion component).
vec2 heightmapElevation(vec2 p) {
  vec2 pWorld = p;  // keep world-space p for applyErosion
  p = p * uNoiseScale;

  // Base terrain FBM with derivative accumulation (chain-rule scaling).
  vec3 n  = vec3(0.0);
  float nf = 1.0;
  float na = 0.5;
  for (int i = 0; i < uNoiseOctaves; i++) {
    n  += noised(p * nf) * na * vec3(1.0, nf, nf);
    na *= uNoisePersistence;
    nf *= uNoiseLacunarity;
  }
  n.x = n.x * 0.5 + 0.5;  // [-1,1] -> [0,1]

  float erosionDelta = 0.0;
  if (uErosionEnabled == 1) {
    // Analytical derivatives give us the slope in scaled space.
    // Direction-only, so scaling doesn't matter for the gully steering.
    vec2 slope = n.yz;
    erosionDelta = applyErosion(
      pWorld, n.x, slope,
      uErosionOctaves,
      uErosionScale,
      uErosionStrength,
      uErosionGullyWeight,
      uErosionDetail,
      uErosionLacunarity,
      uErosionGain,
      uErosionCellScale,
      uErosionNormalization,
      uErosionRidgeRounding,
      uErosionCreaseRounding
    );
  }

  return vec2(clamp(n.x + erosionDelta, 0.0, 1.0), erosionDelta);
}

`;
