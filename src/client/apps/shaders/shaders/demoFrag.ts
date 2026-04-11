/**
 * Fragment shader for the Shader Demo tab.
 *
 * Colours each fragment by its elevation value using either a terrain
 * colormap or a simple greyscale ramp.
 *
 * Uniforms:
 *   uColorMode  – 0 = terrain colormap, 1 = greyscale
 *
 * Varyings in:
 *   vElevation  – normalised elevation [0, 1] from vertex shader
 */
export const demoFragmentShader = /* glsl */`

in float vElevation;
out vec4 fragColor;

uniform int uColorMode; // 0 = terrain, 1 = greyscale

void main() {
  float e = clamp(vElevation, 0.0, 1.0);

  if (uColorMode == 1) {
    fragColor = vec4(e, e, e, 1.0);
    return;
  }

  // Terrain colormap — four elevation bands
  vec3 color;
  if (e < 0.35) {
    // Ocean: deep navy → light cyan
    color = mix(vec3(0.05, 0.10, 0.40), vec3(0.15, 0.55, 0.80), e / 0.35);
  } else if (e < 0.50) {
    // Coastal / lowland: sandy beach → vivid green
    color = mix(vec3(0.85, 0.80, 0.55), vec3(0.30, 0.65, 0.25), (e - 0.35) / 0.15);
  } else if (e < 0.75) {
    // Highland: green → earthy brown
    color = mix(vec3(0.30, 0.65, 0.25), vec3(0.55, 0.45, 0.30), (e - 0.50) / 0.25);
  } else {
    // Mountain peaks: rocky brown → snow white
    color = mix(vec3(0.55, 0.45, 0.30), vec3(1.00, 1.00, 1.00), (e - 0.75) / 0.25);
  }

  fragColor = vec4(color, 1.0);
}
`;
