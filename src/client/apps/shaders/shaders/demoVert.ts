/**
 * Vertex shader for the Shader Demo tab.
 *
 * Elevation is pre-computed by TerrainElevationGL (WebGL2 fragment shader) and
 * uploaded to uElevationTex.  This shader only displaces geometry and derives
 * surface normals from the texture via finite differences.
 *
 * Uniforms:
 *   uElevationTex   – R32F texture, normalised elevation [0, 1] for the full terrain
 *   uAmplitude      – max Y displacement in world units
 *   uPatchHalfSize  – half the total terrain extent (world units)
 *
 * Varyings out:
 *   vElevation  – normalised elevation [0, 1]
 *   vWorldPos   – displaced world position (Y = terrain height)
 *   vNormal     – smooth surface normal computed by finite-differencing the elevation texture
 */

export const demoVertexShader = /* glsl */`

uniform sampler2D uElevationTex;
uniform float     uAmplitude;
uniform float     uPatchHalfSize;

out float vElevation;
out vec3  vWorldPos;
out vec3  vNormal;

const float SEA_LEVEL = 0.35;

// Map world XZ to UV in the elevation texture [0, 1].
vec2 elevUV(vec2 worldXZ) {
  return (worldXZ + uPatchHalfSize) / (uPatchHalfSize * 2.0);
}

float sampleElev(vec2 worldXZ) {
  return texture(uElevationTex, elevUV(worldXZ)).r;
}

float elevToDisplY(float noise) {
  return max(0.0, (noise - SEA_LEVEL) / (1.0 - SEA_LEVEL) * uAmplitude);
}

void main() {
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;

  float noise  = sampleElev(worldPos.xz);
  float displY = elevToDisplY(noise);

  vElevation = noise;
  vWorldPos  = vec3(worldPos.x, displY, worldPos.z);

  // Normals via finite differences using one texel step in world space.
  vec2 texelSz = (uPatchHalfSize * 2.0) / vec2(textureSize(uElevationTex, 0));
  float hL = elevToDisplY(sampleElev(worldPos.xz + vec2(-texelSz.x,       0.0)));
  float hR = elevToDisplY(sampleElev(worldPos.xz + vec2( texelSz.x,       0.0)));
  float hD = elevToDisplY(sampleElev(worldPos.xz + vec2(       0.0, -texelSz.y)));
  float hU = elevToDisplY(sampleElev(worldPos.xz + vec2(       0.0,  texelSz.y)));
  vNormal = normalize(vec3(hL - hR, 2.0 * texelSz.x, hD - hU));

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, displY, position.z, 1.0);
}
`;
