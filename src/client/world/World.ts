/**
 * World constants and unit conversion utilities.
 *
 * The simulation uses a unit sphere (radius = 1). This module provides
 * constants and functions to convert between simulation units and
 * real-world units (kilometers).
 */

// ============================================================================
// World Constants
// ============================================================================

/**
 * World radius in kilometers.
 * Default is Earth's mean radius.
 */
export const WORLD_RADIUS_KM = 6371;

/**
 * World surface area in square kilometers.
 * Computed as 4 * PI * R²
 */
export const WORLD_SURFACE_AREA_KM2 = 4 * Math.PI * WORLD_RADIUS_KM * WORLD_RADIUS_KM;

/**
 * Unit sphere surface area (4 * PI for radius = 1)
 */
export const UNIT_SPHERE_SURFACE_AREA = 4 * Math.PI;

// ============================================================================
// Distance Conversions
// ============================================================================

/**
 * Converts a distance on the unit sphere to kilometers.
 * On a unit sphere, distance equals the arc length (angle in radians).
 *
 * @param unitDistance - Distance on unit sphere (arc length / angle in radians)
 * @returns Distance in kilometers
 */
export function distanceToKm(unitDistance: number): number {
  return unitDistance * WORLD_RADIUS_KM;
}

/**
 * Converts a distance in kilometers to unit sphere distance.
 *
 * @param km - Distance in kilometers
 * @returns Distance on unit sphere (arc length / angle in radians)
 */
export function kmToDistance(km: number): number {
  return km / WORLD_RADIUS_KM;
}

/**
 * Converts a chord length on the unit sphere to kilometers.
 * Chord length is the straight-line distance through the sphere.
 *
 * @param chordLength - Chord length on unit sphere
 * @returns Chord length in kilometers
 */
export function chordToKm(chordLength: number): number {
  return chordLength * WORLD_RADIUS_KM;
}

// ============================================================================
// Area Conversions
// ============================================================================

/**
 * Converts an area on the unit sphere to square kilometers.
 * On a unit sphere, area is measured in steradians (solid angle).
 * For a sphere of radius R, area = R² * solid_angle.
 *
 * @param unitArea - Area on unit sphere (in steradians)
 * @returns Area in square kilometers
 */
export function areaToKm2(unitArea: number): number {
  return unitArea * WORLD_RADIUS_KM * WORLD_RADIUS_KM;
}

/**
 * Converts an area in square kilometers to unit sphere area.
 *
 * @param km2 - Area in square kilometers
 * @returns Area on unit sphere (in steradians)
 */
export function km2ToArea(km2: number): number {
  return km2 / (WORLD_RADIUS_KM * WORLD_RADIUS_KM);
}

/**
 * Converts an area ratio (fraction of unit sphere) to square kilometers.
 *
 * @param ratio - Area as fraction of total sphere surface (0 to 1)
 * @returns Area in square kilometers
 */
export function areaRatioToKm2(ratio: number): number {
  return ratio * WORLD_SURFACE_AREA_KM2;
}

/**
 * Converts an area in square kilometers to area ratio.
 *
 * @param km2 - Area in square kilometers
 * @returns Area as fraction of total sphere surface (0 to 1)
 */
export function km2ToAreaRatio(km2: number): number {
  return km2 / WORLD_SURFACE_AREA_KM2;
}

// ============================================================================
// Velocity Conversions
// ============================================================================

/**
 * Converts a velocity on the unit sphere to km/year.
 * Assumes the simulation time unit corresponds to some geological time scale.
 *
 * @param unitVelocity - Velocity magnitude on unit sphere (radians per time unit)
 * @param timeUnitYears - How many years one simulation time unit represents (default: 1 million years)
 * @returns Velocity in km/year
 */
export function velocityToKmPerYear(unitVelocity: number, timeUnitYears: number = 1_000_000): number {
  return (unitVelocity * WORLD_RADIUS_KM) / timeUnitYears;
}

/**
 * Converts a velocity on the unit sphere to cm/year (common unit for plate tectonics).
 *
 * @param unitVelocity - Velocity magnitude on unit sphere
 * @param timeUnitYears - How many years one simulation time unit represents (default: 1 million years)
 * @returns Velocity in cm/year
 */
export function velocityToCmPerYear(unitVelocity: number, timeUnitYears: number = 1_000_000): number {
  return velocityToKmPerYear(unitVelocity, timeUnitYears) * 100_000; // km to cm
}
