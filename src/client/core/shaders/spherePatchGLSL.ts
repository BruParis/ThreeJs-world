/**
 * Sphere-patch coordinate utility — reusable GLSL fragment.
 *
 * Provides a seamless 2D coordinate system for sphere-LOD patches by
 * projecting each unit-sphere direction onto the dominant cube face (the
 * "cube-face UV" projection). Adjacent patches on the same cube face share
 * the same UV space, so there are no seams within a face; seams at cube-face
 * boundaries are acceptable because patches never straddle them.
 *
 * Exposes:
 *   vec2 sphereToPatchXZ(vec3 n, float scale)
 *     n     – unit-sphere direction
 *     scale – multiplied onto cube UV ∈ [-1, 1] to reach the noise domain
 *             (same role as noiseScale in the flat-terrain pipeline, where
 *              p = worldXZ * noiseScale).
 *     Returns 2D terrain position p suitable for noise / erosion sampling.
 */
export const spherePatchGLSL = /* glsl */`

// Projects a unit-sphere direction to cube-face UV ∈ [-1, 1]^2, then scales.
// The dominant absolute component selects the cube face; the other two are
// divided by it (projective UV), yielding seamless 2D coords within each face.
vec2 sphereToPatchXZ(vec3 n, float scale) {
  vec3 a = abs(n);
  vec2 uv;
  if      (a.x >= a.y && a.x >= a.z) uv = n.yz / a.x;
  else if (a.y >= a.x && a.y >= a.z) uv = n.xz / a.y;
  else                                 uv = n.xy / a.z;
  return uv * scale;
}

`;
