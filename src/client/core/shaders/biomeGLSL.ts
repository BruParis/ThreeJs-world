/**
 * Biome blending — per-texel biome weights from the boundary arcs of a patch.
 *
 * The boundaries come from core/terrain/BiomeBoundaries (packed edge texture).
 * For a point p on the planet:
 *   1. p is displaced by a small band-limited noise (domain warp), so the
 *      straight boundary arcs become natural, irregular coastlines.
 *   2. The nearest boundary arc gives the biome p is in (its side of the arc).
 *      When the nearest point is an arc end shared by several arcs (a corner),
 *      the arc leaving that corner closest in direction to p wins: it is one of
 *      the two arcs bounding the sector p lies in.
 *   3. For every other biome b, dist[b] = distance to the nearest arc touching b.
 *      Weights: own biome 1, other biome b 1 - smoothstep(0, W, dist[b]), then
 *      normalised.  On a boundary both sides weigh 1 : 1, so the blend is
 *      continuous; the transition is 2 W wide.
 *
 * Distances are angles on the unit sphere (radians).
 *
 * Exposes:
 *   vec4  biomeWeights(vec3 dir)              weights of biomes 0..3, summing to 1
 *   float biomeBlendElevation(float e, vec4 w) elevation with the per-biome
 *                                              parameters blended in
 *   float biomeReliefFactor(vec4 w)           blended relief scale (ridges, erosion)
 *
 * Requires in scope: snoise (simplexGLSL), terrainBandWeight (fractalNoise3GLSL),
 * uPlanetRadius and uBandTexel (patchBakeGLSL).
 */

import { BIOME_EDGES_PER_ROW, BIOME_MAX } from '@core/terrain/BiomeBoundaries';

export const biomeGLSL = /* glsl */`

#define BIOME_EDGES_PER_ROW ${BIOME_EDGES_PER_ROW}
#define BIOME_MAX ${BIOME_MAX}

uniform highp sampler2D uBiomeEdgeTex;
uniform int   uBiomeEdgeCount;   // 0 → the whole patch is uBiomeDefault
uniform int   uBiomeDefault;
uniform float uBiomeHalfWidth;   // W, radians
uniform float uBiomeWarpAmp;     // boundary noise amplitude, radians
uniform float uBiomeWarpFreq;    // boundary noise frequency, per terrain unit

// Per-biome elevation parameters: elevation_b = base_b + scale_b * noiseElevation.
uniform vec4 uBiomeElevBase;
uniform vec4 uBiomeElevScale;

vec3 biomeWarp(vec3 dir) {
  if (uBiomeWarpAmp <= 0.0) return dir;
  vec3  P    = dir * uPlanetRadius;
  vec3  w    = vec3(0.0);
  float amp  = 1.0;
  float freq = uBiomeWarpFreq;
  float norm = 0.0;
  for (int i = 0; i < 4; i++) {
    float bw = terrainBandWeight(1.0 / freq, uBandTexel);
    if (bw > 0.0) {
      vec3 q = P * freq;
      w += amp * bw * vec3(
        snoise(q),
        snoise(q + vec3(31.41, 17.13, 5.93)),
        snoise(q + vec3(-11.37, 47.29, 23.81)));
    }
    norm += amp;
    amp  *= 0.5;
    freq *= 2.0;
  }
  return normalize(dir + w * (uBiomeWarpAmp / norm));
}

vec4 biomeWeights(vec3 dir) {
  vec4 w = vec4(0.0);
  if (uBiomeEdgeCount <= 0) {
    w[uBiomeDefault] = 1.0;
    return w;
  }

  vec3 p = biomeWarp(dir);

  float best     = 1e9;
  float bestKey  = -2.0;
  int   own      = uBiomeDefault;
  float dist[BIOME_MAX];
  for (int b = 0; b < BIOME_MAX; b++) dist[b] = 1e9;

  for (int i = 0; i < uBiomeEdgeCount; i++) {
    ivec2 ca = ivec2(i % BIOME_EDGES_PER_ROW, 2 * (i / BIOME_EDGES_PER_ROW));
    vec4 A = texelFetch(uBiomeEdgeTex, ca, 0);
    vec4 B = texelFetch(uBiomeEdgeTex, ca + ivec2(0, 1), 0);
    vec3 a = A.xyz;
    vec3 b = B.xyz;
    int  left  = int(A.w + 0.5);
    int  right = int(B.w + 0.5);

    vec3  n    = normalize(cross(a, b));
    float side = dot(n, p);
    vec3  ta   = cross(n, a);   // tangent at a, towards b
    vec3  tb   = cross(b, n);   // tangent at b, towards a

    float d;
    float key = 2.0;            // interior point: never tied in practice
    if (dot(p, ta) < 0.0) {
      d = length(p - a);
      vec3 t = p - a * dot(p, a);
      key = dot(t, ta) / max(length(t), 1e-12);
    } else if (dot(p, tb) < 0.0) {
      d = length(p - b);
      vec3 t = p - b * dot(p, b);
      key = dot(t, tb) / max(length(t), 1e-12);
    } else {
      d = abs(side);
    }

    if (d < best - 1e-9 || (d <= best + 1e-9 && key > bestKey)) {
      best    = d;
      bestKey = key;
      own     = side >= 0.0 ? left : right;
    }
    dist[left]  = min(dist[left],  d);
    dist[right] = min(dist[right], d);
  }

  float W = max(uBiomeHalfWidth, 1e-9);
  float total = 0.0;
  for (int b = 0; b < BIOME_MAX; b++) {
    float wb = (b == own) ? 1.0 : 1.0 - smoothstep(0.0, W, dist[b]);
    w[b]   = wb;
    total += wb;
  }
  return w / total;
}

float biomeBlendElevation(float e, vec4 w) {
  return clamp(dot(w, uBiomeElevBase + uBiomeElevScale * e), 0.0, 1.0);
}

float biomeReliefFactor(vec4 w) {
  return dot(w, uBiomeElevScale);
}

`;
