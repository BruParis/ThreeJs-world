import * as THREE from 'three';
import { Tile, Plate, PlateCategory, GeologicalType, TectonicSystem, PlateBoundary, BoundaryEdge } from '../data/Plate';
import { getNeighborTilesInPlate, getUnassignedTiles } from './GeologyUtils';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';

// ============================================================================
// Shield Configuration (Perlin Noise-based)
// ============================================================================

/**
 * Configuration for shield zones (ancient cratonic cores).
 * Uses Perlin noise to determine which tiles become shield.
 * Favors tiles closer to plate centroid.
 */
const SHIELD_CONFIG = {
  // Target area coverage (fraction of plate area that becomes shield)
  TARGET_AREA_RATIO: [0.6, 0.8] as [number, number],  // 60%-80% of plate area

  // Perlin noise parameters for shield distribution
  NOISE_SCALE: 5.0,     // Scale of noise features (larger = more intricate patterns)
  NOISE_OCTAVES: 3,     // Fewer octaves for smoother, larger shield regions

  // Centroid distance weighting - favors shield near plate center
  // Power for distance decay (higher = stronger center bias)
  // Actually, weight_power < 1 showed better results, > 1 tended make just 
  // near-circular blobs near the centers
  CENTROID_WEIGHT_POWER: 0.7,
};

// ============================================================================
// Platform Configuration
// ============================================================================

/**
 * Configuration for platform zones (sedimentary cover on shield).
 * Uses Perlin noise to determine which shield tiles become platform.
 * All areas are in unit sphere units (no km conversion).
 */
const PLATFORM_CONFIG = {
  // Target area coverage (fraction of shield area that becomes platform)
  TARGET_AREA_RATIO: [0.4, 0.6] as [number, number],  // 40%-60% of shield area

  // Perlin noise parameters for platform distribution
  NOISE_SCALE: 6.0,     // Scale of noise features (larger = more intricate patterns)
  NOISE_OCTAVES: 4,     // More octaves for additional detail
};

// ============================================================================
// Continental Margin Refinement Configuration
// ============================================================================

// Earth radius for distance conversions (km to unit sphere)
const EARTH_RADIUS_KM = 6371;

/**
 * Configuration for refining Shield/Platform near oceanic boundaries.
 * Cratons (Shield/Platform) rarely extend to continental margins.
 * This refinement re-assigns Shield/Platform near oceanic boundaries to UNKNOWN.
 */
const MARGIN_REFINEMENT_CONFIG = {
  // Probability to initiate a re-assignment zone when encountering Shield/Platform
  REASSIGNMENT_PROBABILITY: 0.6,

  // Along-boundary extent of re-assignment zone (km)
  ALONG_BOUNDARY_MIN_KM: 700,
  ALONG_BOUNDARY_MAX_KM: 2000,

  // Inland extent of re-assignment zone (km)
  INLAND_WIDTH_MIN_KM: 100,
  INLAND_WIDTH_MAX_KM: 300,
};

/**
 * Converts kilometers to unit sphere distance (arc length on radius 1 sphere).
 */
function kmToUnitSphere(km: number): number {
  return km / EARTH_RADIUS_KM;
}

// ============================================================================
// Continental Margin Refinement
// ============================================================================

/**
 * Finds boundaries between a continental plate and oceanic plates.
 */
function findOceanicBoundaries(plate: Plate, tectonicSystem: TectonicSystem): PlateBoundary[] {
  const oceanicBoundaries: PlateBoundary[] = [];

  for (const boundary of tectonicSystem.boundaries) {
    // Check if this boundary involves our plate and an oceanic plate
    const isPlateInvolved = boundary.plateA === plate || boundary.plateB === plate;
    if (!isPlateInvolved) continue;

    const otherPlate = boundary.plateA === plate ? boundary.plateB : boundary.plateA;
    if (otherPlate.category === PlateCategory.OCEANIC) {
      oceanicBoundaries.push(boundary);
    }
  }

  return oceanicBoundaries;
}

/**
 * Gets the tile on the continental plate side of a boundary edge.
 */
function getTileOnPlateSide(boundaryEdge: BoundaryEdge, plate: Plate, tectonicSystem: TectonicSystem): Tile | null {
  const tile = tectonicSystem.edge2TileMap.get(boundaryEdge.halfedge);
  if (tile && tile.plate === plate) {
    return tile;
  }

  const twinTile = tectonicSystem.edge2TileMap.get(boundaryEdge.halfedge.twin);
  if (twinTile && twinTile.plate === plate) {
    return twinTile;
  }

  return null;
}

