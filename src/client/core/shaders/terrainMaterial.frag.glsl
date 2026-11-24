// Terrain material — fragment shader.
//
// Three's MeshStandardMaterial fragment shader (r168, meshphysical.glsl.js with
// STANDARD only) with the terrain stages written in place:
//   - surface state, classification and base color   (instead of <map_fragment>)
//   - roughness / metalness, water vs land          (instead of the *map chunks)
//   - per-pixel normal from the baked gradient       (instead of <normal_fragment_begin>)
// Lighting, tone mapping and color space are Three's chunks, unchanged.
//
// Everything terrain-side is expressed in the domain (planet) frame; the normal
// is rotated to view space for lighting with uDomainToWorld.
//
// Defines (TerrainMaterial): GRASS_HEIGHT, DRAINAGE_WIDTH,
//                            BIOME_COLOR_STANDARD, BIOME_COLOR_OCEAN.

#define STANDARD

// ── Three: material uniforms (ShaderLib.standard) ─────────────────────────────
uniform vec3  diffuse;
uniform vec3  emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;

varying vec3 vViewPosition;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// ── Terrain ───────────────────────────────────────────────────────────────────
#include "terrainColor.glsl"

// Baked patch textures and the values shared with the vertex stage.
uniform sampler2D uElevationTex;    // R = elevation, GBA = gradient (domain frame)
uniform sampler2D uTreeDensityTex;
uniform float     uElevOffset;
uniform float     uVerticalScale;
uniform mat3      uDomainToWorld;   // domain (planet) frame → world frame of the scene

// Detail noise (baked by the detail pass): .x = FBM, .yzw = surface gradient.
uniform sampler2D uDetailNoiseTex;
uniform int       uDetailNoiseEnabled;
uniform float     uDetailNoiseStrength;

varying vec2 vTerrainUv;
varying vec3 vTerrainUp;
varying vec3 vTerrainDomainPos;

