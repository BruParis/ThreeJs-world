/**
 * Tree density compute shader (GLSL ES 3.0 fragment).
 *
 * Dynamic pass — runs when elevation offset or tree parameters change.
 * Samples the baked elevation and attribute textures (from the static elevation
 * pass), applies uElevOffset, and calls ComputeTreeMap per texel.
 *
 * Input textures (same layout as TerrainElevationGL output):
 *   uElevTex  — R=rawElev, G=gradX, B=gradZ  (RGBA32F, LinearFilter)
 *   uAttrTex  — R=ridgeMap                   (RGBA32F, NearestFilter)
 *
 * Output (COLOR_ATTACHMENT0):
 *   R = treeDensity [0,1]
 *
 * Wrapped with `#version 300 es` + `precision` header by TreeDensityGL.
 */

import { shaderUtilsGLSL }               from '@core/shaders/shaderUtilsGLSL';
import { treeGLSL, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';

export const treeDensityComputeGLSL = /* glsl */`

uniform sampler2D uElevTex;
uniform sampler2D uAttrTex;
uniform float uOriginX;
uniform float uOriginZ;
uniform float uStepX;
uniform float uStepZ;
uniform float uElevOffset;
uniform float uSeaLevel;

#define GRASS_HEIGHT ${TERRAIN_GRASS_HEIGHT.toFixed(2)}

layout(location = 0) out vec4 fragColor;  // R = treeDensity

${shaderUtilsGLSL}
${treeGLSL}

void main() {
  // Sample baked elevation data at this texel.
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4  elev  = texelFetch(uElevTex,  coord, 0);
  float rawElev = elev.r;
  float gradX   = elev.g;
  float gradZ   = elev.b;
  float ridgeMap = texelFetch(uAttrTex, coord, 0).r;

  // World-space position — matches the layout used by the elevation compute pass.
  float worldX = uOriginX + (gl_FragCoord.x - 0.5) * uStepX;
  float worldZ = uOriginZ + (gl_FragCoord.y - 0.5) * uStepZ;

  // Apply elevation offset — same as the vertex shader does at runtime.
  float elev_shifted = clamp(rawElev + uElevOffset, 0.0, 1.0);
  float normalY      = inversesqrt(1.0 + gradX * gradX + gradZ * gradZ);

  bool isWater   = elev_shifted < uSeaLevel;
  bool grassZone = !isWater
                 && elev_shifted < GRASS_HEIGHT + 0.04
                 && normalY > 0.85;

  float density = clamp01(
    ComputeTreeMap(elev_shifted, ridgeMap, normalY, vec2(worldX, worldZ), isWater, grassZone)
  );

  fragColor = vec4(density, 0.0, 0.0, 1.0);
}
`;
