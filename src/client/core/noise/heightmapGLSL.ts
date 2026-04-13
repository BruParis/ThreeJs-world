/**
 * Value noise with analytical derivatives and integrated directional erosion.
 *
 * Based on Inigo Quilez's derivative-based value noise FBM with directional erosion.
 *
 * Requires: Erosion() and SEA_LEVEL from erosionGLSL must be in scope.
 *
 * Exposes:
 *   vec3 noised(vec2 x)
 *     2D value noise, returns vec3(value [-1,1], dvalue/dx, dvalue/dy).
 *
 *   vec2 heightmapElevation(vec2 p)
 *     FBM terrain with slope-derived erosion built in.
 *     Returns vec2(elevation [0,1], erosion component).
 *     Uses uniforms: uNoiseScale, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity,
 *       uErosionSlopeStrength, uErosionOctaves, uErosionTiles, uErosionBranchStrength,
 *       uErosionGain, uErosionLacunarity, uErosionStrength, SEA_LEVEL.
 */

export const heightmapGLSL = /* glsl */`

float hm_hash(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return -1.0 + 2.0 * fract(sin(h) * 43758.5453123);
}

// 2D value noise with analytical derivatives.
// Returns vec3(value [-1,1], dvalue/dx, dvalue/dy).
vec3 noised(vec2 x) {
  vec2 i  = floor(x);
  vec2 f  = fract(x);
  vec2 u  = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  vec2 du = 30.0*f*f*(f*(f - 2.0) + 1.0);

  float a = hm_hash(i + vec2(0.0, 0.0));
  float b = hm_hash(i + vec2(1.0, 0.0));
  float c = hm_hash(i + vec2(0.0, 1.0));
  float d = hm_hash(i + vec2(1.0, 1.0));

  float k0 = a;
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;

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

  if (uErosionEnabled == 1 && n.x > SEA_LEVEL) {
    float a = 0.5 * smoothstep(SEA_LEVEL, SEA_LEVEL + 0.1, n.x);
    float f = 1.0;

    for (int i = 0; i < uErosionOctaves; i++) {
      h += Erosion(p * uErosionTiles * f, dir + h.zy * vec2(1.0, -1.0) * uErosionBranchStrength) * a * vec3(1.0, f, f);
      a *= uErosionGain;
      f *= uErosionLacunarity;
    }
  }

  return vec2(n.x + (h.x - 0.5) * uErosionStrength, h.x);
}

`;
