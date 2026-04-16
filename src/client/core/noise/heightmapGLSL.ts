/**
 * Value noise with analytical derivatives and integrated directional erosion.
 *
 * The noise kernel assigns a pseudo-random scalar value to each integer lattice
 * corner (via a sin-based hash) and interpolates them with a quintic smoothstep.
 * Partial derivatives are computed analytically via the chain rule rather than
 * finite differences, which is what makes slope-driven erosion possible.
 * Based on IQ's derivative-based value noise FBM.
 *
 * Requires: Erosion() and SEA_LEVEL from erosionGLSL must be in scope.
 *
 * Exposes:
 *   vec3 noised(vec2 x)
 *     2D gradient noise, returns vec3(value [-1,1], dvalue/dx, dvalue/dy).
 *
 *   vec2 heightmapElevation(vec2 p)
 *     FBM terrain with slope-derived erosion built in.
 *     Returns vec2(elevation [0,1], erosion component).
 *     Uses uniforms: uNoiseScale, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity,
 *       uErosionSlopeStrength, uErosionOctaves, uErosionTiles, uErosionBranchStrength,
 *       uErosionGain, uErosionLacunarity, uErosionStrength, SEA_LEVEL.
 */

export const heightmapGLSL = /* glsl */`

// Scalar hash: maps a 2D lattice point to a pseudo-random float in [-1, 1].
// Uses a bitwise integer hash to avoid the sin()-based float precision artifacts
// that cause isolated spikes at specific lattice coordinates.
float hm_hash(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  uint h = q.x * 1664525u + q.y * 22695477u + 1013904223u;
  h ^= h >> 16;
  return float(h) / float(0xffffffffu) * 2.0 - 1.0;
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

  // Slope direction from accumulated derivatives (curl of normal).
  vec2 dir = n.zy * vec2(1.0, -1.0) * uErosionSlopeStrength;

  // Directional erosion FBM — direction steered by slope, then fed back.
  vec3  h = vec3(0.0);

  if (uErosionEnabled == 1) {
    float a = 0.5;
    float f = 1.0;

    // Scale erosion amplitude down near and below the waterline.
    // The wider fade zone ([-0.1, +0.2] around SEA_LEVEL) gives a softer
    // coastal transition than a hard cutoff, matching the original Heightmap().
    a *= smoothstep(SEA_LEVEL - 0.1, SEA_LEVEL + 0.2, n.x);

    for (int i = 0; i < uErosionOctaves; i++) {
      h += Erosion(p * uErosionTiles * f, dir + h.zy * vec2(1.0, -1.0) * uErosionBranchStrength) * a * vec3(1.0, f, f);
      a *= uErosionGain;
      f *= uErosionLacunarity;
    }
  }

  return vec2(n.x + (h.x - 0.5) * uErosionStrength, h.x);
}

`;
