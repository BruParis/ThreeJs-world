/**
 * Vertex shader for tectonic tile LOD patches.
 *
 * Tile patches are flat data overlays (plate / geology / LOD level colors):
 * vertices stay on the sphere, slightly above the dual mesh.  Terrain relief is
 * rendered by TerrainPatchOperation, not here.
 *
 * Varyings out
 *   vSphereNormal – unit-sphere direction (polygon tests in the fragment shader)
 */
export const tileVertexShader = /* glsl */`

uniform float uSphereOffset;   // sphere radius (anti z-fight offset above the dual mesh)

out vec3 vSphereNormal;

void main() {
  vec3 n = normalize(position);
  vSphereNormal = n;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uSphereOffset * n, 1.0);
}
`;