/**
 * Expands re-assignment inland from boundary tiles using BFS.
 * Only re-assigns Shield and Platform tiles to UNKNOWN.
 * @param startTiles - Tiles along the boundary to start from
 * @param maxInlandDistance - Maximum inland distance (unit sphere)
 * @param tectonicSystem - The tectonic system
 * @returns Number of tiles re-assigned
 */
function expandReassignmentInland(
  startTiles: Set<Tile>,
  maxInlandDistance: number,
  tectonicSystem: TectonicSystem
): number {
  let reassignedCount = 0;

  // Track visited tiles and their distances
  const visited = new Set<Tile>();
  const tileDistances = new Map<Tile, number>();

  // Initialize with boundary tiles (distance 0)
  for (const tile of startTiles) {
    visited.add(tile);
    tileDistances.set(tile, 0);

    // Re-assign if Shield or Platform
    if (tile.geologicalType === GeologicalType.SHIELD ||
        tile.geologicalType === GeologicalType.PLATFORM) {
      tile.geologicalType = GeologicalType.UNKNOWN;
      reassignedCount++;
    }
  }

  // BFS to expand inland
  let wave = Array.from(startTiles);

  while (wave.length > 0) {
    const nextWave: Tile[] = [];

    for (const currentTile of wave) {
      const currentDistance = tileDistances.get(currentTile) || 0;

      // Get neighbors within the same plate
      const neighbors = getNeighborTilesInPlate(currentTile, tectonicSystem);

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;

        // Calculate distance from current tile to neighbor
        const stepDistance = currentTile.centroid.distanceTo(neighbor.centroid);
        const neighborDistance = currentDistance + stepDistance;

        // Check if within max inland distance
        if (neighborDistance > maxInlandDistance) continue;

        visited.add(neighbor);
        tileDistances.set(neighbor, neighborDistance);

        // Re-assign if Shield or Platform
        if (neighbor.geologicalType === GeologicalType.SHIELD ||
            neighbor.geologicalType === GeologicalType.PLATFORM) {
          neighbor.geologicalType = GeologicalType.UNKNOWN;
          reassignedCount++;
        }

        nextWave.push(neighbor);
      }
    }

    wave = nextWave;
  }

  return reassignedCount;
}

/**
 * Refines Shield and Platform assignments near oceanic boundaries.
 * For each boundary with an oceanic plate, iterates along the boundary
 * and probabilistically creates re-assignment zones that extend inland.
 * When choosing NOT to re-assign, skips along the boundary for the same distance range.
 */
