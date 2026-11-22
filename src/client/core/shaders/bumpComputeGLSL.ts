/**
 * Bump compute shader (GLSL ES 3.0 fragment).
 *
 * Bakes the two normal-perturbation signals that are too expensive to evaluate
 * per fragment at render time.  Both are sampled in 3D (see patchBakeGLSL) and
 * stored as 3D vectors tangent to the undisplaced surface.
 *
 * MRT output:
 *   location 0 — water: gradient of the wave height field (strength factor = 1;
 *                the render shader multiplies by uWaterNormalStrength)
 *   location 1 — trees: canopy tilt vector, components in [-1, 1]
 *
 * Signals finer than the baked texel grid are faded out.
 */

import { terrainSampleGLSL } from '@core/shaders/terrainSampleGLSL';
import { patchBakeGLSL }     from '@core/shaders/patchBakeGLSL';
import { simplexNoiseGLSL }  from '@core/noise/simplexGLSL';
import { fractalNoise3GLSL } from '@core/noise/fractalNoise3GLSL';

export const bumpComputeGLSL = /* glsl */`

${terrainSampleGLSL}
${patchBakeGLSL}
${simplexNoiseGLSL}
${fractalNoise3GLSL}

uniform float uWaterNormalFreq;
uniform float uTreeBumpFreq;

layout(location = 0) out vec4 fragWater;
layout(location = 1) out vec4 fragTree;

float _waveHeight(vec3 p) {
  return snoise(p) * 0.65 + snoise(p * 2.13) * 0.35;
}

void main() {
  vec3 up = patchBakeDir();
  vec3 P  = up * uPlanetRadius;

  vec3 t1, t2;
  terrainTangentBasis(up, t1, t2);

  // ── Water normal gradient (finite differences, strength factor = 1) ──────
  vec3  pw  = P * uWaterNormalFreq;
  float eps = 0.3;
  float h0  = _waveHeight(pw);
  float d1  = (_waveHeight(pw + t1 * eps) - h0) / eps;
  float d2  = (_waveHeight(pw + t2 * eps) - h0) / eps;
  float waterFade = terrainBandWeight(1.0 / max(uWaterNormalFreq, 1e-6), uBandTexel);
  fragWater = vec4((t1 * d1 + t2 * d2) * waterFade, 0.0);

  // ── Tree canopy tilt ─────────────────────────────────────────────────────
  // Three decorrelated noise samples make a random vector; its tangent part is
  // the tilt.  (Projecting a 3D vector avoids depending on the tangent basis.)
  vec3 pt = P * uTreeBumpFreq;
  vec3 tilt = vec3(
    snoise(pt),
    snoise(pt + vec3(31.7, 0.0, 0.0)),
    snoise(pt + vec3(0.0, 47.3, 0.0))
  );
  tilt -= up * dot(tilt, up);
  float treeFade = terrainBandWeight(1.0 / max(uTreeBumpFreq, 1e-6), uBandTexel);
  fragTree = vec4(tilt * treeFade, 0.0);
}
`;
