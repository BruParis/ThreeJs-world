/**
 * Fragment shader for tectonic tile LOD patches.
 *
 * Determines which tectonic tile polygon the fragment belongs to by testing
 * exact spherical polygon containment for each tile supplied via uTileData.
 * Uses the undisplaced sphere normal (vSphereNormal) so elevation does not
 * distort plate boundaries.
 *
 * Data texture layout  (width = numTiles, height = 1 + MAX_VERTS, RGBA Float)
 *   Row 0 :  (r, g, b, numVertices)   — tile color and polygon vertex count
 *   Row 1+j: (vx, vy, vz, 0)          — j-th polygon vertex (unit sphere)
 *
 * Containment test (CW winding from outside sphere — dual graph built via loopCW)
 *   For each directed edge va→vb in CW order:  dot(cross(va, vb), p) <= 0
 *   A point p is inside iff it passes all edge tests.
 *
 * Output: declare `out vec4 fragColor` explicitly.
 * Three.js ShaderMaterial + GLSL3 does NOT inject pc_fragColor for custom
 * shaders — the user owns the output declaration entirely.
 */
export const tileFragmentShader = /* glsl */`

uniform highp sampler2D uTileData;
uniform int uNumTiles;
uniform int uColorMode;  // 0 = tile color (plate/geology), 1 = elevation (black→white)

in vec3  vSphereNormal;
in float vElevation;

out vec4 fragColor;

const int MAX_TILES = 256;
const int MAX_VERTS = 8;

void main() {
  vec3 p = normalize(vSphereNormal);

  for (int i = 0; i < MAX_TILES; i++) {
    if (i >= uNumTiles) break;

    vec4 meta  = texelFetch(uTileData, ivec2(i, 0), 0);
    vec3 color = meta.rgb;
    int  nv    = int(meta.a + 0.5);

    if (nv < 3) continue;

    bool inside = true;
    for (int j = 0; j < MAX_VERTS; j++) {
      if (j >= nv) break;
      vec3 va = texelFetch(uTileData, ivec2(i, 1 + j),             0).xyz;
      vec3 vb = texelFetch(uTileData, ivec2(i, 1 + (j + 1) % nv), 0).xyz;
      // CW winding: inside points have dot(cross(va,vb), p) <= 0
      if (dot(cross(va, vb), p) > 0.0) {
        inside = false;
        break;
      }
    }

    if (inside) {
      if (uColorMode == 1) {
        fragColor = vec4(vElevation, vElevation, vElevation, 1.0);
      } else {
        fragColor = vec4(color, 1.0);
      }
      return;
    }
  }

  // Bright magenta fallback — visible when PIP finds no match (boundary gaps, etc.)
  fragColor = vec4(0.8, 0.0, 0.8, 1.0);
}
`;
