/**
 * Fragment shader for the Shader Demo tab.
 *
 * Varyings in:
 *   vElevation  – normalised elevation [0, 1]
 *   vWorldPos   – displaced world position
 *   vNormal     – smooth surface normal
 *
 * Supplemental noise (optional):
 *   uSuppNoiseTex     – animated FBM value-noise texture (R=value, G=du, B=dv)
 *   uSuppNoiseEnabled – 1 to apply, 0 to skip
 *   uSuppNoiseStrength – scales the normal perturbation from the noise derivatives
 *   uPatchHalfSize    – terrain half-extent (world units), used to compute supp UV
 */

import { terrainColorGLSL } from '@core/shaders/terrainColorGLSL';

export const demoFragmentShader = /* glsl */`

${terrainColorGLSL}

in float vElevation;
in vec3  vWorldPos;
in vec3  vNormal;
out vec4 fragColor;

uniform sampler2D uSuppNoiseTex;
uniform int       uSuppNoiseEnabled;
uniform float     uSuppNoiseStrength;
uniform float     uPatchHalfSize;

void main() {
  vec3 normal = vNormal;

  if (uSuppNoiseEnabled == 1) {
    // Map world XZ to supp noise UV [0, 1].
    vec2 suppUV   = (vWorldPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
    vec3 suppData = texture(uSuppNoiseTex, suppUV).xyz;
    // suppData.yz are the analytical noise derivatives — perturb the surface normal.
    normal = normalize(normal + vec3(suppData.y, 0.0, suppData.z) * uSuppNoiseStrength);
  }

  fragColor = vec4(terrainColor(vElevation, vWorldPos, normal), 1.0);
}
`;
