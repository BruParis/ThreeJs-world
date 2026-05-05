/**
 * Elevation compute shader body — GPU compute pass (GLSL ES 3.0 fragment).
 *
 * Pipeline per texel:
 *   1. baseNoise → erosion  (computeElevation — unchanged, no side-effects)
 *   2. Bake gradient via finite differences of displNorm at ±step neighbours
 *   3. Derive exact normalY from the baked gradient  (matches vertex shader)
 *   4. classifyTerrain — tree density + hardness at centre point only
 *   5. Apply small tree elevation bias to elev
 *   6. Write MRT outputs
 *
 * MRT output:
 *   COLOR_ATTACHMENT0 — elevation texture (LinearFilter)
 *     R = elevation [0,1],  G = dDisplNorm/dX,  B = dDisplNorm/dZ,  A = unused
 *   COLOR_ATTACHMENT1 — attribute texture (LinearFilter — all channels are continuous floats)
 *     R = ridgeMap     [-1, 1]  (direct)
 *     G = erosionDepth [0, 1]   (packed: ×0.5+0.5; unpack: ×2−1)
 *     B = trees        float    (direct; isTree when > 0.36)
 *     A = hardness     [0, 1]   (direct)
 *
 * Wrapped with `#version 300 es` + `precision` header by TerrainElevationGL.
 */

import { terrainSampleGLSL }         from '@core/shaders/terrainSampleGLSL';
import { simplexNoiseGLSL }          from '@core/noise/simplexGLSL';
import { perlinNoiseGLSL }           from '@core/noise/perlinGLSL';
import { shaderUtilsGLSL }           from '@core/shaders/shaderUtilsGLSL';
import { erosionGLSL }               from '@core/shaders/erosionGLSL';
import { treeGLSL, TERRAIN_GRASS_HEIGHT } from '@core/shaders/treeGLSL';
import { terrainClassificationGLSL } from '@core/shaders/terrainClassificationGLSL';
import { terrainGLSL }               from '@core/shaders/terrainGLSL';
import { heightmapGLSL }             from '@core/noise/heightmapGLSL';
import { fractalNoiseGLSL }          from '@core/noise/fractalNoiseGLSL';
import { terrainNoiseGLSL }          from '@core/shaders/terrainNoiseGLSL';

export const elevationComputeGLSL = /* glsl */`

${terrainSampleGLSL}

// ── Compute-pass uniforms ─────────────────────────────────────────────────────
// Declared before any library include that references them.
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
// Classification — uTree* uniforms are declared inside treeGLSL.
uniform float uSeaLevel;

// GRASS_HEIGHT required by terrainClassificationGLSL.
#define GRASS_HEIGHT ${TERRAIN_GRASS_HEIGHT.toFixed(2)}

layout(location = 0) out vec4 fragColor;  // elevation texture (COLOR_ATTACHMENT0)
layout(location = 1) out vec4 fragAttr;   // attribute texture (COLOR_ATTACHMENT1)

// ── Library includes ──────────────────────────────────────────────────────────
// Order matters: each file may call functions defined in earlier files.
${simplexNoiseGLSL}
${perlinNoiseGLSL}
${shaderUtilsGLSL}
${erosionGLSL}
${treeGLSL}
${terrainClassificationGLSL}
${terrainGLSL}
${heightmapGLSL}
${fractalNoiseGLSL}
${terrainNoiseGLSL}

void main() {
  float worldX = uOriginX + (gl_FragCoord.x - 0.5) * uStepX;
  float worldZ = uOriginZ + (gl_FragCoord.y - 0.5) * uStepZ;
  vec3 wPos = vec3(worldX, 0.0, worldZ);

  // Step 1+2: base noise → erosion.
  float elev, ridge, erosionDepth;
  computeElevation(wPos, elev, ridge, erosionDepth);

  // Step 2b: bake finite-difference gradient of the normalised displacement.
  // displNorm runs the full noise+erosion pipeline at each neighbour, but does
  // NOT run classification — classification only happens at the centre point.
  float dL = displNorm(wPos - vec3(uStepX, 0.0, 0.0));
  float dR = displNorm(wPos + vec3(uStepX, 0.0, 0.0));
  float dD = displNorm(wPos - vec3(0.0, 0.0, uStepZ));
  float dU = displNorm(wPos + vec3(0.0, 0.0, uStepZ));
  float gradX = (dR - dL) / (2.0 * uStepX);
  float gradZ = (dU - dD) / (2.0 * uStepZ);

  // Step 3: tree classification — centre point only.
  // normalY is derived from the baked gradient, matching the vertex shader exactly:
  //   vTerrainWorldNormal = normalize(vec3(-gradX, 1.0, -gradZ))
  // This gives identical tree placement to the fragment shader (no approximation).
  float normalY = inversesqrt(1.0 + gradX * gradX + gradZ * gradZ);
  TerrainClassification tc = classifyTerrain(elev, ridge, normalY, wPos.xz);

  // Step 4: small elevation bias — lifts tree-covered surfaces slightly so trees
  // stand above surrounding grass.  Applied after gradient baking; the bias is
  // ~0.01 at most, making its contribution to the gradient negligible.
  elev = clamp(elev + (tc.isTree ? tc.trees / 100.0 : 0.0), 0.0, 1.0);

  // ── Write outputs ─────────────────────────────────────────────────────────
  fragColor = packElevationChannel(elev, gradX, gradZ);

  // Attribute texture — four continuous float channels, all safe for LinearFilter:
  //   R = ridgeMap     [-1, 1]  (direct)
  //   G = erosionDepth [0, 1]   (packed: * 0.5 + 0.5; unpack: * 2.0 - 1.0)
  //   B = trees        float    (direct; threshold 0.36 = isTree)
  //   A = hardness     [0, 1]   (direct)
  fragAttr = vec4(ridge, erosionDepth * 0.5 + 0.5, tc.trees, tc.hardness);
}
`;
