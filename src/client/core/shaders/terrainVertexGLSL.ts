/**
 * Terrain vertex displacement — reusable GLSL + uniform helpers.
 *
 * Owns the vertex-shader preamble that reads from the elevation texture and
 * drives Y-displacement + normal reconstruction.
 *
 * Exposes:
 *   TERRAIN_SEA_LEVEL              – JS constant (0.35), default value for uSeaLevel uniform
 *   terrainVertexPreamble          – GLSL preamble (uniforms, varyings, helper fn,
 *                                    TerrainSample struct + unpackElevationChannel)
 *   terrainVertexNormalChunk       – replaces `#include <beginnormal_vertex>`
 *   terrainVertexPositionChunk     – replaces `#include <begin_vertex>`
 *   terrainFragmentVaryings        – varying re-declarations for the fragment side
 *   TerrainVertexUniformState      – TS interface for owned values
 *   createTerrainVertexUniforms(s) – creates shader.uniforms entries
 *   syncTerrainVertexUniforms(u,s) – updates existing entries
 */

import * as THREE from 'three';
import { terrainSampleGLSL } from '@core/shaders/terrainSampleGLSL';

export const TERRAIN_SEA_LEVEL = 0.35;

export const terrainVertexPreamble = /* glsl */`
${terrainSampleGLSL}

uniform sampler2D uElevationTex;
uniform float uPatchHalfSize;
uniform float uElevOffset;

varying float vTerrainElev;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;

uniform float uSeaLevel;

float terrain_displY(float noise) {
  return noise + uElevOffset;
}
`;

// ── Uniform helpers ───────────────────────────────────────────────────────────

export interface TerrainVertexUniformState {
  elevationTexture: THREE.DataTexture | null;
  patchHalfSize:    number;
  elevationOffset:  number;
  seaLevel:         number;
}

export function createTerrainVertexUniforms(s: TerrainVertexUniformState): Record<string, THREE.IUniform> {
  return {
    uElevationTex:  { value: s.elevationTexture },
    uPatchHalfSize: { value: s.patchHalfSize },
    uElevOffset:    { value: s.elevationOffset },
    uSeaLevel:      { value: s.seaLevel },
  };
}

export function syncTerrainVertexUniforms(u: Record<string, THREE.IUniform>, s: TerrainVertexUniformState): void {
  u.uElevationTex.value  = s.elevationTexture;
  u.uPatchHalfSize.value = s.patchHalfSize;
  u.uElevOffset.value    = s.elevationOffset;
  u.uSeaLevel.value      = s.seaLevel;
}

// ── GLSL chunk replacements ───────────────────────────────────────────────────

/**
 * Varying re-declarations for the fragment shader.
 * Must be prepended to the fragment shader alongside terrainColorGLSL.
 */
export const terrainFragmentVaryings = /* glsl */`
varying float vTerrainElev;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;
`;

/**
 * Replaces Three.js `#include <beginnormal_vertex>`.
 * Reads the baked elevation texture via unpackElevationChannel, reconstructs
 * the world-space surface normal, and sets all terrain varyings.
 */
export const terrainVertexNormalChunk = /* glsl */`
vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;
vec2 elevUV = (wPos.xz + uPatchHalfSize) / (uPatchHalfSize * 2.0);
vec4 elevData = texture2D(uElevationTex, elevUV);

float terrain_elev, terrain_gradX, terrain_gradZ;
unpackElevationChannel(elevData, terrain_elev, terrain_gradX, terrain_gradZ);

float terrain_dispY = terrain_displY(terrain_elev);

vTerrainElev     = terrain_elev;
vTerrainWorldPos = vec3(wPos.x, terrain_dispY, wPos.z);

float dhdx = terrain_gradX;
float dhdz = terrain_gradZ;
// Below water the mesh is flat — use an upward normal so the baked gradient
// (which ignores uElevOffset) does not leak through as lighting artefacts.
bool underwater = (terrain_elev + uElevOffset) < uSeaLevel;
vTerrainWorldNormal = underwater ? vec3(0.0, 1.0, 0.0) : normalize(vec3(-dhdx, 1.0, -dhdz));

vec3 objectNormal = vTerrainWorldNormal;
`;

/**
 * Replaces Three.js `#include <begin_vertex>`.
 * Applies Y displacement computed in the normal chunk above.
 * Underwater vertices are clamped to uSeaLevel so the mesh forms a flat
 * water surface — no separate water plane needed.
 */
export const terrainVertexPositionChunk = /* glsl */`
vec3 transformed = vec3(position.x, underwater ? uSeaLevel : terrain_dispY, position.z);
`;
