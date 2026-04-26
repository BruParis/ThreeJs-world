/**
 * Terrain vertex displacement — reusable GLSL + uniform helpers.
 *
 * Owns the vertex-shader preamble that reads from the elevation texture and
 * drives Y-displacement + normal reconstruction.
 *
 * Exposes:
 *   TERRAIN_SEA_LEVEL              – JS constant (0.35) matching the GLSL define
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
uniform float uAmplitude;
uniform float uPatchHalfSize;
uniform float uElevOffset;

varying float vTerrainElev;
varying float vTerrainRidge;
varying float vTerrainErosionDepth;
varying vec3  vTerrainWorldPos;
varying vec3  vTerrainWorldNormal;

const float TERRAIN_SEA = ${TERRAIN_SEA_LEVEL.toFixed(2)};

float terrain_displY(float noise) {
  return max(0.0, (noise + uElevOffset - TERRAIN_SEA) / (1.0 - TERRAIN_SEA) * uAmplitude);
}
`;

// ── Uniform helpers ───────────────────────────────────────────────────────────

export interface TerrainVertexUniformState {
  elevationTexture: THREE.DataTexture | null;
  amplitude:        number;
  patchHalfSize:    number;
  elevationOffset:  number;
}

export function createTerrainVertexUniforms(s: TerrainVertexUniformState): Record<string, THREE.IUniform> {
  return {
    uElevationTex:  { value: s.elevationTexture },
    uAmplitude:     { value: s.amplitude },
    uPatchHalfSize: { value: s.patchHalfSize },
    uElevOffset:    { value: s.elevationOffset },
  };
}

export function syncTerrainVertexUniforms(u: Record<string, THREE.IUniform>, s: TerrainVertexUniformState): void {
  u.uElevationTex.value  = s.elevationTexture;
  u.uAmplitude.value     = s.amplitude;
  u.uPatchHalfSize.value = s.patchHalfSize;
  u.uElevOffset.value    = s.elevationOffset;
}

// ── GLSL chunk replacements ───────────────────────────────────────────────────

/**
 * Varying re-declarations for the fragment shader.
 * Must be prepended to the fragment shader alongside terrainColorGLSL.
 */
export const terrainFragmentVaryings = /* glsl */`
varying float vTerrainElev;
varying float vTerrainRidge;
varying float vTerrainErosionDepth;
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

float terrain_elev, terrain_gradX, terrain_gradZ, terrain_ridge, terrain_erosionDepth;
unpackElevationChannel(elevData, terrain_elev, terrain_gradX, terrain_gradZ, terrain_ridge, terrain_erosionDepth);

float terrain_dispY = terrain_displY(terrain_elev);

vTerrainElev         = terrain_elev;
vTerrainRidge        = terrain_ridge;
vTerrainErosionDepth = terrain_erosionDepth;
vTerrainWorldPos = vec3(wPos.x, terrain_dispY, wPos.z);

// Gradient stored amplitude-normalised; scale by uAmplitude to get world-space slope.
float dhdx = terrain_gradX * uAmplitude;
float dhdz = terrain_gradZ * uAmplitude;
// Below water the mesh is flat — use an upward normal so the baked gradient
// (which ignores uElevOffset) does not leak through as lighting artefacts.
bool underwater = (terrain_elev + uElevOffset) < TERRAIN_SEA;
vTerrainWorldNormal = underwater ? vec3(0.0, 1.0, 0.0) : normalize(vec3(-dhdx, 1.0, -dhdz));

vec3 objectNormal = vTerrainWorldNormal;
`;

/**
 * Replaces Three.js `#include <begin_vertex>`.
 * Applies Y displacement computed in the normal chunk above.
 */
export const terrainVertexPositionChunk = /* glsl */`
vec3 transformed = vec3(position.x, terrain_dispY, position.z);
`;
