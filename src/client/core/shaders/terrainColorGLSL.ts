/**
 * Terrain coloring — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal)
 *
 * Computes a slope-aware terrain color from a normalised elevation value [0, 1],
 * the displaced world position (used for breakup noise), and a pre-computed
 * smooth surface normal (supplied by the vertex shader).
 *
 * Biome stack (bottom → top):
 *   ocean floor  →  sand  →  grass  →  dirt/cliff  →  snow
 *
 * Must be included in a GLSL 3 fragment shader that already has simplexNoiseGLSL
 * (i.e. snoise and simplexFbm) available in scope.
 *
 * Constant WATER_HEIGHT (0.35) is the sea-level threshold and must match the
 * value used in the vertex shader.
 */

import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';

export const TERRAIN_WATER_HEIGHT = 0.35;

export const terrainColorGLSL = /* glsl */`

${simplexNoiseGLSL}

#define CLIFF_COLOR        vec3(0.22, 0.20, 0.20)
#define DIRT_COLOR         vec3(0.60, 0.50, 0.40)
#define GRASS_COLOR1       vec3(0.15, 0.30, 0.10)
#define GRASS_COLOR2       vec3(0.40, 0.50, 0.20)
#define SAND_COLOR         vec3(0.80, 0.70, 0.60)
#define WATER_COLOR        vec3(0.05, 0.10, 0.40)
#define WATER_SHORE_COLOR  vec3(0.15, 0.55, 0.80)
#define WATER_HEIGHT       ${TERRAIN_WATER_HEIGHT.toFixed(2)}

vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal) {
  float e = clamp(elevation, 0.0, 1.0);

  // Raw high-frequency detail noise — needed for both water foam and land breakup.
  float noise   = simplexFbm(worldPos * 8.0, 4, 0.5, 2.0) * 0.5 + 0.5;
  // Breakup blended with elevation so biome boundaries track terrain features.
  float breakup = mix(noise, e, 0.4);

  // ── Water color (shore + foam) ─────────────────────────────────────────────
  // diff clamped ≥ 0 so exp() stays safe even when e > WATER_HEIGHT.
  float diff  = max(0.0, WATER_HEIGHT - e);
  float shore = normal.y > 1e-2 ? exp(-diff * 60.0) : 0.0;
  float foam  = normal.y > 1e-2 ? smoothstep(0.005, 0.0, diff + breakup * 0.005) : 0.0;
  vec3 waterColor = mix(WATER_COLOR, WATER_SHORE_COLOR, shore);
  waterColor = mix(waterColor, vec3(1.0), foam);

  // ── Land color ─────────────────────────────────────────────────────────────
  vec3 landColor = CLIFF_COLOR;

  landColor = mix(landColor, DIRT_COLOR, smoothstep(0.45, 0.20, e));

  // Grass — flat surfaces just above sea level
  vec3 grassMix = mix(GRASS_COLOR1, GRASS_COLOR2, smoothstep(0.4, 0.6, e * 0.3));
  landColor = mix(landColor, grassMix,
    smoothstep(WATER_HEIGHT + 0.15, WATER_HEIGHT + 0.01, e) *
    smoothstep(0.55, 0.75, normal.y));

  // Snow — high peaks
  landColor = mix(landColor, vec3(1.0), smoothstep(0.72, 0.84, e));

  // ── Shoreline blend: smooth gradient between water and land ────────────────
  // slopeFlatness: 1 = flat ground, 0 = vertical cliff.
  // For cliffs we collapse the transition band so water meets land abruptly,
  // suppressing the sand / grass layers that look wrong on steep faces.
  // slopeFlatness: 1 = flat, 0 = cliff. Squared so suppression kicks in hard
  // even when smooth normals keep normal.y above zero on steep faces.
  float slopeFlatness = smoothstep(0.5, 0.80, normal.y);
  slopeFlatness *= slopeFlatness;

  // Sand — narrow band at sea level, fully suppressed on cliffs
  float sandWidth = mix(0.0005, 0.005, slopeFlatness);
  landColor = mix(landColor, SAND_COLOR,
    smoothstep(WATER_HEIGHT + sandWidth, WATER_HEIGHT, e) * slopeFlatness);

  // waterFactor: 1 = fully water, 0 = fully land.
  // Blend width shrinks from 0.01 (flat) to 0.001 (cliff).
  float blendHalf = mix(0.001, 0.01, slopeFlatness);
  float waterFactor = 1.0 - smoothstep(WATER_HEIGHT - blendHalf, WATER_HEIGHT + blendHalf, e);
  return clamp(mix(landColor, waterColor, waterFactor), 0.0, 1.0);
}

`;
