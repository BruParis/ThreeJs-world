/**
 * Vertex shader for tectonic tile LOD patches.
 *
 * Receives raw sphere positions (normalized, on unit sphere) and displaces
 * them along the surface normal using classic 3D Perlin noise, producing
 * consistent elevation across all patches with no seams.
 *
 * The noise implementation is imported from perlinGLSL.ts, which embeds the
 * Ken Perlin reference permutation table at build time.  This gives bit-for-bit
 * identical output to PerlinNoise3D (no-seed) on the CPU.
 *
 * Uniforms
 *   uNoiseScale          – frequency of the noise input (sphere-space)
 *   uElevationAmplitude  – max radial displacement in world units
 *   uSphereOffset        – base radial offset (avoids z-fighting with dual mesh)
 *
 * Varyings out
 *   vSphereNormal – undisplaced normalized sphere position, used by the
 *                   fragment shader for tile polygon lookup
 *   vElevation    – normalized elevation [0, 1]: 0 = sea level, 1 = max
 */

import { perlinNoiseGLSL } from '@core/noise/perlinGLSL';

export const tileVertexShader = /* glsl */`

${perlinNoiseGLSL}

// ── Main ──────────────────────────────────────────────────────────────────────

uniform highp sampler2D uTileData;
uniform int   uNumTiles;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
uniform float uElevationAmplitude;
uniform float uSphereOffset;

const int MAX_TILES = 256;
const int MAX_VERTS = 8;

out vec3  vSphereNormal;
out float vElevation;   // normalized [0, 1]: 0 = sea level, 1 = max elevation

void main() {
  // Sphere-surface normal = normalized position (positions lie on unit sphere)
  vec3 n = normalize(position);
  vSphereNormal = n;

  // ── Elevation weight: 0 = oceanic (flat), 1 = continental (perlin) ──────────
  //
  // Per-tile DataTexture encoding (set by TileShaderPatchOperation):
  //   Row 0   w : nv + ownElevWeight * 0.1   (fract * 10 decodes ownWeight)

  float elevWeight = 1.0; // default: displace (safe for unmatched vertices)

  for (int i = 0; i < MAX_TILES; i++) {
    if (i >= uNumTiles) break;

    vec4  meta = texelFetch(uTileData, ivec2(i, 0), 0);
    float a    = meta.a;
    int   nv   = int(a + 0.5);
    if (nv < 3) continue;

    bool inside = true;

    for (int j = 0; j < MAX_VERTS; j++) {
      if (j >= nv) break;
      vec4 rowJ  = texelFetch(uTileData, ivec2(i, 1 + j),             0);
      vec4 rowJN = texelFetch(uTileData, ivec2(i, 1 + (j + 1) % nv), 0);
      vec3 edgeN = cross(rowJ.xyz, rowJN.xyz);
      float len  = length(edgeN);
      float d    = (len > 0.0) ? dot(edgeN, n) / len : 0.0;
      if (d > 0.0) { inside = false; break; }
    }

    if (inside) {
      elevWeight = step(0.05, fract(a)); // fract ≈ 0.1 → 1.0, fract ≈ 0.0 → 0.0
      break;
    }
  }

  float elev = (perlinFbm(n * uNoiseScale, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity) * 0.5 + 0.5)
               * uElevationAmplitude * elevWeight;
  vElevation = (uElevationAmplitude > 0.0) ? elev / uElevationAmplitude : 0.0;
  vec3 displaced = (uSphereOffset + elev) * n;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;