function refineMarginGeology(plate: Plate, tectonicSystem: TectonicSystem): number {
  const oceanicBoundaries = findOceanicBoundaries(plate, tectonicSystem);
  if (oceanicBoundaries.length === 0) {
    return 0;
  }

  let totalReassigned = 0;

  for (const boundary of oceanicBoundaries) {
    // Track distance along boundary
    let boundaryTraveledDistance = 0;
    let lastEdgePosition: THREE.Vector3 | null = null;

    // State for current re-assignment zone
    let inReassignmentZone = false;
    let zoneTargetAlongDistance = 0;
    let zoneInlandWidth = 0;
    let zoneBoundaryTiles = new Set<Tile>();
    let zoneStartDistance = 0;

    // State for skip zone (when we decided NOT to re-assign)
    let inSkipZone = false;
    let skipTargetDistance = 0;
    let skipStartDistance = 0;

    // Iterate along boundary from one end to the other
    for (const boundaryEdge of boundary.iterateEdges()) {
      // Compute edge midpoint for distance calculation
      const edgeMidpoint = boundaryEdge.halfedge.vertex.position.clone()
        .add(boundaryEdge.halfedge.twin.vertex.position)
        .multiplyScalar(0.5)
        .normalize();

      // Update traveled distance
      if (lastEdgePosition) {
        boundaryTraveledDistance += lastEdgePosition.distanceTo(edgeMidpoint);
      }
      lastEdgePosition = edgeMidpoint;

      // Get the tile on the continental plate side
      const tile = getTileOnPlateSide(boundaryEdge, plate, tectonicSystem);
      if (!tile) continue;

      // Check if tile is Shield or Platform
      const isCratonic = tile.geologicalType === GeologicalType.SHIELD ||
                         tile.geologicalType === GeologicalType.PLATFORM;

      if (inReassignmentZone) {
        // Continue accumulating tiles in the zone
        zoneBoundaryTiles.add(tile);

        // Check if zone should end (exceeded target along-boundary distance)
        const zoneDistance = boundaryTraveledDistance - zoneStartDistance;
        if (zoneDistance >= zoneTargetAlongDistance) {
          // Finalize zone: expand inland and re-assign
          totalReassigned += expandReassignmentInland(
            zoneBoundaryTiles,
            zoneInlandWidth,
            tectonicSystem
          );

          // Reset zone state
          inReassignmentZone = false;
          zoneBoundaryTiles = new Set<Tile>();
        }
      } else if (inSkipZone) {
        // Check if skip zone should end
        const skipDistance = boundaryTraveledDistance - skipStartDistance;
        if (skipDistance >= skipTargetDistance) {
          inSkipZone = false;
        }
        // Otherwise, just continue skipping (do nothing)
      } else if (isCratonic) {
        // Potentially start a new re-assignment zone or skip zone
        const minAlong = kmToUnitSphere(MARGIN_REFINEMENT_CONFIG.ALONG_BOUNDARY_MIN_KM);
        const maxAlong = kmToUnitSphere(MARGIN_REFINEMENT_CONFIG.ALONG_BOUNDARY_MAX_KM);
        const alongDistance = minAlong + Math.random() * (maxAlong - minAlong);

        if (Math.random() < MARGIN_REFINEMENT_CONFIG.REASSIGNMENT_PROBABILITY) {
          // Start re-assignment zone
          inReassignmentZone = true;
          zoneStartDistance = boundaryTraveledDistance;
          zoneTargetAlongDistance = alongDistance;

          // Random inland width
          const minInland = kmToUnitSphere(MARGIN_REFINEMENT_CONFIG.INLAND_WIDTH_MIN_KM);
          const maxInland = kmToUnitSphere(MARGIN_REFINEMENT_CONFIG.INLAND_WIDTH_MAX_KM);
          zoneInlandWidth = minInland + Math.random() * (maxInland - minInland);

          zoneBoundaryTiles.add(tile);
        } else {
          // Start skip zone (same distance range as re-assignment)
          inSkipZone = true;
          skipStartDistance = boundaryTraveledDistance;
          skipTargetDistance = alongDistance;
        }
      }
    }

    // Handle any remaining zone at the end of the boundary
    if (inReassignmentZone && zoneBoundaryTiles.size > 0) {
      totalReassigned += expandReassignmentInland(
        zoneBoundaryTiles,
        zoneInlandWidth,
        tectonicSystem
      );
    }
  }

  return totalReassigned;
}

// ============================================================================
// Shield Assignment (Perlin Noise-based with Centroid Distance Weighting)
// ============================================================================

/**
 * Computes distance statistics for ALL tiles in a plate relative to plate centroid.
 * This ensures consistent normalization across plates of different sizes.
 */
function computePlateCentroidDistanceStats(
  plate: Plate
): { minDist: number; maxDist: number } {
  const plateCentroid = plate.centroid;
  let minDist = Infinity;
  let maxDist = 0;

  for (const tile of plate.tiles) {
    const dist = tile.centroid.distanceTo(plateCentroid);
    minDist = Math.min(minDist, dist);
    maxDist = Math.max(maxDist, dist);
  }

  return { minDist, maxDist };
}

/**
 * Assigns shield type to unassigned tiles in a plate using Perlin noise.
 * Creates a unique Perlin noise field per plate with low octaves for smooth regions.
 * Weights noise by distance to plate centroid (closer = higher chance of shield).
 * Normalizes all weighted values so they sum to 1.
 * Uses cumulative distribution with target area ratio to determine which tiles become shield.
 * Returns the set of all tiles assigned as SHIELD.
 */
