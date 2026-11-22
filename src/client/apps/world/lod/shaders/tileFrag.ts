/**
 * Fragment shader for tectonic tile LOD patches.
 *
 * Color modes via uColorMode:
 *   0 = tile color  (plate category or geology — from the per-patch DataTexture)
 *   3 = LOD level   (flat color per LOD level — skips the polygon test, uses uLodColor)
 *
 * Mode 0 resolves which tile a fragment belongs to with an exact spherical
 * polygon containment test, then outputs the tile's color.
 *
 * Containment test:
 *   For each directed edge va→vb in CW order:  dot(cross(va, vb), p) <= 0
 *   A point p is inside iff it passes all edge tests.
 */
export const tileFragmentShader = /* glsl */`

uniform highp sampler2D uTileData;
uniform int uNumTiles;
uniform int uColorMode;  // 0 = tile color, 3 = LOD level
uniform vec3 uLodColor;

in vec3 vSphereNormal;

out vec4 fragColor;

const int MAX_TILES = 256;
const int MAX_VERTS = 8;

void main() {

  // ── LOD level color mode: skip polygon test, output flat level color ──────────
  if (uColorMode == 3) {
    fragColor = vec4(uLodColor, 1.0);
    return;
  }

  // ── Polygon containment test ──────────────────────────────────────────────────

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
      fragColor = vec4(color, 1.0);
      return;
    }
  }

  // Bright magenta fallback — visible when PIP finds no match (boundary gaps, etc.)
  fragColor = vec4(0.8, 0.0, 0.8, 1.0);
}
`;
