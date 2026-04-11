/**
 * Fragment shader for the layer overlay panels.
 *
 * Displays one of two layers in greyscale depending on uLayerIndex:
 *   0 = diagonal gradient (bottom-left → top-right)
 *   1 = simplex FBM noise
 *
 * Uniforms:
 *   uLayerIndex       – which layer to display
 *   uNoiseScale       – frequency multiplier (layer 1 only)
 *   uNoiseOctaves     – FBM octave count (layer 1 only)
 *   uNoisePersistence – amplitude decay per octave (layer 1 only)
 *   uNoiseLacunarity  – frequency growth per octave (layer 1 only)
 */

import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';

export const layerOverlayFragmentShader = /* glsl */`

${simplexNoiseGLSL}

in vec2 vUv;
out vec4 fragColor;

uniform int   uLayerIndex;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;

void main() {
  float layer;

  if (uLayerIndex == 0) {
    // Diagonal gradient: (0,0) bottom-left → (1,1) top-right
    layer = vUv.x * 0.5 + vUv.y * 0.5;
  } else {
    // Simplex FBM noise sampled at UV-derived coordinates
    vec3 p = vec3(vUv, 0.0) * uNoiseScale;
    layer = simplexFbm(p, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity) * 0.5 + 0.5;
  }

  // Thin grey border to delineate panel edges
  float bw = 0.025;
  bool onBorder = vUv.x < bw || vUv.x > 1.0 - bw || vUv.y < bw || vUv.y > 1.0 - bw;
  if (onBorder) {
    fragColor = vec4(0.75, 0.75, 0.75, 1.0);
  } else {
    fragColor = vec4(layer, layer, layer, 1.0);
  }
}
`;