function assignShieldWithNoise(unassignedTiles: Tile[], plate: Plate): Set<Tile> {
  const assignedShield = new Set<Tile>();

  if (unassignedTiles.length === 0) return assignedShield;

  // Create a new Perlin noise instance with a random seed for this plate
  const seed = Math.floor(Math.random() * 100000);
  const perlinNoise = new PerlinNoise3D(seed);

  // Get plate centroid
  const plateCentroid = plate.centroid;

  // Compute distance statistics from ALL tiles in the plate (not just unassigned)
  // This ensures consistent normalization across plates of different sizes
  const { minDist, maxDist } = computePlateCentroidDistanceStats(plate);
  const distRange = maxDist - minDist;

  // Compute noise value for each unassigned tile, weighted by centroid distance
  const tileWeightedValues: Map<Tile, number> = new Map();

  for (const tile of unassignedTiles) {
    const tileCentroid = tile.centroid;

    // Sample FBM noise at tile centroid (centroid is already on unit sphere)
    const rawNoise = perlinNoise.fbm(
      tileCentroid.x * SHIELD_CONFIG.NOISE_SCALE,
      tileCentroid.y * SHIELD_CONFIG.NOISE_SCALE,
      tileCentroid.z * SHIELD_CONFIG.NOISE_SCALE,
      SHIELD_CONFIG.NOISE_OCTAVES
    );
    // Convert from [-1, 1] to [0, 1]
    const normalizedNoise = (rawNoise + 1) / 2;

    // Compute centroid distance weight (closer to centroid = higher weight)
    // Using plate-wide statistics for consistent normalization
    const dist = tileCentroid.distanceTo(plateCentroid);
    const normalizedDist = distRange > 0 ? (dist - minDist) / distRange : 0;  // 0 at closest, 1 at farthest
    // Weight: 1 at center, decays towards edge
    const centroidWeight = Math.pow(1 - normalizedDist, SHIELD_CONFIG.CENTROID_WEIGHT_POWER);

    // Combine noise with centroid weight
    const weightedValue = normalizedNoise * centroidWeight;
    tileWeightedValues.set(tile, weightedValue);
  }

  // Normalize all weighted values so they sum to 1
  let totalWeightedValue = 0;
  for (const value of tileWeightedValues.values()) {
    totalWeightedValue += value;
  }

  const tileNormalizedValues: Map<Tile, number> = new Map();
  if (totalWeightedValue > 0) {
    for (const [tile, value] of tileWeightedValues) {
      tileNormalizedValues.set(tile, value / totalWeightedValue);
    }
  } else {
    // Fallback: equal distribution
    const equalValue = 1 / unassignedTiles.length;
    for (const tile of unassignedTiles) {
      tileNormalizedValues.set(tile, equalValue);
    }
  }

  // Sample target area ratio for shield coverage
  const [minRatio, maxRatio] = SHIELD_CONFIG.TARGET_AREA_RATIO;
  const targetRatio = minRatio + Math.random() * (maxRatio - minRatio);

  // Compute total unassigned area and target shield area
  let totalUnassignedArea = 0;
  for (const tile of unassignedTiles) {
    totalUnassignedArea += tile.area;
  }
  const targetShieldArea = totalUnassignedArea * targetRatio;

  // Sort tiles by normalized value (descending - highest values first for shield)
  const sortedTiles = Array.from(unassignedTiles).sort((a, b) => {
    const valueA = tileNormalizedValues.get(a) || 0;
    const valueB = tileNormalizedValues.get(b) || 0;
    return valueB - valueA;  // Descending order (highest values first)
  });

  // Accumulate area until we reach target, marking tiles as shield
  let accumulatedArea = 0;

  for (const tile of sortedTiles) {
    if (accumulatedArea >= targetShieldArea) {
      // We've reached target area
      break;
    }

    tile.geologicalType = GeologicalType.SHIELD;
    assignedShield.add(tile);
    accumulatedArea += tile.area;
  }

  return assignedShield;
}

// ============================================================================
// Platform Propagation (Perlin Noise-based)
// ============================================================================

/**
 * Computes the total area of shield tiles.
 */
function computeShieldArea(shieldTiles: Set<Tile>): number {
  let totalArea = 0;
  for (const tile of shieldTiles) {
    totalArea += tile.area;
  }
  return totalArea;
}

/**
 * Propagates platform type within shield tiles using Perlin noise.
 * Creates a unique Perlin noise field per plate with low octaves for smooth regions.
 * Computes a threshold based on target area ratio to determine which tiles become platform.
 */
