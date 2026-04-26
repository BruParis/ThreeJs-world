/**
 * Terrain coloring — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal,
 *                    float ridgeMap, vec3 suppNoise)
 *
 * Computes a slope-aware terrain color from a normalised elevation value [0, 1],
 * the displaced world position (used for breakup noise), a pre-computed smooth
 * surface normal, an erosion ridge signal, and the pre-sampled supplemental
 * noise data (RGB from the suppNoise texture — sampled once by the caller and
 * passed through so all layers share the same value).
 *
 * Biome stack (bottom → top):
 *   ocean floor  →  sand  →  cliff (base)  →  dirt (moderate slopes)  →  grass (flat terrain)  →  cliff override (steep)  →  snow
 *
 * Must be included in a GLSL 3 fragment shader that already has simplexNoiseGLSL
 * (i.e. snoise and simplexFbm) available in scope.
 *
 * Constant WATER_HEIGHT (0.35) is the sea-level threshold and must match the
 * value used in the vertex shader (TERRAIN_SEA).
 */

import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';
import { shaderUtilsGLSL } from '@core/shaders/shaderUtilsGLSL';
import { treeGLSL, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';

export const TERRAIN_WATER_HEIGHT = 0.35;

export const terrainColorGLSL = /* glsl */`

${simplexNoiseGLSL}
${shaderUtilsGLSL}

#define WATER
#define WATER_HEIGHT       ${(0.35).toFixed(2)}
#define GRASS_HEIGHT       ${TERRAIN_GRASS_HEIGHT.toFixed(2)}

#define CLIFF_COLOR1       vec3(0.22, 0.20, 0.20)
#define CLIFF_COLOR2       vec3(0.38, 0.30, 0.24)
#define ROCK_COLOR1        vec3(0.40, 0.36, 0.32)
#define ROCK_COLOR2        vec3(0.54, 0.48, 0.40)
#define DIRT_COLOR1        vec3(0.60, 0.50, 0.40)
#define DIRT_COLOR2        vec3(0.46, 0.36, 0.26)
#define GRASS_COLOR1       vec3(0.15, 0.30, 0.10)
#define GRASS_COLOR2       vec3(0.40, 0.50, 0.20)
#define TREE_COLOR1        vec3(0.12, 0.26, 0.10)
#define TREE_COLOR2        vec3(0.06, 0.38, 0.08)
#define SAND_COLOR         vec3(0.80, 0.70, 0.60)
#define WATER_COLOR        vec3(0.05, 0.10, 0.40)
#define WATER_SHORE_COLOR  vec3(0.15, 0.55, 0.80)

${treeGLSL}

vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal, float ridgeMap, vec3 suppNoise) {
  // float e = clamp(elevation, 0.0, 1.0);
  elevation = clamp(elevation, 0.0, 1.0);

  // Raw high-frequency detail noise — needed for both water foam and land breakup.
  float noise = simplexFbm(worldPos * 8.0, 4, 0.5, 2.0) * 0.5 + 0.5;

  float breakup = suppNoise.x;

  float occlusion = 1.0;
  float erosion = 0.0;
  // occlusion = clamp01(erosion + 0.5);

  // ── Water color (shore + foam) ─────────────────────────────────────────────
  // diff clamped ≥ 0 so exp() stays safe even when e > WATER_HEIGHT.
  float diff  = max(0.0, WATER_HEIGHT - elevation);
  float shore = normal.y > 1e-2 ? exp(-diff * 60.0) : 0.0;
  float foam  = normal.y > 1e-2 ? smoothstep(0.005, 0.0, diff + breakup * 0.005) : 0.0;
  vec3 waterColor = mix(WATER_COLOR, WATER_SHORE_COLOR, shore);
  waterColor = mix(waterColor, vec3(1.0), foam);

  // ── Slope helpers ──────────────────────────────────────────────────────────
  // normal.y ≈ 1 = flat ground, ≈ 0 = vertical cliff face.
  // Computed once and reused across all biome layers.
  float slopeCliff = smoothstep(0.65, 0.45, normal.y); // 1 on steep, 0 on flat
  // slopeFlatness: 1 = flat, 0 = cliff. Squared so suppression kicks in hard
  // even when smooth normals keep normal.y above zero on steep faces.
  float slopeFlatness = smoothstep(0.5, 0.80, normal.y);
  slopeFlatness *= slopeFlatness;

  // ── Tree coverage ──────────────────────────────────────────────────────────
  float trees = ComputeTreeMap(elevation, normal.y, occlusion, ridgeMap, suppNoise, worldPos);

  // ── Land color ─────────────────────────────────────────────────────────────
  vec3 landColor = vec3(0.0);

  // Base: bare cliff — fallback for anything steep or uncovered.
  vec3 cliffColor = CLIFF_COLOR1 * smoothstep(0.4, 0.52, elevation);
  cliffColor = mix(cliffColor, DIRT_COLOR1, smoothstep(0.6, 0.0, occlusion + breakup * 1.5));
  landColor = cliffColor;

  // Snow
  landColor = mix(landColor, vec3(1.0), smoothstep(0.53, 0.6, elevation + breakup * 0.1));

  // Grass — ...
  vec3 grassMix = mix(GRASS_COLOR1, GRASS_COLOR2, smoothstep(0.4, 0.6, elevation - erosion * 0.05 + breakup * 0.3));
  landColor = mix(landColor, grassMix,
    smoothstep(GRASS_HEIGHT + 0.05, GRASS_HEIGHT + 0.02, elevation + 0.01 + (occlusion - 0.8) * 0.05 - breakup * 0.02)
    * smoothstep(0.8, 1.0, 1.0 - (1.0 - normal.y) * (1.0 - trees) + breakup * 0.1));

  // ── Tree color ─────────────────────────────────────────────────────────────
  // treeNoise = clamp01(treeNoise); // tree value as [0; 1]
  // vec3 treeColor = mix(TREE_COLOR1, TREE_COLOR2, treeNoise);
  vec3 treeColor = TREE_COLOR1;
  landColor = mix(landColor, treeColor * pow(trees, 8.0), clamp01(trees * 2.2 - 0.8) * 0.6);

  landColor *= 1.0 + breakup * 0.5;

  // Cliff override — steep slopes always show bare rock, overriding dirt and grass.
  // landColor = mix(landColor, cliffColor, slopeCliff);

  // ── Shoreline blend: smooth gradient between water and land ────────────────
  // For cliffs we collapse the transition band so water meets land abruptly,
  // suppressing the sand layer that looks wrong on steep faces.

  // Sand — narrow band at sea level, suppressed on steep slopes.
  // slopeFlatness gates the sand so cliffs diving into water stay rocky.
  // landColor = mix(landColor, SAND_COLOR,
  //   smoothstep(WATER_HEIGHT + 0.005, WATER_HEIGHT, e + breakup * 0.03) * slopeFlatness);

  // waterFactor: 1 = fully water, 0 = fully land.
  // Blend width shrinks from 0.01 (flat) to 0.001 (cliff).
  float blendHalf = mix(0.001, 0.01, slopeFlatness);
  float waterFactor = 1.0 - smoothstep(WATER_HEIGHT - blendHalf, WATER_HEIGHT + blendHalf, elevation);

  return clamp(mix(landColor, waterColor, waterFactor), 0.0, 1.0);
}

`;
