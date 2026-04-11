/**
 * Vertex shader for the Shader Demo tab — flat terrain.
 *
 * The geometry is a flat NxN grid on the XZ plane (y = 0).
 * FBM noise is sampled at each vertex's XZ position and used to
 * displace the vertex upward along Y, producing a heightfield terrain.
 *
 * Noise type is selected at runtime via uNoiseType:
 *   0 = Classic Perlin (seeded via uPermTex)
 *   1 = Simplex (analytic, no texture needed)
 *
 * Uniforms (Perlin only):
 *   uPermTex           – 256×1 R32F permutation texture (seeded noise)
 *
 * Uniforms (per-material):
 *   uNoiseType         – 0 = Perlin, 1 = Simplex
 *   uNoiseScale        – frequency multiplier for FBM input
 *   uNoiseOctaves      – FBM octave count
 *   uNoisePersistence  – amplitude decay per octave
 *   uNoiseLacunarity   – frequency growth per octave
 *   uAmplitude         – max Y displacement in world units
 *
 * Varyings out:
 *   vElevation  – normalised elevation [0, 1]
 */

import { perlinNoiseGLSL } from '@core/noise/perlinGLSL';
import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';

export const demoVertexShader = /* glsl */`

${perlinNoiseGLSL}
${simplexNoiseGLSL}

uniform int   uNoiseType;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
uniform float uAmplitude;

out float vElevation;

void main() {
  // Sample noise in world space so adjacent patches share the same noise field
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 p = worldPos * uNoiseScale;

  float noise;
  if (uNoiseType == 1) {
    noise = simplexFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
  } else {
    noise = perlinFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
  }

  float elev  = (noise * 0.5 + 0.5) * uAmplitude;
  vElevation  = (uAmplitude > 0.0) ? elev / uAmplitude : 0.0;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, elev, position.z, 1.0);
}
`;
