/**
 * Detail noise — reusable GLSL + uniform helpers.
 *
 * This module is the two-sided contract for the supplemental noise feature:
 *   - Producer side: suppNoiseVert / suppNooseFrag are the shaders used by
 *     SuppNoiseGL to bake an FBM value-noise texture into a render target.
 *   - Consumer side: detailNoiseFragPreamble is injected into the terrain
 *     fragment shader to sample that texture and perturb surface normals.
 *
 * The baked texture encodes:
 *   R = accumulated noise value  (FBM, 8 octaves, zero-centered [-1, 1])
 *   G = accumulated dNoise/du    (analytical derivative)
 *   B = accumulated dNoise/dv    (analytical derivative)
 *
 * Exposes:
 *   suppNoiseVert                    – GLSL vertex shader for the bake pass
 *   suppNoiseFrag                    – GLSL fragment shader for the bake pass
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

// ── Producer side: bake-pass shaders ─────────────────────────────────────────

export const suppNoiseVert = /* glsl */`
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const suppNoiseFrag = /* glsl */`
precision highp float;

uniform vec2  uBufferSize;
uniform vec2  uWorldOrigin;  // world-space XZ of the patch's (0,0) UV corner
uniform float uWorldSize;    // world-space extent of the patch (patchSize)

#define M1 1597334677U     //1719413*929
#define M2 3812015801U     //140473*2467*11

out vec4 fragColor;

// Value noise with analytical derivatives (IQ-style).
// Returns vec3(value [-1,1], dvalue/du, dvalue/dv).
// Alternative (lower quality) hash kept for reference:
//   float hm_hash(vec2 p) {
//     float h = dot(p, vec2(127.1, 311.7));
//     return -1.0 + 2.0 * fract(sin(h) * 43758.5453123);
//   }

// Based on https://www.shadertoy.com/view/4dVBzz — much improved version,
// still comparable in speed to fract(sin()) but with much better bit quality.
float hm_hash(vec2 q)
{
    uvec2 uq = uvec2(ivec2(q)) * uvec2(M1, M2);
    uint n = uq.x ^ uq.y;
    n = n * (n ^ (n >> 15u));
    // float(n) * (1.0/float(0xffffffffU)) gives [0, 1];
    // remap to [-1, 1] so the noise is zero-centered (needed for normal perturbation).
    return float(n) * (2.0/float(0xffffffffU)) - 1.0;
}

vec3 noised(vec2 x) {
  vec2 i  = floor(x);
  vec2 f  = fract(x);
  vec2 u  = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  vec2 du = 30.0*f*f*(f*(f - 2.0) + 1.0);

  float a = hm_hash(i + vec2(0.0, 0.0));
  float b = hm_hash(i + vec2(1.0, 0.0));
  float c = hm_hash(i + vec2(0.0, 1.0));
  float d = hm_hash(i + vec2(1.0, 1.0));

  float k0 = a;
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;

  return vec3(k0 + k1*u.x + k2*u.y + k4*u.x*u.y,
              du.x * (k1 + k4*u.y),
              du.y * (k2 + k4*u.x));
}

void main() {
  vec2 uv      = gl_FragCoord.xy / uBufferSize;
  vec2 worldXZ = uWorldOrigin + uv * uWorldSize;

  vec3 color = vec3(0.0);
  float a = 0.5;
  float f = 1.0;
  for (int i = 0; i < 8; i++) {
    color += noised(worldXZ * f) * a;
    a *= 0.95;
    f *= 2.0;
  }

  fragColor = vec4(color, 1.0);
}
`;

// ── Consumer side: terrain fragment-shader declarations ───────────────────────

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
