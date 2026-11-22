/**
 * Tree density compute shader (GLSL ES 3.0 fragment).
 *
 * Dynamic pass — runs when elevation offset or tree parameters change.
 * Reads the baked elevation and attribute textures (from the static elevation
 * pass), applies uElevOffset, and calls ComputeTreeMap per texel.
 *
 * Input textures (same size as the texture being baked):
 *   uElevTex  — R=rawElev, GBA=surface gradient
 *   uAttrTex  — R=ridgeMap
 *
 * Output:
 *   R = treeDensity [0,1]
 *
 * Used as the fragment shader of a GLSL3 THREE.ShaderMaterial (TerrainPatchBaker).
 */

import { shaderUtilsGLSL }               from '@core/shaders/shaderUtilsGLSL';
import { patchBakeGLSL }                 from '@core/shaders/patchBakeGLSL';
import { treeGLSL, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';

export const treeDensityComputeGLSL = /* glsl */`

${patchBakeGLSL}

uniform sampler2D uElevTex;
uniform sampler2D uAttrTex;
uniform float uElevOffset;
uniform float uSeaLevel;

#define GRASS_HEIGHT ${TERRAIN_GRASS_HEIGHT.toFixed(2)}

layout(location = 0) out vec4 fragColor;  // R = treeDensity

${shaderUtilsGLSL}
${treeGLSL}

void main() {
  // Baked elevation data at this texel.
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4  elev  = texelFetch(uElevTex, coord, 0);
  float rawElev  = elev.r;
  vec3  grad     = elev.gba;
  float ridgeMap = texelFetch(uAttrTex, coord, 0).r;

  // 3D position of this texel — same mapping as the elevation pass.
  vec3 P = patchBakeDir() * uPlanetRadius;

  // Apply elevation offset — same as the vertex shader does at runtime.
  float elev_shifted = clamp(rawElev + uElevOffset, 0.0, 1.0);
  float normalY      = inversesqrt(1.0 + dot(grad, grad));

  bool isWater   = elev_shifted < uSeaLevel;
  bool grassZone = !isWater
                 && elev_shifted < GRASS_HEIGHT + 0.04
                 && normalY > 0.85;

  // The per-texel noise is deliberately not band-limited here: this density only
  // drives the small canopy height bias, where per-texel variation is wanted.
  float density = clamp01(
    ComputeTreeMap(elev_shifted, ridgeMap, normalY, P, isWater, grassZone, 1.0)
  );

  fragColor = vec4(density, 0.0, 0.0, 1.0);
}
`;
