/**
 * Terrain vertex displacement — reusable GLSL + uniform helpers.
 *
 * Owns the vertex-shader preamble that reads from the elevation texture and
 * drives Y-displacement + normal reconstruction.
 *
 * Exposes:
 *   TERRAIN_SEA_LEVEL              – JS constant (0.35) matching the GLSL define
 *   terrainVertexPreamble          – GLSL preamble (uniforms, varyings, helper fn)
 *   TerrainVertexUniformState      – TS interface for owned values
 *   createTerrainVertexUniforms(s) – creates shader.uniforms entries
 *   syncTerrainVertexUniforms(u,s) – updates existing entries
 */

import * as THREE from 'three';

export const TERRAIN_SEA_LEVEL = 0.35;

export const terrainVertexPreamble = /* glsl */`
uniform sampler2D uElevationTex;
uniform float uAmplitude;
uniform float uPatchHalfSize;
uniform float uElevOffset;

varying float vTerrainElev;
varying float vTerrainRidge;
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
