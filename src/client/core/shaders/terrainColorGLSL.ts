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

#define CLIFF_COLOR   vec3(0.22, 0.20, 0.20)
#define DIRT_COLOR    vec3(0.60, 0.50, 0.40)
#define GRASS_COLOR1  vec3(0.15, 0.30, 0.10)
#define GRASS_COLOR2  vec3(0.40, 0.50, 0.20)
#define SAND_COLOR    vec3(0.80, 0.70, 0.60)
#define WATER_HEIGHT  ${TERRAIN_WATER_HEIGHT.toFixed(2)}

vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal) {
  float e = clamp(elevation, 0.0, 1.0);

  // Ocean floor — use actual geometry height so color boundary matches displacement.
  if (worldPos.y <= 0.0) {
    return mix(vec3(0.05, 0.10, 0.40), vec3(0.15, 0.55, 0.80), e / WATER_HEIGHT);
  }

  // Raw high-frequency detail noise
  float noise = simplexFbm(worldPos * 8.0, 4, 0.5, 2.0) * 0.5 + 0.5;
  // Breakup blended with elevation so biome boundaries track terrain features
  float breakup = mix(noise, e, 0.4);

  // Cliff rock — base color for all above-water terrain
  vec3 color = CLIFF_COLOR;

  // Dirt — mixed in where breakup is low
  color = mix(color, DIRT_COLOR, smoothstep(0.45, 0.20, breakup));

  // Grass — flat surfaces just above sea level
  vec3 grassMix = mix(GRASS_COLOR1, GRASS_COLOR2,
    smoothstep(0.4, 0.6, e + noise * 0.3));
  color = mix(color, grassMix,
    smoothstep(WATER_HEIGHT + 0.15, WATER_HEIGHT + 0.01, e - noise * 0.04) *
    smoothstep(0.55, 0.75, normal.y + noise * 0.15));

  // Snow — high peaks
  color = mix(color, vec3(1.0),
    smoothstep(0.72, 0.84, e + noise * 0.12));

  // Sand — narrow band at sea level
  color = mix(color, SAND_COLOR,
    smoothstep(WATER_HEIGHT + 0.005, WATER_HEIGHT, e + noise * 0.02));

  // Surface detail variation
  color *= 1.0 + noise * 0.4;

  return clamp(color, 0.0, 1.0);
}

`;
