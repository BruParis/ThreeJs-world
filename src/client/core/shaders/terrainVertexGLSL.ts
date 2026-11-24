/**
 * Terrain vertex stage — TypeScript side: the vertex uniforms.
 *
 * The GLSL (displacement, geometry and scale contracts) is in
 * terrainMaterial.vert.glsl.
 */

import * as THREE from 'three';

export const TERRAIN_SEA_LEVEL = 0.35;

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
