/**
 * Terrain vertex displacement — reusable GLSL + uniform helpers.
 *
 * Purely geometric: reads the elevation from the baked elevation texture,
 * applies uElevOffset and the small tree elevation bias, and moves the vertex
 * along its "up" direction.  No classification, no noise evaluation — those
 * are in the fragment shader.
 *
 * Geometry contract (the same for a flat patch and a sphere patch)
 *   position – undisplaced vertex position, mesh-local
 *   normal   – "up": unit direction of the vertex on the planet (domain frame).
 *              It is both the surface normal of the undisplaced planet and the
 *              direction of the vertex from the planet centre.
 *   uv       – patch coordinate in [0, 1]², addressing the baked textures
 *
 * Scale contract
 *   height above sea level, terrain units = (elevation - seaLevel) * uVerticalScale
 *   mesh-local length of one terrain unit  = uUnitToLocal
 *
 * Flat patches (Shaders tab) are displaced along a fixed mesh-local direction
 * (uFlatUp) instead of their `normal` attribute.
 */

import * as THREE from 'three';
import { terrainSampleGLSL } from '@core/shaders/terrainSampleGLSL';

export const TERRAIN_SEA_LEVEL = 0.35;

export const terrainVertexPreamble = /* glsl */`
${terrainSampleGLSL}

uniform sampler2D uElevationTex;
uniform sampler2D uTreeDensityTex;
uniform float uElevOffset;
uniform float uSeaLevel;
uniform float uVerticalScale;   // displayed relief, terrain units per unit of elevation
uniform float uUnitToLocal;     // mesh-local length of one terrain unit
uniform float uPlanetRadius;    // world radius, terrain units
uniform vec4  uFlatUp;          // xyz = mesh-local displacement direction, w = 1 for flat patches
uniform float uDisplacementSmoothing; // 0 = raw texel, 1 = 3x3 [1 2 1] average (geometry only)

varying vec2 vTerrainUv;
varying vec3 vTerrainUp;
varying vec3 vTerrainDomainPos;
`;

export interface TerrainVertexUniformState {
  elevationTexture:    THREE.Texture | null;
  treeDensityTexture:  THREE.Texture | null;
  elevationOffset:     number;
  seaLevel:            number;
  /** Displayed relief, terrain units per unit of elevation. */
  verticalScale:       number;
  /** Mesh-local length of one terrain unit. */
  unitToLocal:         number;
  /** World radius, terrain units. */
  planetRadius:        number;
  /** Mesh-local displacement direction for flat patches; null for sphere patches. */
  flatUp:              THREE.Vector3 | null;
  /** Rotation from the domain (planet) frame to the world frame of the scene. */
  domainToWorld:       THREE.Matrix3;
  /** Blend of the displacement towards its 3x3 neighbour average, [0, 1]. */
  displacementSmoothing: number;
}

export function createTerrainVertexUniforms(s: TerrainVertexUniformState): Record<string, THREE.IUniform> {
  const u: Record<string, THREE.IUniform> = {
    uElevationTex:    { value: null },
    uTreeDensityTex:  { value: null },
    uElevOffset:      { value: 0 },
    uSeaLevel:        { value: 0 },
    uVerticalScale:   { value: 1 },
    uUnitToLocal:     { value: 1 },
    uPlanetRadius:    { value: 1 },
    uFlatUp:          { value: new THREE.Vector4(0, 1, 0, 0) },
    uDomainToWorld:   { value: new THREE.Matrix3() },
    uDisplacementSmoothing: { value: 0 },
  };
  syncTerrainVertexUniforms(u, s);
  return u;
}

export function syncTerrainVertexUniforms(u: Record<string, THREE.IUniform>, s: TerrainVertexUniformState): void {
  u.uElevationTex.value   = s.elevationTexture;
  u.uTreeDensityTex.value = s.treeDensityTexture;
  u.uElevOffset.value     = s.elevationOffset;
  u.uSeaLevel.value       = s.seaLevel;
  u.uVerticalScale.value  = s.verticalScale;
  u.uUnitToLocal.value    = s.unitToLocal;
  u.uPlanetRadius.value   = s.planetRadius;
  u.uDisplacementSmoothing.value = s.displacementSmoothing;
  const flatUp = u.uFlatUp.value as THREE.Vector4;
  if (s.flatUp) flatUp.set(s.flatUp.x, s.flatUp.y, s.flatUp.z, 1);
  else          flatUp.set(0, 1, 0, 0);
  (u.uDomainToWorld.value as THREE.Matrix3).copy(s.domainToWorld);
}

/**
 * Fragment-shader declarations matching the vertex stage: the varyings, plus
 * the uniforms the fragment shader shares with the vertex shader.
 * (uSeaLevel is declared by terrainColorGLSL.)
 */
export const terrainFragmentVaryings = /* glsl */`
uniform sampler2D uElevationTex;
uniform sampler2D uTreeDensityTex;
uniform float uElevOffset;
uniform float uVerticalScale;
uniform mat3  uDomainToWorld;   // domain (planet) frame → world frame of the scene

varying vec2 vTerrainUv;
varying vec3 vTerrainUp;
varying vec3 vTerrainDomainPos;
`;

/**
 * Replaces `#include <beginnormal_vertex>`.
 * Reads the elevation from the elevation texture and the tree density from
 * uTreeDensityTex (baked by the tree density pass with the offset applied),
 * then computes the height above sea level.
 * Normals are not computed here: the fragment shader rebuilds them per pixel
 * from the baked gradient.
 */
export const terrainVertexNormalChunk = /* glsl */`
vec3 terrain_up = normalize(normal);

vec2 terrain_elevSize = vec2(textureSize(uElevationTex, 0));
vec2 terrain_elevUv = terrainTexelUv(uv, terrain_elevSize);
vec2 terrain_treeUv = terrainTexelUv(uv, vec2(textureSize(uTreeDensityTex, 0)));
float terrain_rawElev     = texture2D(uElevationTex, terrain_elevUv).r;

// Displacement smoothing: blend towards the 3x3 [1 2 1] weighted average of the
// neighbouring texels, which softens ridges finer than the mesh (the sawtooth
// along crests).  Four bilinear fetches half a texel off-centre each average a
// 2x2 block; together they give exactly that kernel.  Only the geometry is
// smoothed — shading reads the raw elevation per fragment.
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

vec3 objectNormal = terrain_dispDir;
`;

/**
 * Replaces `#include <begin_vertex>`.
 */
export const terrainVertexPositionChunk = /* glsl */`
vec3 transformed = position + terrain_dispDir * (terrain_height * uUnitToLocal);
`;
