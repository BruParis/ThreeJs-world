/**
 * Vertex shader for the layer overlay panels.
 * Passes UV coordinates through for layer sampling in the fragment shader.
 */
export const layerOverlayVertexShader = /* glsl */`

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