function propagatePlatformFromShield(shieldTiles: Set<Tile>): void {
  if (shieldTiles.size === 0) return;

  // Create a new Perlin noise instance with a random seed for this plate
  const seed = Math.floor(Math.random() * 100000);
  const perlinNoise = new PerlinNoise3D(seed);

  // Compute noise value for each shield tile
  const tileNoiseValues: Map<Tile, number> = new Map();

  for (const tile of shieldTiles) {
    const centroid = tile.centroid;
    // Sample FBM noise at tile centroid (centroid is already on unit sphere)
    const rawNoise = perlinNoise.fbm(
      centroid.x * PLATFORM_CONFIG.NOISE_SCALE,
      centroid.y * PLATFORM_CONFIG.NOISE_SCALE,
      centroid.z * PLATFORM_CONFIG.NOISE_SCALE,
      PLATFORM_CONFIG.NOISE_OCTAVES
    );
    // Convert from [-1, 1] to [0, 1]
    const normalizedNoise = (rawNoise + 1) / 2;
    tileNoiseValues.set(tile, normalizedNoise);
  }

  // Sample target area ratio for platform coverage
  const [minRatio, maxRatio] = PLATFORM_CONFIG.TARGET_AREA_RATIO;
  const targetRatio = minRatio + Math.random() * (maxRatio - minRatio);

  // Compute shield area and target platform area
  const shieldArea = computeShieldArea(shieldTiles);
  const targetPlatformArea = shieldArea * targetRatio;

  // Sort tiles by noise value (ascending) to find the threshold
  const sortedTiles = Array.from(shieldTiles).sort((a, b) => {
    const noiseA = tileNoiseValues.get(a) || 0;
    const noiseB = tileNoiseValues.get(b) || 0;
    return noiseA - noiseB;  // Ascending order (lowest noise first)
  });

  // Find threshold: accumulate area until we reach target
  // Tiles with noise <= threshold will become platform
  let accumulatedArea = 0;
  let threshold = 0.0;

  for (const tile of sortedTiles) {
    if (accumulatedArea >= targetPlatformArea) {
      // We've reached target area
      break;
    }
    threshold = tileNoiseValues.get(tile) || 0;
    accumulatedArea += tile.area;
  }

  // Assign Platform to all shield tiles with noise <= threshold
  for (const tile of shieldTiles) {
    const noiseValue = tileNoiseValues.get(tile) || 0;
    if (noiseValue <= threshold) {
      tile.geologicalType = GeologicalType.PLATFORM;
    }
  }
}

// ============================================================================
// Shield Zone Creation for Single Plate
// ============================================================================

/**
 * Creates shield and platform zones for a single continental plate using Perlin noise.
 * First assigns shield type to unassigned tiles based on noise threshold.
 * Then converts some shield tiles to platform based on a separate noise field.
 */
function createShieldZonesForPlate(plate: Plate): void {
  // Get unassigned tiles
  const unassignedTiles = getUnassignedTiles(plate);
  if (unassignedTiles.length === 0) return;

  // Step 1: Assign Shield using Perlin noise weighted by centroid distance
  const shieldTiles = assignShieldWithNoise(unassignedTiles, plate);

  // Step 2: Convert some Shield tiles to Platform using Perlin noise
  if (shieldTiles.size > 0) {
    propagatePlatformFromShield(shieldTiles);
  }
}

// ============================================================================
// Main Shield Assignment
// ============================================================================

/**
 * Assigns shield zones to continental plates.
 * Shield represents ancient cratonic cores (stable continental shields).
 * Platform represents sedimentary cover on the shield.
 */
export function assignShieldZones(tectonicSystem: TectonicSystem): void {
  for (const plate of tectonicSystem.plates) {
    // Only continental plates get shield zones
    if (plate.category !== PlateCategory.CONTINENTAL) {
      continue;
    }

    createShieldZonesForPlate(plate);
  }

  // Count shield and platform tiles before refinement
  let totalShieldTiles = 0;
  let totalPlatformTiles = 0;
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      if (tile.geologicalType === GeologicalType.SHIELD) {
        totalShieldTiles++;
      } else if (tile.geologicalType === GeologicalType.PLATFORM) {
        totalPlatformTiles++;
      }
    }
  }

  console.log(`Assigned SHIELD to ${totalShieldTiles} tiles, PLATFORM to ${totalPlatformTiles} tiles`);

  // Refine margin geology: re-assign Shield/Platform near oceanic boundaries to UNKNOWN
  // This reflects the geological reality that cratons rarely extend to continental margins
  let totalMarginReassigned = 0;
  for (const plate of tectonicSystem.plates) {
    if (plate.category !== PlateCategory.CONTINENTAL) {
      continue;
    }

    totalMarginReassigned += refineMarginGeology(plate, tectonicSystem);
  }

  if (totalMarginReassigned > 0) {
    // Recount after refinement
    let refinedShieldTiles = 0;
    let refinedPlatformTiles = 0;
    for (const plate of tectonicSystem.plates) {
      for (const tile of plate.tiles) {
        if (tile.geologicalType === GeologicalType.SHIELD) {
          refinedShieldTiles++;
        } else if (tile.geologicalType === GeologicalType.PLATFORM) {
          refinedPlatformTiles++;
        }
      }
    }

    console.log(`Margin refinement: re-assigned ${totalMarginReassigned} tiles from Shield/Platform to UNKNOWN`);
    console.log(`After refinement: SHIELD ${refinedShieldTiles} tiles, PLATFORM ${refinedPlatformTiles} tiles`);
  }
}
