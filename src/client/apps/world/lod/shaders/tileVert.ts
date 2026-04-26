/**
 * Vertex shader for tectonic tile LOD patches.
 *
 * Elevation pipeline — mirrors the flat-terrain Shaders demo exactly:
 *   1. Project sphere normal to cube-face UV (sphereToPatchXZ from spherePatchGLSL).
 *      p = cubeUV * uNoiseScale — same role as worldXZ * noiseScale in flat terrain.
 *   2. Sample simplexFbm(vec3(p.x, 0, p.y), ...) — 2D planar noise, same as
 *      the TerrainElevationGL compute shader.
 *   3. Compute finite-difference slope for erosion / normal.
 *   4. Pass to applyTerrain() (terrainGLSL) — same function as flat terrain.
 *   5. Map elevation [0,1] to radial displacement (sphere analogue of terrain_displY):
 *        displH = max(0, (shiftedElev - TERRAIN_SEA) / (1 - TERRAIN_SEA))
 *        radialDisp = displH * uElevationAmplitude * elevWeight
 *      Vertices below sea level are NOT displaced (flat ocean floor).
 *
 * Continental tiles have elevWeight = 1 (terrain displacement + biome coloring).
 * Oceanic tiles have elevWeight = 0 (no displacement, renders as ocean).
 *
 * Varyings out
 *   vSphereNormal        – undisplaced unit-sphere direction (polygon tests in frag)
 *   vElevation           – (terrain elevation + uElevOffset) * elevWeight ∈ [0,1]
 *                          0 for oceanic tiles; terrain elevation for continental.
 *   vTerrainWorldPos     – displaced 3D world position (for frag breakup noise)
 *   vTerrainLocalNormal  – surface normal in FBM-slope space:
 *                            y=1 → flat, y→0 → vertical cliff.
 *                            Computed when uColorMode==2; default (0,1,0) otherwise.
 *   vTerrainRidgeMap     – erosion ridge signal (0.0 when erosion disabled)
 */

import { simplexNoiseGLSL } from '@core/noise/simplexGLSL';
import { erosionGLSL }      from '@core/shaders/erosionGLSL';
import { terrainGLSL }      from '@core/shaders/terrainGLSL';
import { spherePatchGLSL }  from '@core/shaders/spherePatchGLSL';

