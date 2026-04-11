/**
 * Vertex shader for the Shader Demo tab — flat terrain.
 *
 * Elevation is computed by blending two layers:
 *   Layer 1 – diagonal gradient across the full patch extent
 *   Layer 2 – simplex FBM noise
 *
 * The blend is controlled by uLayerMix:
 *   0.0 → gradient only
 *   1.0 → simplex noise only
 *   0.5 → equal blend of both
 *
 * Uniforms:
 *   uPermTex           – 256×1 R32F permutation texture (unused, kept for compat)
 *   uNoiseScale        – frequency multiplier for FBM input
 *   uNoiseOctaves      – FBM octave count
 *   uNoisePersistence  – amplitude decay per octave
 *   uNoiseLacunarity   – frequency growth per octave
 *   uAmplitude         – max Y displacement in world units
 *   uLayerMix          – blend between gradient (0) and simplex noise (1)
 *   uPatchHalfSize     – half the total patch extent (world units), for gradient normalisation
 *
 * Varyings out:
 *   vElevation  – normalised elevation [0, 1]
 */

import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';

export const demoVertexShader = /* glsl */`

${simplexNoiseGLSL}

uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
uniform float uAmplitude;
uniform float uLayerMix;
uniform float uPatchHalfSize;

out float vElevation;

void main() {
  // World-space position so adjacent patches share the same noise field
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;

  // ── Layer 1: diagonal gradient ──────────────────────────────────────────────
  // Ranges from 0 at (-half, -half) to 1 at (+half, +half).
  float layer1 = clamp(
    (worldPos.x + worldPos.z) / (2.0 * uPatchHalfSize) + 0.5,
    0.0, 1.0
  );

  // ── Layer 2: simplex FBM noise ───────────────────────────────────────────────
  vec3 p = worldPos * uNoiseScale;
  float layer2 = simplexFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity) * 0.5 + 0.5;

  // ── Blend ───────────────────────────────────────────────────────────────────
  float noise = mix(layer1, layer2, uLayerMix);

  // Sea level matches the ocean threshold in the fragment shader.
  // Elevation is signed: negative below sea level, positive above.
  const float SEA_LEVEL = 0.35;
  float elev = (noise - SEA_LEVEL) / (1.0 - SEA_LEVEL) * uAmplitude;

  // Pass raw noise as elevation so the fragment shader colour bands are unchanged.
  vElevation = noise;

  // Underwater vertices sit at Y=0 (ocean surface) but keep their colour.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, max(0.0, elev), position.z, 1.0);
}
`;
