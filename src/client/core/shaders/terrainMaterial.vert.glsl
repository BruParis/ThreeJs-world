// Terrain material — vertex shader.
//
// Three's MeshStandardMaterial vertex shader (r168, meshphysical.glsl.js) with
// the terrain displacement written in place of <beginnormal_vertex> and
// <begin_vertex>.  Purely geometric: reads the baked elevation, moves the
// vertex along its "up".  Classification, coloring and normals are per fragment.
//
// Geometry contract (the same for a flat patch and a sphere patch)
//   position – undisplaced vertex position, mesh-local
//   normal   – "up": unit direction of the vertex on the planet (domain frame)
//   uv       – patch coordinate in [0, 1]², addressing the baked textures
//
// Scale contract
//   height above sea level, terrain units = (elevation - seaLevel) * uVerticalScale
//   mesh-local length of one terrain unit  = uUnitToLocal
//
// Flat patches (Shaders tab) are displaced along a fixed mesh-local direction
// (uFlatUp) instead of their `normal` attribute.

#define STANDARD

varying vec3 vViewPosition;

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

// ── Terrain ───────────────────────────────────────────────────────────────────
#include "terrainSample.glsl"

uniform sampler2D uElevationTex;
uniform sampler2D uTreeDensityTex;
uniform float uElevOffset;
uniform float uSeaLevel;
uniform float uVerticalScale;         // displayed relief, terrain units per unit of elevation
uniform float uUnitToLocal;           // mesh-local length of one terrain unit
uniform float uPlanetRadius;          // world radius, terrain units
uniform vec4  uFlatUp;                // xyz = mesh-local displacement direction, w = 1 for flat patches
uniform float uDisplacementSmoothing; // 0 = raw texel, 1 = 3x3 [1 2 1] average (geometry only)

varying vec2 vTerrainUv;
varying vec3 vTerrainUp;
varying vec3 vTerrainDomainPos;

void main() {

  #include <uv_vertex>
  #include <color_vertex>
  #include <batching_vertex>

  // ── Terrain: elevation of the vertex ───────────────────────────────────────
  vec3 terrain_up = normalize(normal);

  vec2  terrain_elevSize = vec2(textureSize(uElevationTex, 0));
  vec2  terrain_elevUv   = terrainTexelUv(uv, terrain_elevSize);
  vec2  terrain_treeUv   = terrainTexelUv(uv, vec2(textureSize(uTreeDensityTex, 0)));
  float terrain_rawElev  = texture2D(uElevationTex, terrain_elevUv).r;

  // Displacement smoothing: blend towards the 3x3 [1 2 1] weighted average of
  // the neighbouring texels, which softens ridges finer than the mesh (the
  // sawtooth along crests).  Four bilinear fetches half a texel off-centre each
  // average a 2x2 block; together they give exactly that kernel.  Only the
  // geometry is smoothed — shading reads the raw elevation per fragment.
  // Vertices on the patch border keep the raw value, so neighbouring patches
  // still meet exactly.
  vec2 terrain_edgeDist = min(uv, 1.0 - uv) * (terrain_elevSize - 1.0);
  if (uDisplacementSmoothing > 0.0 && min(terrain_edgeDist.x, terrain_edgeDist.y) > 0.5) {
    vec2 o = 0.5 / terrain_elevSize;
    float terrain_avgElev = 0.25 * (
        texture2D(uElevationTex, terrain_elevUv + vec2(-o.x, -o.y)).r
      + texture2D(uElevationTex, terrain_elevUv + vec2( o.x, -o.y)).r
      + texture2D(uElevationTex, terrain_elevUv + vec2(-o.x,  o.y)).r
      + texture2D(uElevationTex, terrain_elevUv + vec2( o.x,  o.y)).r);
    terrain_rawElev = mix(terrain_rawElev, terrain_avgElev, uDisplacementSmoothing);
  }
  float terrain_treeDensity = texture2D(uTreeDensityTex, terrain_treeUv).r;
  float terrain_elev        = terrain_rawElev + uElevOffset + terrain_treeDensity / 100.0;

  // Height above sea level, terrain units.  Underwater vertices stay on the sea surface.
  float terrain_height = (max(terrain_elev, uSeaLevel) - uSeaLevel) * uVerticalScale;

  vec3 terrain_dispDir = mix(terrain_up, uFlatUp.xyz, uFlatUp.w);

  vTerrainUv        = uv;
  vTerrainUp        = terrain_up;
  vTerrainDomainPos = terrain_up * uPlanetRadius;

  // Lighting normals are rebuilt per fragment; this one only feeds Three's
  // normal varying.
  vec3 objectNormal = terrain_dispDir;
  #include <defaultnormal_vertex>
  #include <normal_vertex>

  // ── Terrain: displacement ──────────────────────────────────────────────────
  vec3 transformed = position + terrain_dispDir * (terrain_height * uUnitToLocal);

  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vViewPosition = - mvPosition.xyz;

  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
