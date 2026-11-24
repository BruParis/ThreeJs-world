/**
 * Sky and ground fill light of the terrain — reusable GLSL + uniform helpers.
 *
 * Outdoors, a surface facing away from the sun is still lit by the blue sky
 * above it and by the sunlit ground around it.  This adds both as indirect
 * diffuse light, relative to the local "up" of the planet (so it works on a
 * flat patch and on the sphere alike):
 *
 *   h      = 0.5 + 0.5 * dot(n, up)        share of the sky in view (1 facing up)
 *   sky    = skyColor * skyStrength * sun luminance * daylight(sun elevation)
 *   ground = groundColor * sun * max(dot(sunDir, up), 0)  (light bounced by a
 *            ground of albedo groundColor)
 *   fill   = sky * h + ground * (1 - h)
 *
 * The fill follows the sun (the first DirectionalLight of the scene): it fades
 * at sunset and warms up when the sun is low.  It adds to Three's ambient light.
 *
 * Usage (MeshStandardMaterial.onBeforeCompile):
 *   fragment preamble:   terrainSkyFragPreamble
 *   after the normal:    `vec3 terrain_upView` must be defined (view space up)
 *   replace:             '#include <lights_fragment_maps>' with terrainSkyLightsChunk
 */

import * as THREE from 'three';

export type RGB = [number, number, number];

export interface TerrainSkyState {
  skyColor:      RGB;
  /** Sky light on an upward surface, relative to the sun's luminance (sun high). */
  skyStrength:   number;
  /** Mean albedo of the surrounding ground (color of the bounced light). */
  groundColor:   RGB;
  /** Multiplier of the bounced light. */
  groundStrength: number;
}

export const DEFAULT_TERRAIN_SKY: TerrainSkyState = {
  skyColor:       [0.55, 0.70, 1.00],
  skyStrength:    0.30,
  groundColor:    [0.30, 0.27, 0.20],
  groundStrength: 1.0,
};

export const terrainSkyFragPreamble = /* glsl */`
uniform vec3  uSkyColor;
uniform float uSkyStrength;
uniform vec3  uGroundColor;
uniform float uGroundStrength;
`;

/**
 * Replaces `#include <lights_fragment_maps>`: adds the sky / ground fill to
 * the indirect irradiance (geometryNormal and terrain_upView are view space).
 */
export const terrainSkyLightsChunk = /* glsl */`
#if defined( RE_IndirectDiffuse )
{
  vec3  sunColor = vec3(0.0);
  float sunUp    = 1.0;
  #if NUM_DIR_LIGHTS > 0
    sunColor = directionalLights[0].color;
    sunUp    = dot(directionalLights[0].direction, terrain_upView);
  #endif
  float sunLum   = dot(sunColor, vec3(0.2126, 0.7152, 0.0722));
  float sunHigh  = clamp(sunUp, 0.0, 1.0);

  // Daylight: the sky dims as the sun goes down and is gone a little after sunset.
  float daylight = smoothstep(-0.10, 0.15, sunUp) * (0.35 + 0.65 * sunHigh);
  // Low sun: warmer, less blue sky light.
  vec3  skyTint  = mix(vec3(1.0, 0.72, 0.50), vec3(1.0), smoothstep(0.0, 0.4, sunUp));
  vec3  sky      = uSkyColor * skyTint * (uSkyStrength * sunLum * daylight);
  vec3  ground   = uGroundColor * sunColor * (sunHigh * uGroundStrength);

  float skyView  = 0.5 + 0.5 * dot(geometryNormal, terrain_upView);
  irradiance += sky * skyView + ground * (1.0 - skyView);
}
#endif
#include <lights_fragment_maps>
`;

export function createTerrainSkyUniforms(s: TerrainSkyState): Record<string, THREE.IUniform> {
  const u: Record<string, THREE.IUniform> = {
    uSkyColor:       { value: new THREE.Vector3() },
    uSkyStrength:    { value: 0 },
    uGroundColor:    { value: new THREE.Vector3() },
    uGroundStrength: { value: 0 },
  };
  syncTerrainSkyUniforms(u, s);
  return u;
}

export function syncTerrainSkyUniforms(u: Record<string, THREE.IUniform>, s: TerrainSkyState): void {
  (u.uSkyColor.value as THREE.Vector3).fromArray(s.skyColor);
  u.uSkyStrength.value = s.skyStrength;
  (u.uGroundColor.value as THREE.Vector3).fromArray(s.groundColor);
  u.uGroundStrength.value = s.groundStrength;
}
