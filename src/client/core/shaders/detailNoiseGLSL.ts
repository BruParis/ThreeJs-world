/**
 * Detail noise — reusable GLSL + uniform helpers.
 *
 * Consumer side for the supplemental noise texture produced by SuppNoiseGL.
 * The texture is sampled once per fragment and used to perturb surface normals
 * and provide per-layer color breakup variation.
 *
 * Exposes:
 *   detailNoiseFragPreamble          – GLSL fragment-shader uniform declarations
 *   DetailNoiseUniformState          – TS interface for owned values
 *   createDetailNoiseUniforms(s)     – creates shader.uniforms entries
 *   syncDetailNoiseUniforms(u, s)    – updates existing entries
 *
 * Note: uPatchHalfSize and uElevOffset are re-declared here for fragment-shader
 * use but are registered and synced by the terrain-vertex module (they drive
 * vertex displacement and only need one JS entry in shader.uniforms).
 */

import * as THREE from 'three';

export const detailNoiseFragPreamble = /* glsl */`
uniform sampler2D uDetailNoiseTex;
uniform int       uDetailNoiseEnabled;
uniform float     uDetailNoiseStrength;
uniform float     uPatchHalfSize;
uniform float     uElevOffset;
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
