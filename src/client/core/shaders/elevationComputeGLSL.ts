/**
 * Elevation compute shader body — GPU bake pass (GLSL ES 3.0 fragment).
 *
 * Static pass: elevation data only — no classification, no tree density.
 *
 * Each texel is evaluated at a 3D position on the planet (see patchBakeGLSL),
 * so the result does not depend on the shape of the patch grid.
 *
 * MRT output:
 *   location 0 — elevation texture
 *     R = rawElev [0,1]   GBA = surface gradient (3D tangent vector, per terrain unit)
 *   location 1 — attribute texture
 *     R = ridgeMap [-1,1]  G = erosionDepth packed (×0.5+0.5)
 *     B = weight of the ocean biome [0,1]  A = unused
 *
 * Biomes (see biomeGLSL): the noise elevation is blended with the per-biome
 * parameters, using weights derived from the biome boundaries of the patch.
 * The gradient is taken on the blended elevation, so transitions shade correctly.
 *
 * Used as the fragment shader of a GLSL3 THREE.ShaderMaterial (TerrainPatchBaker).
 */

import { terrainSampleGLSL }  from '@core/shaders/terrainSampleGLSL';
import { patchBakeGLSL }      from '@core/shaders/patchBakeGLSL';
import { simplexNoiseGLSL }   from '@core/noise/simplexGLSL';
import { perlinNoiseGLSL }    from '@core/noise/perlinGLSL';
import { fractalNoise3GLSL }  from '@core/noise/fractalNoise3GLSL';
import { erosion3GLSL }       from '@core/shaders/erosion3GLSL';
import { terrainGLSL }        from '@core/shaders/terrainGLSL';
import { terrainNoiseGLSL }   from '@core/shaders/terrainNoiseGLSL';
import { biomeGLSL }          from '@core/shaders/biomeGLSL';
import { BIOME_OCEAN }        from '@core/terrain/BiomeBoundaries';

export const elevationComputeGLSL = /* glsl */`

${terrainSampleGLSL}
${patchBakeGLSL}

uniform int   uNoiseType;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
uniform vec3  uGaussCenter;
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
${fractalNoise3GLSL}
${erosion3GLSL}
${terrainGLSL}
${terrainNoiseGLSL}
${biomeGLSL}

// Final (biome-blended) elevation at P.  up is the surface direction at the texel.
float bakedElevation(vec3 P, vec3 up) {
  return biomeBlendElevation(displNorm(P, up), biomeWeights(normalize(P)));
}

void main() {
  vec3 up = patchBakeDir();
  vec3 P  = up * uPlanetRadius;

  float noiseElev, ridge, erosionDepth;
  computeElevation(P, up, noiseElev, ridge, erosionDepth);

  vec4  biome   = biomeWeights(up);
  float rawElev = biomeBlendElevation(noiseElev, biome);
  float relief  = biomeReliefFactor(biome);

  // Surface gradient by central differences along an orthonormal tangent basis.
  // The step is the texel footprint, so the gradient matches what the grid resolves.
  vec3 t1, t2;
  terrainTangentBasis(up, t1, t2);
  float h  = max(uTexelSize, 1e-6);
  float dL = bakedElevation(P - t1 * h, up);
  float dR = bakedElevation(P + t1 * h, up);
  float dD = bakedElevation(P - t2 * h, up);
  float dU = bakedElevation(P + t2 * h, up);
  vec3 grad = (t1 * (dR - dL) + t2 * (dU - dD)) / (2.0 * h);

  fragColor = packElevationChannel(rawElev, grad);
  fragAttr  = vec4(ridge * relief, erosionDepth * relief * 0.5 + 0.5, biome[${BIOME_OCEAN}], 0.0);
}
`;
