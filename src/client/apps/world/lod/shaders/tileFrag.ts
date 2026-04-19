/**
 * Fragment shader for tectonic tile LOD patches.
 *
 * Supports three color modes via uColorMode:
 *   0 = tile color  (plate category or geology — from per-patch DataTexture)
 *   1 = elevation   (grayscale — black → white)
 *   2 = terrain     (biome coloring from terrainColorGLSL: ocean/grass/snow/cliff)
 *
 * Modes 0 and 1 use the polygon containment test to resolve which tile a fragment
 * belongs to, then sample the tile's color/elevation.
 *
 * Mode 2 skips the polygon loop entirely — the varyings computed in tileVert.ts
 * (vElevation, vTerrainWorldPos, vTerrainLocalNormal, vTerrainRidgeMap) encode
 * all information needed for the color function.  The DataTexture is still used
 * by the vertex shader for the elevWeight lookup.
 *
 * Containment test (modes 0/1 only):
 *   For each directed edge va→vb in CW order:  dot(cross(va, vb), p) <= 0
 *   A point p is inside iff it passes all edge tests.
 *
 * Notes
 *   – simplexNoiseGLSL lives only in this fragment program (embedded by
 *     terrainColorGLSL).  Never add it to the vertex shader to avoid redundant
 *     compilation.
 *   – The vertex shader uses perlinNoiseGLSL + uPermTex; those are not referenced
 *     here.
 */

import { terrainColorGLSL } from '@core/shaders/terrainColorGLSL';

export const tileFragmentShader = /* glsl */`

${terrainColorGLSL}

uniform highp sampler2D uTileData;
uniform int uNumTiles;
uniform int uColorMode;  // 0 = tile color, 1 = elevation, 2 = terrain

in vec3  vSphereNormal;
in float vElevation;

in vec3  vTerrainWorldPos;
in vec3  vTerrainLocalNormal;
in float vTerrainRidgeMap;

out vec4 fragColor;

const int MAX_TILES = 256;
const int MAX_VERTS = 8;

void main() {

  // ── Terrain color mode: bypass polygon test ──────────────────────────────────
  //
  // vElevation encodes continental vs oceanic from the vertex shader:
  //   0.0        → oceanic (elevWeight = 0) → renders as ocean floor / water
  //   [0, 1]     → continental              → renders as land biomes
  //
  // WATER_HEIGHT = 0.35 (defined inside terrainColorGLSL) is the sea-level
  // threshold, so roughly the lowest 35 % of continental noise values show as
  // coastal water / sandy beach.

  if (uColorMode == 2) {
    fragColor = vec4(terrainColor(vElevation, vTerrainWorldPos, vTerrainLocalNormal, 1.0, vTerrainRidgeMap), 1.0);
    return;
  }

  // ── Polygon containment test (modes 0 and 1) ─────────────────────────────────

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
