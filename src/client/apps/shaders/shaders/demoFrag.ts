/**
 * Fragment shader for the Shader Demo tab.
 *
 * Varyings in:
 *   vElevation  – normalised elevation [0, 1]
 *   vWorldPos   – displaced world position
 *   vNormal     – smooth surface normal
 */

import { terrainColorGLSL } from '@core/shaders/terrainColorGLSL';

export const demoFragmentShader = /* glsl */`

${terrainColorGLSL}

in float vElevation;
in vec3  vWorldPos;
in vec3  vNormal;
out vec4 fragColor;

void main() {
  fragColor = vec4(terrainColor(vElevation, vWorldPos, vNormal), 1.0);
}
`;
