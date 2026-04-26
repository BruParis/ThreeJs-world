/**
 * Elevation compute shader body — GLSL fragment for the GPU compute pass.
 *
 * This file is the compute-pass entry point.  All terrain-domain logic lives in
 * @core/shaders/ and is imported here:
 *
 *   terrainSampleGLSL  — TerrainSample struct, pack/unpack, debug constants
 *   simplexGLSL        — simplexFbm
 *   perlinGLSL         — perlinFbm
 *   erosionGLSL        — applyErosion
 *   terrainGLSL        — applyTerrain  (returns TerrainSample)
 *   heightmapGLSL      — heightmapElevation
 *   fractalNoiseGLSL   — FractalNoise
 *   terrainNoiseGLSL   — baseNoise, computeElevation, displNorm
 *
 * This file owns only:
 *   - Uniform declarations (compute-pass specific, not used in render pass)
 *   - main() — grid coord from gl_FragCoord, finite-diff loop, texture write
 *
 * Output layout (RGBA32F) — see terrainSampleGLSL for the canonical definition:
 *   R = elevation [0, 1]
 *   G = dDisplNorm/dX  (finite-difference gradient, amplitude-normalised)
 *   B = dDisplNorm/dZ
 *   A = ridgeMap
 *
 * Intended to be wrapped with a `#version 300 es` + `precision` header by
 * the consumer (TerrainElevationGL) before compilation.
 */

import { terrainSampleGLSL } from '@core/shaders/terrainSampleGLSL';
import { simplexNoiseGLSL }  from '@core/noise/simplexGLSL';
import { perlinNoiseGLSL }   from '@core/noise/perlinGLSL';
import { erosionGLSL }       from '@core/shaders/erosionGLSL';
import { terrainGLSL }       from '@core/shaders/terrainGLSL';
import { heightmapGLSL }     from '@core/noise/heightmapGLSL';
import { fractalNoiseGLSL }  from '@core/noise/fractalNoiseGLSL';
import { terrainNoiseGLSL }  from '@core/shaders/terrainNoiseGLSL';

export const elevationComputeGLSL = /* glsl */`

${terrainSampleGLSL}

// ── Compute-pass uniforms ─────────────────────────────────────────────────────
// Declared before any library include that references them (GLSL requires
// declarations before first use in lexical order).
// Grid layout
uniform float uOriginX;
uniform float uOriginZ;
uniform float uStepX;
uniform float uStepZ;
uniform float uPatchHalfSize;
// Noise routing
uniform int   uNoiseType;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
// Gaussian
uniform float uGaussSigma;
uniform float uGaussAmplitude;
// Fractal noise
uniform float uFractalFreq;
uniform int   uFractalOctaves;
uniform float uFractalLacunarity;
uniform float uFractalGain;
uniform float uFractalAmp;
// Erosion
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

out vec4 fragColor;

// ── Library includes ──────────────────────────────────────────────────────────
// Order matters: each file may call functions defined in earlier files.
${simplexNoiseGLSL}
${perlinNoiseGLSL}
${erosionGLSL}
${terrainGLSL}
${heightmapGLSL}
${fractalNoiseGLSL}
${terrainNoiseGLSL}

void main() {
  // Exact vertex world position from fragment coordinates.
  float worldX = uOriginX + (gl_FragCoord.x - 0.5) * uStepX;
  float worldZ = uOriginZ + (gl_FragCoord.y - 0.5) * uStepZ;
  vec3 wPos = vec3(worldX, 0.0, worldZ);

  float elev, ridge, erosionDepth;
  computeElevation(wPos, elev, ridge, erosionDepth);

  // Bake finite-difference gradient of the normalised displacement.
  // The vertex shader multiplies by uAmplitude at runtime — no amplitude
  // dependency baked in, so amplitude changes are free (no recompute needed).
  float dL = displNorm(wPos - vec3(uStepX, 0.0, 0.0));
  float dR = displNorm(wPos + vec3(uStepX, 0.0, 0.0));
  float dD = displNorm(wPos - vec3(0.0, 0.0, uStepZ));
  float dU = displNorm(wPos + vec3(0.0, 0.0, uStepZ));
  float gradX = (dR - dL) / (2.0 * uStepX);
  float gradZ = (dU - dD) / (2.0 * uStepZ);

  fragColor = packElevationChannel(elev, gradX, gradZ, ridge, erosionDepth);
}
`;
