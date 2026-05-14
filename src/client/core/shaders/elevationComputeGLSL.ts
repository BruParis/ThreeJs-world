/**
 * Elevation compute shader body — GPU compute pass (GLSL ES 3.0 fragment).
 *
 * Static pass: elevation data only — no classification, no tree density.
 *
 * MRT output:
 *   COLOR_ATTACHMENT0 — elevation texture (LinearFilter)
 *     R = rawElev [0,1]  G = dH/dX  B = dH/dZ  A = unused (0)
 *   COLOR_ATTACHMENT1 — attribute texture (NearestFilter)
 *     R = ridgeMap [-1,1]  G = erosionDepth packed (×0.5+0.5)  B,A = unused
 *
 * Wrapped with `#version 300 es` + `precision` header by TerrainElevationGL.
 */

import { terrainSampleGLSL }  from '@core/shaders/terrainSampleGLSL';
import { simplexNoiseGLSL }   from '@core/noise/simplexGLSL';
import { perlinNoiseGLSL }    from '@core/noise/perlinGLSL';
import { shaderUtilsGLSL }   from '@core/shaders/shaderUtilsGLSL';
import { erosionGLSL }        from '@core/shaders/erosionGLSL';
import { terrainGLSL }        from '@core/shaders/terrainGLSL';
import { heightmapGLSL }      from '@core/noise/heightmapGLSL';
import { fractalNoiseGLSL }   from '@core/noise/fractalNoiseGLSL';
import { terrainNoiseGLSL }   from '@core/shaders/terrainNoiseGLSL';

export const elevationComputeGLSL = /* glsl */`

${terrainSampleGLSL}

uniform float uOriginX;
uniform float uOriginZ;
uniform float uStepX;
uniform float uStepZ;
uniform float uPatchHalfSize;
uniform int   uNoiseType;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
uniform float uGaussSigma;
uniform float uGaussAmplitude;
uniform float uFractalFreq;
uniform int   uFractalOctaves;
uniform float uFractalLacunarity;
uniform float uFractalGain;
uniform float uFractalAmp;
uniform int   uErosionEnabled;
uniform int   uErosionOctaves;
uniform float uErosionScale;
uniform float uErosionStrength;
uniform float uErosionGullyWeight;
uniform float uErosionDetail;
uniform float uErosionGain;
uniform float uErosionLacunarity;
uniform float uErosionCellScale;
uniform float uErosionNormalization;
uniform float uErosionRidgeRounding;
uniform float uErosionCreaseRounding;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragAttr;

${simplexNoiseGLSL}
${perlinNoiseGLSL}
${shaderUtilsGLSL}
${erosionGLSL}
${terrainGLSL}
${heightmapGLSL}
${fractalNoiseGLSL}
${terrainNoiseGLSL}

void main() {
  float worldX = uOriginX + (gl_FragCoord.x - 0.5) * uStepX;
  float worldZ = uOriginZ + (gl_FragCoord.y - 0.5) * uStepZ;
  vec3 wPos = vec3(worldX, 0.0, worldZ);

  float rawElev, ridge, erosionDepth;
  computeElevation(wPos, rawElev, ridge, erosionDepth);

  float dL = displNorm(wPos - vec3(uStepX, 0.0, 0.0));
  float dR = displNorm(wPos + vec3(uStepX, 0.0, 0.0));
  float dD = displNorm(wPos - vec3(0.0, 0.0, uStepZ));
  float dU = displNorm(wPos + vec3(0.0, 0.0, uStepZ));
  float gradX = (dR - dL) / (2.0 * uStepX);
  float gradZ = (dU - dD) / (2.0 * uStepZ);

  fragColor = packElevationChannel(rawElev, gradX, gradZ); // A = 0
  fragAttr  = vec4(ridge, erosionDepth * 0.5 + 0.5, 0.0, 0.0);
}
`;
