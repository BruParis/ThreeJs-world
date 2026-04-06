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
uniform float uElevBlendWidth;

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
  // Run the same spherical PiP test as the fragment shader to find which tile
  // this vertex belongs to, then blend elevation at tile boundaries so oceanic
  // tiles stay flat while continental tiles slope smoothly down to sea level.
  //
  // Per-tile DataTexture encoding (set by TileShaderPatchOperation):
  //   Row 0   w : nv + ownElevWeight * 0.1   (fract * 10 decodes ownWeight)
  //   Row 1+j w : elevation weight of the neighbor tile across edge j

  float ownElevWeight      = 1.0; // default: displace (safe for unmatched vertices)
  float neighborElevWeight = 1.0;
  float nearestEdgeDist    = -1e9; // normalized signed dist to nearest edge; 0 = on edge

  for (int i = 0; i < MAX_TILES; i++) {
    if (i >= uNumTiles) break;

    vec4  meta = texelFetch(uTileData, ivec2(i, 0), 0);
    float a    = meta.a;
    int   nv   = int(a + 0.5);
    if (nv < 3) continue;

    bool  inside   = true;
    float minEdge  = -1e9;
    float minNeigh = 1.0;

    for (int j = 0; j < MAX_VERTS; j++) {
      if (j >= nv) break;
      vec4 rowJ  = texelFetch(uTileData, ivec2(i, 1 + j),             0);
      vec4 rowJN = texelFetch(uTileData, ivec2(i, 1 + (j + 1) % nv), 0);
      vec3 edgeN = cross(rowJ.xyz, rowJN.xyz);
      float len  = length(edgeN);
      // Normalized signed distance: negative = inside polygon, 0 = on edge
      float d    = (len > 0.0) ? dot(edgeN, n) / len : 0.0;
      if (d > 0.0) { inside = false; break; }
      if (d > minEdge) {
        minEdge  = d;
        minNeigh = rowJ.w; // neighbor elevation weight for edge j stored in row j
      }
    }

    if (inside) {
      ownElevWeight      = step(0.05, fract(a)); // fract ≈ 0.1 → 1.0, fract ≈ 0.0 → 0.0
      neighborElevWeight = minNeigh;
      nearestEdgeDist    = minEdge;
      break;
    }
  }

  // Blend only downward (min): prevents ocean vertices from rising at coast edges.
  // Continental tiles slope to 0 near ocean; oceanic tiles stay flat.
  float blend      = smoothstep(-uElevBlendWidth, 0.0, nearestEdgeDist);
  float elevWeight = mix(ownElevWeight, min(ownElevWeight, neighborElevWeight), blend);

  float elev = (perlinFbm(n * uNoiseScale, uNoiseOctaves, uNoisePersistence, uNoiseLacunarity) * 0.5 + 0.5)
               * uElevationAmplitude * elevWeight;
  vElevation = (uElevationAmplitude > 0.0) ? elev / uElevationAmplitude : 0.0;
  vec3 displaced = (uSphereOffset + elev) * n;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;
