/**
 * Terrain vertex displacement — reusable GLSL + uniform helpers.
 *
 * Purely geometric: reads rawElev + gradients from the elevation texture,
 * applies uElevOffset, reads tree density from the dedicated tree density
 * texture (produced by TreeDensityGL), and applies the small tree elevation bias.
 * No classification, no noise evaluation — all classification is in the fragment shader.
 */

import * as THREE from 'three';
import { terrainSampleGLSL } from '@core/shaders/terrainSampleGLSL';

export const TERRAIN_SEA_LEVEL = 0.35;

export const terrainVertexPreamble = /* glsl */`
${terrainSampleGLSL}

uniform sampler2D uElevationTex;
uniform sampler2D uTreeDensityTex;
uniform float uPatchHalfSize;
uniform float uElevOffset;
uniform float uSeaLevel;

varying float vTerrainElev;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;
`;

export interface TerrainVertexUniformState {
  elevationTexture:    THREE.DataTexture | null;
  treeDensityTexture:  THREE.DataTexture | null;
  patchHalfSize:       number;
  elevationOffset:     number;
  seaLevel:            number;
}

export function createTerrainVertexUniforms(s: TerrainVertexUniformState): Record<string, THREE.IUniform> {
  return {
    uElevationTex:    { value: s.elevationTexture },
    uTreeDensityTex:  { value: s.treeDensityTexture },
    uPatchHalfSize:   { value: s.patchHalfSize },
    uElevOffset:      { value: s.elevationOffset },
    uSeaLevel:        { value: s.seaLevel },
  };
}

export function syncTerrainVertexUniforms(u: Record<string, THREE.IUniform>, s: TerrainVertexUniformState): void {
  u.uElevationTex.value   = s.elevationTexture;
  u.uTreeDensityTex.value = s.treeDensityTexture;
  u.uPatchHalfSize.value  = s.patchHalfSize;
  u.uElevOffset.value     = s.elevationOffset;
  u.uSeaLevel.value       = s.seaLevel;
}

export const terrainFragmentVaryings = /* glsl */`
varying float vTerrainElev;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;
`;

/**
 * Replaces `#include <beginnormal_vertex>`.
 * Reads rawElev + gradients from the elevation texture.
 * Reads tree density from uTreeDensityTex (baked by TreeDensityGL with offset applied).
 * Applies uElevOffset + small tree bias, reconstructs world-space normal.
 */
export const terrainVertexNormalChunk = /* glsl */`
vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;
vec2 elevUV = (wPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
vec4 elevData = texture2D(uElevationTex, elevUV);

float terrain_elev, terrain_gradX, terrain_gradZ;
unpackElevationChannel(elevData, terrain_elev, terrain_gradX, terrain_gradZ);

float terrain_treeDensity = texture2D(uTreeDensityTex, elevUV).r;
float terrain_dispY       = terrain_elev + uElevOffset + terrain_treeDensity / 100.0;

vTerrainElev     = terrain_dispY;
vTerrainWorldPos = vec3(wPos.x, terrain_dispY, wPos.z);

float dhdx = terrain_gradX;
float dhdz = terrain_gradZ;
bool underwater = terrain_dispY < uSeaLevel;
vTerrainWorldNormal = underwater ? vec3(0.0, 1.0, 0.0) : normalize(vec3(-dhdx, 1.0, -dhdz));

vec3 objectNormal = vTerrainWorldNormal;
`;

/**
 * Replaces `#include <begin_vertex>`.
 */
export const terrainVertexPositionChunk = /* glsl */`
vec3 transformed = vec3(position.x, underwater ? uSeaLevel : terrain_dispY, position.z);
`;
