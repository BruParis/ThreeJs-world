/**
 * Detail noise — reusable GLSL + uniform helpers.
 *
 * This module is the two-sided contract for the supplemental noise feature:
 *   - Producer side: detailNoiseComputeGLSL is the bake-pass fragment shader
 *     (run by TerrainPatchBaker) that fills the detail noise texture.
 *   - Consumer side: terrainMaterial.frag.glsl samples that texture and
 *     perturbs the surface normals.
 *
 * The noise is sampled in 3D (see patchBakeGLSL).  The baked texture encodes:
 *   R   = accumulated noise value (FBM, 8 octaves, zero-centred [-1, 1])
 *   GBA = accumulated noise gradient, projected on the surface (3D tangent vector)
 *
 * Exposes:
 *   detailNoiseComputeGLSL           – GLSL fragment shader for the bake pass
 *   DetailNoiseUniformState          – TS interface for owned values
 *   createDetailNoiseUniforms(s)     – creates shader.uniforms entries
 *   syncDetailNoiseUniforms(u, s)    – updates existing entries
 */

import * as THREE from 'three';
import { patchBakeGLSL }     from '@core/shaders/patchBakeGLSL';
import { fractalNoise3GLSL } from '@core/noise/fractalNoise3GLSL';

// ── Producer side: bake-pass shader ──────────────────────────────────────────

export const detailNoiseComputeGLSL = /* glsl */`

${patchBakeGLSL}
${fractalNoise3GLSL}

layout(location = 0) out vec4 fragColor;

void main() {
  vec3 up = patchBakeDir();
  vec3 P  = up * uPlanetRadius;

  vec4 acc = vec4(0.0);
  float a = 0.5;
  float f = 2.0;
  for (int i = 0; i < 8; i++) {
    float w = terrainBandWeight(1.0 / f, uBandTexel);
    if (w > 0.0) acc += noised3(P * f) * (a * w);
    a *= 0.95;
    f *= 2.0;
  }

  vec3 grad = acc.yzw - up * dot(acc.yzw, up);
  fragColor = vec4(acc.x, grad);
}
`;

// ── Uniform helpers ───────────────────────────────────────────────────────────

export interface DetailNoiseUniformState {
  detailNoiseTexture:  THREE.Texture | null;
  detailNoiseEnabled:  boolean;
  detailNoiseStrength: number;
}

export function createDetailNoiseUniforms(s: DetailNoiseUniformState): Record<string, THREE.IUniform> {
  return {
    uDetailNoiseTex:      { value: s.detailNoiseTexture },
    uDetailNoiseEnabled:  { value: s.detailNoiseEnabled ? 1 : 0 },
    uDetailNoiseStrength: { value: s.detailNoiseStrength },
  };
}

export function syncDetailNoiseUniforms(u: Record<string, THREE.IUniform>, s: DetailNoiseUniformState): void {
  u.uDetailNoiseTex.value      = s.detailNoiseTexture;
  u.uDetailNoiseEnabled.value  = s.detailNoiseEnabled ? 1 : 0;
  u.uDetailNoiseStrength.value = s.detailNoiseStrength;
}