void main() {

  vec4 diffuseColor = vec4( diffuse, opacity );
  #include <clipping_planes_fragment>

  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  vec3 totalEmissiveRadiance = emissive;

  #include <logdepthbuf_fragment>

  // ── Terrain: surface state, classification and base color ──────────────────
  // 0. Per-fragment terrain state, read from the baked elevation texture.
  //    Everything below is expressed in the domain (planet) frame; "up" is the
  //    normal of the undisplaced surface, so no axis is assumed to be vertical.
  vec3  terrain_up       = normalize(vTerrainUp);
  vec2  terrain_elevUv   = terrainTexelUv(vTerrainUv, vec2(textureSize(uElevationTex, 0)));
  vec2  terrain_treeUv   = terrainTexelUv(vTerrainUv, vec2(textureSize(uTreeDensityTex, 0)));
  vec4  terrain_elevData = texture2D(uElevationTex, terrain_elevUv);
  float terrain_elev     = terrain_elevData.r + uElevOffset
                         + texture2D(uTreeDensityTex, terrain_treeUv).r / 100.0;
  vec3  terrain_grad     = terrain_elevData.gba;
  bool  terrain_underwater = terrain_elev < uSeaLevel;

  // Shape-space slope: cosine between the normal and "up" for a relief of one
  // terrain unit per unit of elevation.  Classification uses it so that the look
  // of the terrain does not depend on the vertical exaggeration.
  float terrain_slopeY = terrain_underwater ? 1.0 : inversesqrt(1.0 + dot(terrain_grad, terrain_grad));

  // Geometric normal of the displayed (exaggerated) surface — used for lighting.
  vec3 terrain_baseNormal = terrain_underwater
    ? terrain_up
    : normalize(terrain_up - uVerticalScale * terrain_grad);

  // 1. Sample detail noise: .x = FBM value, .yzw = its surface gradient.
  vec4 detailTex = vec4(0.0);
  if (uDetailNoiseEnabled == 1) {
    vec2 detailUV = terrainTexelUv(vTerrainUv, vec2(textureSize(uDetailNoiseTex, 0)));
    detailTex = texture2D(uDetailNoiseTex, detailUV);
  }
  vec3 detailNoise = vec3(detailTex.x, 0.0, 0.0);
  vec3 detailGrad  = detailTex.yzw;

  // 2. Read erosion attributes from the baked attribute texture (same size as the
  //    elevation texture).  R = ridgeMap [-1,1], G = erosionDepth [0,1] packed (×0.5+0.5).
  vec4 attrData  = texture2D(uAttrTex, terrain_elevUv);
  float erosionDepth = attrData.g * 2.0 - 1.0;

  // 3. Classify terrain dynamically. classifyTerrain() runs ComputeTreeMap in
  //    the fragment shader.  The tree noise is faded out when it becomes finer
  //    than a pixel, so distant forests do not shimmer.
  float terrain_footprint = length(fwidth(vTerrainDomainPos));
  float terrain_treeFade  = clamp01(1.0 / max(terrain_footprint * uTreeNoiseFreq, 1e-6) - 1.0);
  TerrainClassification tc = classifyTerrain(terrain_elev, attrData.r, terrain_slopeY, vTerrainDomainPos, terrain_treeFade);
  bool  isWater  = tc.isWater;
  bool  isGrass  = tc.isGrass;
  bool  isTree   = tc.isTree;
  float trees    = clamp01(tc.trees);
  float hardness = tc.hardness;

  // 4. Perturb the normal — two independent contributions:
  //    - hardness × detail noise: rock/cliff micro-roughness; zero on grass/tree surfaces.
  //    - tree canopy bump: a baked tangent tilt vector, gated by tree density.
  //      Uses its own uniforms (uTreeBumpFreq, uTreeBumpStrength) and runs
  //      regardless of uDetailNoiseEnabled, so tree shading is always distinct from grass.
  vec2 bumpUV      = terrainTexelUv(vTerrainUv, vec2(textureSize(uBumpWaterTex, 0)));
  vec3 treeBumpVec = texture2D(uBumpTreeTex, bumpUV).xyz * trees * uTreeBumpStrength;
  vec3 terrainNorDomain = normalize(
      terrain_baseNormal
      + detailGrad * uDetailNoiseStrength * hardness
      + treeBumpVec
  );
  vec3 waterNorDomain = computeWaterNormal(
      terrain_up,
      texture2D(uBumpWaterTex, bumpUV).xyz * uWaterNormalStrength
  );
  vec3  colorNormal  = isWater ? waterNorDomain : terrainNorDomain;
  float colorNormalY = dot(colorNormal, terrain_up);
  // Normal as seen from the surface (x, up, z) — for the debug views.
  vec3 colorNormalLocal;
  {
    vec3 terrain_t1, terrain_t2;
    terrainTangentBasis(terrain_up, terrain_t1, terrain_t2);
    colorNormalLocal = vec3(dot(colorNormal, terrain_t1), colorNormalY, dot(colorNormal, terrain_t2));
  }

  // 5. Output color.
  if (uDebugMode == TERRAIN_DEBUG_BIOME) {
    // Biome weights, with the coastline (sea level) drawn as a dark line.
    vec3 biomeColor = mix(BIOME_COLOR_STANDARD, BIOME_COLOR_OCEAN, attrData.b);
    float coast = 1.0 - smoothstep(0.0, max(1.5 * fwidth(terrain_elev), 1e-6), abs(terrain_elev - uSeaLevel));
    diffuseColor.rgb = mix(biomeColor, vec3(0.05), coast);
  } else if (uDebugMode == TERRAIN_DEBUG_CLASSIFICATION) {
    vec3 classColor = vec3(0.35, 0.30, 0.25);        // rock / cliff / dirt / snow
    if (isGrass) classColor = vec3(0.30, 0.60, 0.10);
    if (isTree)  classColor = vec3(0.05, 0.25, 0.05);
    if (isWater) classColor = vec3(0.05, 0.10, 0.45);
    diffuseColor.rgb = classColor;
  } else if (isWater && uDebugMode == TERRAIN_DEBUG_COLOR) {
    diffuseColor.rgb = waterColor(terrain_elev, colorNormalY, detailNoise);
  } else {
    diffuseColor.rgb = terrainColor(terrain_elev, attrData.r, erosionDepth, trees, hardness, colorNormalLocal, detailNoise);
  }

  // ── Terrain: roughness / metalness ─────────────────────────────────────────
  // Water is a smoother dielectric (Fresnel glint, no metallic tint).
  float roughnessFactor = isWater ? uWaterRoughness : roughness;
  float metalnessFactor = isWater ? 0.0 : metalness;

  // ── Terrain: normal, domain frame → view space ─────────────────────────────
  vec3 normal = normalize( mat3( viewMatrix ) * ( uDomainToWorld * colorNormal ) );
  vec3 nonPerturbedNormal = normal;

  // ── Three: lighting ────────────────────────────────────────────────────────
  #include <lights_physical_fragment>
  #include <lights_fragment_begin>
  #include <lights_fragment_maps>
  #include <lights_fragment_end>

  vec3 totalDiffuse  = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;

  // ── Three: output ──────────────────────────────────────────────────────────
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <premultiplied_alpha_fragment>
  #include <dithering_fragment>
}