export const tileVertexShader = /* glsl */`

${simplexNoiseGLSL}
${erosionGLSL}
${terrainGLSL}
${spherePatchGLSL}

// ── Uniforms ──────────────────────────────────────────────────────────────────

uniform highp sampler2D uTileData;
uniform int   uNumTiles;
uniform float uNoiseScale;
uniform int   uNoiseOctaves;
uniform float uNoisePersistence;
uniform float uNoiseLacunarity;
uniform float uElevationAmplitude;  // world units — max radial displacement
uniform float uSphereOffset;        // base sphere radius (anti z-fight offset)
uniform float uElevOffset;          // uniform shift on elevation before sea-level test
uniform int   uColorMode;           // 0=plate/geology  1=elevation  2=terrain

uniform int   uErosionEnabled;
uniform int   uErosionOctaves;
uniform float uErosionScale;
uniform float uErosionStrength;
uniform float uErosionGullyWeight;
uniform float uErosionDetail;
uniform float uErosionLacunarity;
uniform float uErosionGain;
uniform float uErosionCellScale;
uniform float uErosionNormalization;
uniform float uErosionRidgeRounding;
uniform float uErosionCreaseRounding;

const int MAX_TILES = 256;
const int MAX_VERTS = 8;

// Sea-level threshold — must match WATER_HEIGHT in terrainColorGLSL.
const float TERRAIN_SEA = 0.35;

// ── Varyings ──────────────────────────────────────────────────────────────────

out vec3  vSphereNormal;
out float vElevation;
out vec3  vTerrainWorldPos;
out vec3  vTerrainLocalNormal;
out float vTerrainRidgeMap;

// ── Main ──────────────────────────────────────────────────────────────────────

void main() {

  // Sphere-surface direction
  vec3 n = normalize(position);
  vSphereNormal = n;

  // ── Elevation weight lookup (oceanic=0, continental=1) ────────────────────
  float elevWeight = 1.0;

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
      elevWeight = step(0.05, fract(a));
      break;
    }
  }

  // ── 2-D terrain position (cube-face UV scaled to noise domain) ────────────
  //
  // sphereToPatchXZ projects the sphere normal to cube-face UV ∈ [-1,1]^2 and
  // multiplies by uNoiseScale, matching the flat-terrain noise domain where
  //   p = worldXZ * noiseScale   and   worldXZ ∈ [-patchHalfSize, +patchHalfSize].
  // Adjacent patches on the same cube face share a seamless UV coordinate space.
  vec2 p = sphereToPatchXZ(n, uNoiseScale);

  // ── Base simplex FBM noise ∈ [-1, 1] ─────────────────────────────────────
  float rawNoise = simplexFbm(vec3(p.x, 0.0, p.y),
                               uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);

  // ── Finite-difference slope (needed by erosion and terrain-mode normal) ───
  //
  // eps = 0.5 / max(uNoiseScale, 0.5) keeps the noise-domain step at a fixed
  // 0.5 units regardless of noiseScale, sampling across roughly half a base
  // octave period.  This mirrors the baked-gradient computation in
  // TerrainElevationGL (which forward-differences at grid spacing ≈ patch / N).
  vec2 rawSlope = vec2(0.0);
  if (uErosionEnabled == 1 || uColorMode == 2) {
    float eps = 0.5 / max(uNoiseScale, 0.5);
    float nT = simplexFbm(vec3(p.x + eps, 0.0, p.y),
                           uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
    float nB = simplexFbm(vec3(p.x, 0.0, p.y + eps),
                           uNoiseOctaves, uNoisePersistence, uNoiseLacunarity);
    rawSlope = vec2(nT - rawNoise, nB - rawNoise) / eps;
  }

  // ── Terrain elevation via applyTerrain (same call as flat terrain) ────────
  float ridgeOut  = 0.0;
  float elevation = 0.0;
  float _ed       = 0.0;
  applyTerrain(
    p, rawNoise, rawSlope,
    uErosionEnabled,
    uErosionOctaves,  uErosionScale,         uErosionStrength,  uErosionGullyWeight,
    uErosionDetail,   uErosionLacunarity,     uErosionGain,      uErosionCellScale,
    uErosionNormalization, uErosionRidgeRounding, uErosionCreaseRounding,
    elevation, ridgeOut, _ed
  );
  // elevation ∈ [0, 1]

  // ── Shift elevation and apply sea-level clamp (mirrors terrain_displY) ────
  float shiftedElev = clamp(elevation + uElevOffset, 0.0, 1.0);
  vElevation = shiftedElev * elevWeight;

  float displH     = max(0.0, (shiftedElev - TERRAIN_SEA) / (1.0 - TERRAIN_SEA));
  float radialDisp = displH * uElevationAmplitude * elevWeight;
  vTerrainWorldPos = (uSphereOffset + radialDisp) * n;
  vTerrainRidgeMap = ridgeOut;

  // ── Surface normal for terrain coloring (uColorMode == 2 only) ───────────
  //
  // Derive a local-frame normal from the FBM slope: normalize(-dhdx, 1.0, -dhdz).
  // y=1 → flat; y→0 → vertical cliff.  This mirrors TerrainMesh where the baked
  // gradient (amplitude=1, computed by TerrainElevationGL) drives the same formula.
  //
  // Using the FBM-domain slope (not world-space displacement gradient) gives
  // visible cliffs even though radial displacement is ~1.5% of sphere radius —
  // the colour system cares about noise topology, not geometry.
  if (uColorMode == 2) {
    vTerrainLocalNormal = normalize(vec3(-rawSlope.x, 1.0, -rawSlope.y));
  } else {
    vTerrainLocalNormal = vec3(0.0, 1.0, 0.0);
  }

  // ── Final vertex position ─────────────────────────────────────────────────
  gl_Position = projectionMatrix * modelViewMatrix * vec4((uSphereOffset + radialDisp) * n, 1.0);
}
`;
