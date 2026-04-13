/**
 * Hydraulic erosion — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 Erosion(vec2 p, vec2 dir)
 *
 * Returns vec3(erosionHeight, dErosion/dx, dErosion/dy).
 * `erosionHeight` is centred around 0 — add (erosionHeight - 0.5) * strength
 * to a base elevation value to see the effect.
 *
 * Requires no other GLSL dependencies.
 *
 * Uniforms consumed (declare in host shader):
 *   int   uErosionOctaves
 *   float uErosionTiles          – frequency scale applied before calling Erosion
 *   float uErosionStrength        – height contribution of the erosion layer
 *   float uErosionSlopeStrength   – how strongly terrain slope steers erosion
 *   float uErosionBranchStrength  – how much erosion derivatives feed back into direction
 *   float uErosionGain            – amplitude decay per octave
 *   float uErosionLacunarity      – frequency growth per octave
 *
 * Reference: hydraulic erosion by Shane / Inigo Quilez-style directional noise.
 */

// ── TypeScript defaults (mirror the #defines used in host shaders) ─────────────

export const DEFAULT_EROSION_OCTAVES          = 5;
export const DEFAULT_EROSION_TILES            = 3.0;
export const DEFAULT_EROSION_STRENGTH         = 0.15;
export const DEFAULT_EROSION_SLOPE_STRENGTH   = 1.0;
export const DEFAULT_EROSION_BRANCH_STRENGTH  = 0.3;
export const DEFAULT_EROSION_GAIN             = 0.5;
export const DEFAULT_EROSION_LACUNARITY       = 2.0;

// ── GLSL source ───────────────────────────────────────────────────────────────

export const erosionGLSL = /* glsl */`

#ifndef PI
#define PI 3.14159265358979323846
#endif

// 2D hash — returns a pseudo-random unit-ish vec2 for a given grid cell.
vec2 erosionHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)),
           dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

// Directional erosion noise.
// p   – 2D position in erosion-tile space
// dir – slope direction (gradient of the underlying height field)
// Returns vec3(erosionValue, dValue/dx, dValue/dy).
vec3 Erosion(in vec2 p, vec2 dir) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f  = 2.0 * PI;
  vec3  va = vec3(0.0);
  float wt = 0.0;

  for (int i = -2; i <= 1; i++) {
    for (int j = -2; j <= 1; j++) {
      vec2 o  = vec2(i, j);
      vec2 h  = erosionHash(ip - o) * 0.5;
      vec2 pp = fp + o - h;
      float d   = dot(pp, pp);
      float w   = exp(-d * 2.0);
      wt += w;
      float mag = dot(pp, dir);
      va += vec3(cos(mag * f), -sin(mag * f) * dir) * w;
    }
  }
  return va / wt;
}

// Apply erosion FBM on top of a base noise value.
// p         – 2D world-space position (typically worldPos.xz * noiseScale)
// baseNoise – base elevation in [0, 1] (used for slope and water mask)
// Returns the erosion height contribution (add to baseNoise).
float applyErosion(
  vec2  p,
  float baseNoise,
  int   octaves,
  float tiles,
  float strength,
  float slopeStrength,
  float branchStrength,
  float gain,
  float lacunarity,
  float waterHeight,
  vec2  slopeDir
) {
  if (baseNoise <= waterHeight) return 0.0;
  float waterMask = smoothstep(waterHeight, waterHeight + 0.1, baseNoise);

  // Initial slope direction scaled by slopeStrength.
  vec2 dir = slopeDir * slopeStrength;

  vec3  h  = vec3(0.0);
  float ea = 0.5;
  float ef = 1.0;
  vec2  ep = p * tiles;

  for (int i = 0; i < octaves; i++) {
    h  += Erosion(ep * ef, dir + h.zy * vec2(1.0, -1.0) * branchStrength) * ea * vec3(1.0, ef, ef);
    ea *= gain;
    ef *= lacunarity;
  }

  return (h.x - 0.5) * strength * waterMask;
}

`;
