/**
 * Terrain coloring — reusable GLSL fragment.
 *
 * Exposes:
 *   vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal,
 *                    float occlusion, float ridgeMap)
 *
 * Computes a slope-aware terrain color from a normalised elevation value [0, 1],
 * the displaced world position (used for breakup noise), a pre-computed smooth
 * surface normal, an ambient-occlusion factor [0,1], and an erosion ridge signal.
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
import { treeGLSL, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';

export const TERRAIN_WATER_HEIGHT = 0.35;

export const terrainColorGLSL = /* glsl */`

${simplexNoiseGLSL}

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
#define TREE_COLOR1        vec3(0.12, 0.46, 0.10)
#define TREE_COLOR2        vec3(0.06, 0.28, 0.08)
#define SAND_COLOR         vec3(0.80, 0.70, 0.60)
#define WATER_COLOR        vec3(0.05, 0.10, 0.40)
#define WATER_SHORE_COLOR  vec3(0.15, 0.55, 0.80)

${treeGLSL}

vec3 terrainColor(float elevation, vec3 worldPos, vec3 normal, float occlusion, float ridgeMap) {
  float e = clamp(elevation, 0.0, 1.0);

  // Raw high-frequency detail noise — needed for both water foam and land breakup.
  float noise   = simplexFbm(worldPos * 8.0, 4, 0.5, 2.0) * 0.5 + 0.5;
  // Breakup blended with elevation so biome boundaries track terrain features.
  float breakup = mix(noise, e, 0.4);

  // for debug
  // vec3 breakupColor= vec3(breakup);
  // return breakupColor;

  // ── Water color (shore + foam) ─────────────────────────────────────────────
  // diff clamped ≥ 0 so exp() stays safe even when e > WATER_HEIGHT.
  float diff  = max(0.0, WATER_HEIGHT - e);
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

  // ── Land color ─────────────────────────────────────────────────────────────

  // Base: bare cliff/rock — fallback for anything steep or uncovered.
  vec3 cliffColor = mix(CLIFF_COLOR1, CLIFF_COLOR2, smoothstep(0.3, 0.7, noise));
  vec3 landColor = cliffColor;

  // Ridge/gully factor — 1 in erosion channels (negative ridgeMap), 0 on open terrain.
  // Represents debris and displaced material that accumulates in carved gullies.
  float ridgeGully = smoothstep(0.0, -0.7, ridgeMap);

  // Dirt — low-to-mid altitude.
  // ridgeGully pulls dirt into gullies (darker, debris-laden) even above mid-altitude,
  // and shifts the dirt color toward the darker variant in strongly eroded channels.
  float dirtColorVar = clamp(smoothstep(0.2, 0.7, noise) + ridgeGully * 0.35, 0.0, 1.0);
  vec3 dirtMix = mix(DIRT_COLOR1, DIRT_COLOR2, dirtColorVar);
  float dirtElevFactor  = smoothstep(0.64, 0.44, e);
  float dirtRidgeFactor = ridgeGully * 0.6;             // strong pull toward dirt in gullies
  float dirtBlend = clamp(dirtElevFactor + dirtRidgeFactor, 0.0, 1.0);
  landColor = mix(landColor, dirtMix, dirtBlend * smoothstep(0.42, 0.65, normal.y));

  // Rock — mid-to-high altitude on non-steep terrain (lighter exposed stone).
  // Suppressed in gullies: eroded channels accumulate debris rather than exposing bedrock.
  vec3 rockMix = mix(ROCK_COLOR1, ROCK_COLOR2, smoothstep(0.3, 0.7, noise));
  float rockFactor = smoothstep(0.50, 0.63, e)
                   * smoothstep(0.40, 0.58, normal.y)
                   * (1.0 - ridgeGully * 0.8);          // rock recedes where gullies are deep
  landColor = mix(landColor, rockMix, rockFactor);

  // Grass — only on flat enough terrain, within an elevation band.
  // Two elevation gates: lower (above water) + upper (fades out below snow line).
  // breakup offsets thresholds so biome edges are irregular, not clean bands.
  vec3 grassMix = mix(GRASS_COLOR1, GRASS_COLOR2, smoothstep(0.3, 0.7, noise));
  float grassLower = smoothstep(WATER_HEIGHT + 0.02, WATER_HEIGHT + 0.10, e - breakup * 0.04);
  float grassUpper = smoothstep(0.66, 0.54, e + breakup * 0.04);
  float grassFlat  = smoothstep(0.60, 0.78, normal.y + breakup * 0.08);
  landColor = mix(landColor, grassMix, grassLower * grassUpper * grassFlat);

  // Cliff override — steep slopes always show bare rock, overriding dirt and grass.
  landColor = mix(landColor, cliffColor, slopeCliff);

  // Snow — high peaks, slope-independent (snow settles on cliffs too).
  // breakup makes the snow line irregular.
  landColor = mix(landColor, vec3(1.0), smoothstep(0.72, 0.84, e + breakup * 0.06));

  // ── Tree coverage ──────────────────────────────────────────────────────────
  float trees = GetTreesAmount(e, normal.y, occlusion, ridgeMap);
  // Use high-frequency noise to vary the tree color between two values,
  // giving a natural variation in canopy tone.
  float treeNoise = noised_tree((worldPos.xz + 0.5) * 200.0).x * 0.5 + 0.5;
  vec3 treeColor = mix(TREE_COLOR1, TREE_COLOR2, treeNoise);
  landColor = mix(landColor, treeColor * pow(trees, 8.0), clamp(trees * 2.2 - 0.8, 0.0, 1.0) * 0.9);
  landColor *= 1.0 + breakup * 0.5;

  // ── Shoreline blend: smooth gradient between water and land ────────────────
  // For cliffs we collapse the transition band so water meets land abruptly,
  // suppressing the sand layer that looks wrong on steep faces.

  // Sand — narrow band at sea level, suppressed on steep slopes.
  // slopeFlatness gates the sand so cliffs diving into water stay rocky.
  landColor = mix(landColor, SAND_COLOR,
    smoothstep(WATER_HEIGHT + 0.005, WATER_HEIGHT, e + breakup * 0.03) * slopeFlatness);

  // waterFactor: 1 = fully water, 0 = fully land.
  // Blend width shrinks from 0.01 (flat) to 0.001 (cliff).
  float blendHalf = mix(0.001, 0.01, slopeFlatness);
  float waterFactor = 1.0 - smoothstep(WATER_HEIGHT - blendHalf, WATER_HEIGHT + blendHalf, e);
  return clamp(mix(landColor, waterColor, waterFactor), 0.0, 1.0);
}

`;
