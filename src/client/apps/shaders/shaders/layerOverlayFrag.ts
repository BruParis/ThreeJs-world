/**
 * Fragment shader for the layer overlay panels.
 *
 * UV space is mapped to the same world XZ range as the terrain so the panels
 * show an exact top-down preview of what the GPU computes (UV.x → worldX,
 * UV.y → worldZ with Y-flip so the panel aligns with the 3D view).
 *
 * uLayerIndex acts as an early-return breakpoint through the pipeline:
 *   0 = gradient  — diagonal XZ gradient (terrain l1)
 *   1 = noise     — raw FBM result (same type as terrain)
 *   2 = blended   — mix(gradient, noise, uLayerMix)
 *   3 = erosion   — blended + hydraulic erosion pass
 *                   (falls back to blended when noiseType == 2 or erosion disabled)
 *
 * uNoiseType selects the noise algorithm (0=simplex, 1=perlin, 2=heightmap, 3=gaussian, 4=fractalNoise).
 */

import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';
import { perlinNoiseGLSL }  from '@core/noise/perlinGLSL';
import { erosionGLSL }      from '@core/shaders/erosionGLSL';
import { terrainGLSL }      from '@core/shaders/terrainGLSL';
import { heightmapGLSL }    from '@core/noise/heightmapGLSL';
import { fractalNoiseGLSL } from '@core/noise/fractalNoiseGLSL';

export const layerOverlayFragmentShader = /* glsl */`

${simplexNoiseGLSL}
${perlinNoiseGLSL}
${erosionGLSL}
${terrainGLSL}

in vec2 vUv;
out vec4 fragColor;

uniform int   uLayerIndex;
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
uniform float uLayerMix;
uniform float uPatchHalfSize;

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
uniform float uElevOffset;

const float SEA_LEVEL = 0.35;

${heightmapGLSL}
${fractalNoiseGLSL}

// Value-noise FBM for heightmap preview (2D, no erosion uniforms needed).
float hmHash(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return -1.0 + 2.0 * fract(sin(h) * 43758.5453123);
}
float valueFbm(vec2 p) {
  float value = 0.0;
  float amp   = 0.5;
  float freq  = 1.0;
  for (int i = 0; i < uNoiseOctaves; i++) {
    vec2 i2   = floor(p * freq);
    vec2 f2   = fract(p * freq);
    vec2 u    = f2 * f2 * (3.0 - 2.0 * f2);
    float v00 = hmHash(i2);
    float v10 = hmHash(i2 + vec2(1.0, 0.0));
    float v01 = hmHash(i2 + vec2(0.0, 1.0));
    float v11 = hmHash(i2 + vec2(1.0, 1.0));
    value += amp * mix(mix(v00, v10, u.x), mix(v01, v11, u.x), u.y);
    amp  *= uNoisePersistence;
    freq *= uNoiseLacunarity;
  }
  return value * 0.5 + 0.5;
}

// UV [0,1] → world XZ matching the terrain coordinate frame:
//   UV.x increases left→right  = world +X
//   UV.y increases bottom→top  = world -Z  (flipped: camera sits at +Z)
float computeGradientAtWorld(float worldX, float worldZ) {
  return clamp((worldX + worldZ) / (2.0 * uPatchHalfSize) + 0.5, 0.0, 1.0);
}

float computeGaussianAtWorld(float worldX, float worldZ) {
  float sigma = max(uGaussSigma * uPatchHalfSize, 0.001);
  return uGaussAmplitude * exp(-(worldX * worldX + worldZ * worldZ) / (2.0 * sigma * sigma));
}

float computeNoiseAtWorld(float worldX, float worldZ) {
  if (uNoiseType == 3) return computeGaussianAtWorld(worldX, worldZ);
  vec3 p = vec3(worldX, 0.0, worldZ) * uNoiseScale;
  if (uNoiseType == 1)
    return perlinFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity) * 0.5 + 0.5;
  else if (uNoiseType == 2)
    return valueFbm(vec2(worldX, worldZ) * uNoiseScale);
  else if (uNoiseType == 4)
    return uFractalAmp * FractalNoise(vec2(worldX, worldZ), uFractalFreq, uFractalOctaves, uFractalLacunarity, uFractalGain).x * 0.5 + 0.5;
  else
    return simplexFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity) * 0.5 + 0.5;
}

// Used for neighbour samples when computing the erosion slope.
float computeBaseAtWorld(float worldX, float worldZ) {
  return mix(
    computeGradientAtWorld(worldX, worldZ),
    computeNoiseAtWorld(worldX, worldZ),
    uLayerMix
  );
}

float computeLayer(vec2 uv) {
  float worldX =  (uv.x - 0.5) * 2.0 * uPatchHalfSize;
  float worldZ = -(uv.y - 0.5) * 2.0 * uPatchHalfSize;

  // Step 0: diagonal XZ gradient
  float l1 = computeGradientAtWorld(worldX, worldZ);
  if (uLayerIndex == 0) return l1;

  // Step 1: raw noise FBM
  float l2 = computeNoiseAtWorld(worldX, worldZ);
  if (uLayerIndex == 1) return l2;

  // Step 2: gradient + noise blended
  float base = mix(l1, l2, uLayerMix);
  if (uLayerIndex == 2) return base;

  // Step 3: hydraulic erosion pass via applyTerrain.
  // Heightmap mode has erosion built in — show blended as fallback.
  // base is [0,1]; applyTerrain expects [-1,1] raw input, so convert: raw = base*2-1,
  // rawSlope = slope_grad*2 (gradient in [-1,1] space = gradient in [0,1] space * 2).
  float eroded = base;
  float ridge  = 0.0;
  if (uNoiseType != 2 && uErosionEnabled != 0) {
    float GE = 0.5 / max(uNoiseScale, 0.5);
    float fL = computeBaseAtWorld(worldX - GE, worldZ);
    float fR = computeBaseAtWorld(worldX + GE, worldZ);
    float fD = computeBaseAtWorld(worldX, worldZ - GE);
    float fU = computeBaseAtWorld(worldX, worldZ + GE);
    vec2 slope_grad = vec2(fR - fL, fU - fD) / (2.0 * GE);
    eroded = applyTerrain(
      vec2(worldX, worldZ), base * 2.0 - 1.0, slope_grad * 2.0, 1,
      uErosionOctaves, uErosionScale, uErosionStrength,
      uErosionGullyWeight, uErosionDetail, uErosionLacunarity,
      uErosionGain, uErosionCellScale, uErosionNormalization,
      uErosionRidgeRounding, uErosionCreaseRounding,
      ridge
    );
  }
  if (uLayerIndex == 3) return eroded;

  // Step 5: ridgemap — erosion gully signal.
  // Negative values = ridge / gully carved by erosion → shown bright.
  // Positive / flat areas → dark. Nonlinear mapping to maximise contrast.
  if (uLayerIndex == 5) return pow(clamp(-ridge, 0.0, 1.0), 0.5);

  // Step 4: water-level clamping — mirrors elevToDisplY() in the vertex shader.
  return max(0.0, (eroded + uElevOffset - SEA_LEVEL) / (1.0 - SEA_LEVEL));
}

void main() {
  float layer = computeLayer(vUv);

  float bw = 0.025;
  bool onBorder = vUv.x < bw || vUv.x > 1.0 - bw || vUv.y < bw || vUv.y > 1.0 - bw;
  fragColor = onBorder
    ? vec4(0.75, 0.75, 0.75, 1.0)
    : vec4(layer, layer, layer, 1.0);
}
`;
