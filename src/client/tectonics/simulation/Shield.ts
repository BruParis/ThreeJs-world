import * as THREE from 'three';
import { Tile, Plate, PlateCategory, GeologicalType, TectonicSystem } from '../data/Plate';
import { getAreaDecile, getNeighborTilesInPlate, getUnassignedTiles } from './GeologyUtils';

// ============================================================================
// Shield Configuration
// ============================================================================

/**
 * Configuration for shield zones (ancient cratonic cores).
 * Uses area-based limits for resolution independence.
 */
const SHIELD_CONFIG = {
  // Number of nuclei per plate based on size decile
  LARGE_PLATE_NUCLEI: [4, 6] as [number, number],      // Decile 7-9
  MODERATE_PLATE_NUCLEI: [2, 4] as [number, number],   // Decile 4-6
  SMALL_PLATE_NUCLEI: [0, 2] as [number, number],      // Decile 0-3

  // Path to centroid
  TARGET_DISTANCE_RATIO: [0.3, 0.7] as [number, number],  // 40-80% of distance to centroid

  // Diffusion - area-based limits (fraction of plate area)
  DIRECTION_WEIGHT: 0.1,           // How much direction affects probability
  DIRECTION_DRIFT: 0.2,            // How much direction can change per step
  TARGET_AREA_RATIO: [0.4, 0.6] as [number, number],  // 40%-60% of plate area

  // Area-based probability: probability decreases as we approach target area
  // P = BASE_PROB * (1 - (accumulatedArea / targetArea))^DECAY_EXPONENT
  BASE_PROPAGATION_PROBABILITY: 0.9,  // Starting probability at 0% coverage
  DECAY_EXPONENT: 1.5,                // How fast probability drops with coverage
};

// ============================================================================
// Platform Configuration
// ============================================================================

/**
 * Configuration for platform zones (sedimentary cover on shield).
 * Uses area-based limits for resolution independence.
 * All areas are in unit sphere units (no km conversion).
 */
const PLATFORM_CONFIG = {
  // Area-based nuclei count (1 nucleus per X fraction of shield area)
  AREA_RATIO_PER_NUCLEUS: 0.15,    // 1 nucleus per 15% of shield area
  MIN_NUCLEI: 3,                    // Minimum number of platform nuclei
  MAX_NUCLEI: 8,                    // Maximum number of platform nuclei

  // Propagation - area-based limits (fraction of shield area)
  TARGET_AREA_RATIO: [0.4, 0.6] as [number, number],  // 40%-60% of shield area

  // Area-based probability: probability decreases as we approach target area
  // P = BASE_PROB * (1 - (accumulatedArea / targetArea))^DECAY_EXPONENT
  BASE_PROPAGATION_PROBABILITY: 0.95,  // Starting probability at 0% coverage
  DECAY_EXPONENT: 1.2,                 // How fast probability drops with coverage

  // Minimum shield/platform neighbors for UNKNOWN tiles to be included
  MIN_CRATON_NEIGHBORS: 3,
};

// ============================================================================
// Shield Nuclei Count
// ============================================================================

/**
 * Determines the number of shield nuclei for a plate based on its size.
 * Always returns at least 1 to ensure every continental plate has a shield.
 */
function getShieldNucleiCount(plate: Plate, tectonicSystem: TectonicSystem): number {
  const areaDecile = getAreaDecile(plate.area, tectonicSystem);

  let range: [number, number];
  if (areaDecile >= 7) {
    range = SHIELD_CONFIG.LARGE_PLATE_NUCLEI;
  } else if (areaDecile >= 4) {
    range = SHIELD_CONFIG.MODERATE_PLATE_NUCLEI;
  } else {
    range = SHIELD_CONFIG.SMALL_PLATE_NUCLEI;
  }

  const [min, max] = range;
  const count = Math.floor(min + Math.random() * (max - min + 1));

  // Ensure at least 1 shield nucleus per continental plate
  return Math.max(1, count);
}

// ============================================================================
// Shield Path Creation
// ============================================================================

/**
 * Creates a shield path from a seed tile toward the plate centroid.
 * Stops when target distance is reached or an existing shield tile is encountered.
 */
function createShieldPath(
  seed: Tile,
  plate: Plate,
  tectonicSystem: TectonicSystem,
  assignedShield: Set<Tile>
): Tile[] {
  const path: Tile[] = [];
  const centroid = plate.centroid;

  // Target distance: percentage of seed-to-centroid distance
  const totalDistance = seed.centroid.distanceTo(centroid);
  const [minRatio, maxRatio] = SHIELD_CONFIG.TARGET_DISTANCE_RATIO;
  const targetRatio = minRatio + Math.random() * (maxRatio - minRatio);
  const targetDistance = totalDistance * targetRatio;

  let current = seed;
  let traveled = 0;

  while (traveled < targetDistance) {
    // Find edge closest to centroid direction
    const toCentroid = centroid.clone().sub(current.centroid).normalize();
    let bestNeighbor: Tile | null = null;
    let bestAlignment = -Infinity;

    for (const he of current.loop()) {
      const neighbor = tectonicSystem.edge2TileMap.get(he.twin);
      if (!neighbor || neighbor.plate !== plate) continue;

      // Stop before hitting existing shield
      if (assignedShield.has(neighbor)) {
        return path; // Stop here
      }

      // Only consider unassigned tiles
      if (neighbor.geologicalType !== GeologicalType.UNKNOWN) continue;

      const toNeighbor = neighbor.centroid.clone().sub(current.centroid).normalize();
      const alignment = toNeighbor.dot(toCentroid);

      if (alignment > bestAlignment) {
        bestAlignment = alignment;
        bestNeighbor = neighbor;
      }
    }

    if (!bestNeighbor) break;

    path.push(bestNeighbor);
    assignedShield.add(bestNeighbor);
    bestNeighbor.geologicalType = GeologicalType.SHIELD;
    traveled += current.centroid.distanceTo(bestNeighbor.centroid);
    current = bestNeighbor;
  }

  return path;
}

// ============================================================================
// Shield Diffusion Propagation
// ============================================================================

/**
 * State for shield diffusion propagation.
 */
interface ShieldPropagatingState {
  tile: Tile;
  direction: THREE.Vector3;  // Current propagation direction
}

/**
 * Computes area-based propagation probability.
 * Probability decreases as accumulated area approaches target area.
 * P = BASE_PROB * (1 - ratio)^DECAY_EXPONENT
 */
function computeShieldAreaProbability(accumulatedArea: number, targetArea: number): number {
  const ratio = Math.min(1, accumulatedArea / targetArea);
  const remainingRatio = 1 - ratio;
  return SHIELD_CONFIG.BASE_PROPAGATION_PROBABILITY * Math.pow(remainingRatio, SHIELD_CONFIG.DECAY_EXPONENT);
}

/**
 * Propagates shield type outward from initial path tiles using probabilistic diffusion.
 * Direction bias and area-based limits control the spread pattern.
 * Probability is computed based on area coverage ratio (resolution-independent).
 * Stops when target area coverage is reached.
 * Returns the set of all tiles assigned as SHIELD during this propagation.
 */
function propagateShieldFromPaths(
  initialTiles: Tile[],
  plate: Plate,
  tectonicSystem: TectonicSystem
): Set<Tile> {
  const assigned = new Set<Tile>(initialTiles);

  if (initialTiles.length === 0) return assigned;

  // Compute target area (random fraction of plate area)
  const [minRatio, maxRatio] = SHIELD_CONFIG.TARGET_AREA_RATIO;
  const targetRatio = minRatio + Math.random() * (maxRatio - minRatio);
  const targetArea = plate.area * targetRatio;

  // Compute initial accumulated area from path tiles
  let accumulatedArea = 0;
  for (const tile of initialTiles) {
    accumulatedArea += tile.area;
  }

  // Initialize wave with tiles from paths
  let wave: ShieldPropagatingState[] = initialTiles.map(tile => ({
    tile,
    direction: plate.centroid.clone().sub(tile.centroid).normalize()
  }));

  while (wave.length > 0 && accumulatedArea < targetArea) {
    const nextWave: ShieldPropagatingState[] = [];

    // Compute current probability based on area coverage
    const baseProbability = computeShieldAreaProbability(accumulatedArea, targetArea);

    for (const state of wave) {
      // Stop if we've reached target area
      if (accumulatedArea >= targetArea) break;

      const neighbors = getNeighborTilesInPlate(state.tile, tectonicSystem);

      for (const neighbor of neighbors) {
        if (assigned.has(neighbor)) continue;
        if (neighbor.geologicalType !== GeologicalType.UNKNOWN) continue;

        // Compute direction-weighted probability
        const toNeighbor = neighbor.centroid.clone().sub(state.tile.centroid).normalize();
        const alignment = Math.max(0, toNeighbor.dot(state.direction));
        const prob = baseProbability * (1 - SHIELD_CONFIG.DIRECTION_WEIGHT + SHIELD_CONFIG.DIRECTION_WEIGHT * alignment);

        if (Math.random() < prob) {
          neighbor.geologicalType = GeologicalType.SHIELD;
          assigned.add(neighbor);
          accumulatedArea += neighbor.area;

          // Update direction with drift
          const newDirection = state.direction.clone()
            .lerp(toNeighbor, SHIELD_CONFIG.DIRECTION_DRIFT)
            .normalize();

          nextWave.push({
            tile: neighbor,
            direction: newDirection
          });

          // Stop if we've reached target area
          if (accumulatedArea >= targetArea) break;
        }
      }
    }

    wave = nextWave;
  }

  return assigned;
}

// ============================================================================
// Platform Propagation
// ============================================================================

/**
 * Counts how many neighbors of a tile are SHIELD or PLATFORM type.
 */
function countCratonNeighbors(tile: Tile, tectonicSystem: TectonicSystem): number {
  let count = 0;
  for (const he of tile.loop()) {
    const neighbor = tectonicSystem.edge2TileMap.get(he.twin);
    if (neighbor && (neighbor.geologicalType === GeologicalType.SHIELD || neighbor.geologicalType === GeologicalType.PLATFORM)) {
      count++;
    }
  }
  return count;
}

/**
 * Checks if a tile can be converted to PLATFORM.
 * A tile is eligible if:
 * - It is SHIELD type, OR
 * - It is UNKNOWN type and has at least MIN_CRATON_NEIGHBORS neighbors that are SHIELD or PLATFORM
 */
function canConvertToPlatform(tile: Tile, tectonicSystem: TectonicSystem): boolean {
  if (tile.geologicalType === GeologicalType.SHIELD) {
    return true;
  }
  if (tile.geologicalType === GeologicalType.UNKNOWN) {
    return countCratonNeighbors(tile, tectonicSystem) >= PLATFORM_CONFIG.MIN_CRATON_NEIGHBORS;
  }
  return false;
}

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
 * Determines the number of platform nuclei.
 * Divides shield into chunks based on AREA_RATIO_PER_NUCLEUS.
 * E.g., if ratio is 0.15, we get ~6-7 nuclei (1/0.15), clamped to MIN/MAX.
 */
function getPlatformNucleiCount(): number {
  // Nuclei count based on dividing shield into chunks
  const nucleiFromRatio = Math.floor(1 / PLATFORM_CONFIG.AREA_RATIO_PER_NUCLEUS);
  return Math.min(
    PLATFORM_CONFIG.MAX_NUCLEI,
    Math.max(PLATFORM_CONFIG.MIN_NUCLEI, nucleiFromRatio)
  );
}

/**
 * State for platform propagation.
 */
interface PlatformPropagatingState {
  tile: Tile;
}

/**
 * Computes area-based propagation probability for platform.
 * Probability decreases as accumulated area approaches target area.
 * P = BASE_PROB * (1 - ratio)^DECAY_EXPONENT
 */
function computePlatformAreaProbability(accumulatedArea: number, targetArea: number): number {
  const ratio = Math.min(1, accumulatedArea / targetArea);
  const remainingRatio = 1 - ratio;
  return PLATFORM_CONFIG.BASE_PROPAGATION_PROBABILITY * Math.pow(remainingRatio, PLATFORM_CONFIG.DECAY_EXPONENT);
}

/**
 * Propagates platform type within shield tiles and eligible unknown tiles.
 * Starts from random shield tiles and spreads using area-based probabilistic propagation.
 * Stops when target area coverage (fraction of shield area) is reached.
 */
function propagatePlatformFromShield(
  shieldTiles: Set<Tile>,
  tectonicSystem: TectonicSystem
): void {
  if (shieldTiles.size === 0) return;

  // Compute shield area (in unit sphere units)
  const shieldArea = computeShieldArea(shieldTiles);

  // Compute target platform area (random fraction of shield area)
  const [minRatio, maxRatio] = PLATFORM_CONFIG.TARGET_AREA_RATIO;
  const targetRatio = minRatio + Math.random() * (maxRatio - minRatio);
  const targetArea = shieldArea * targetRatio;

  // Determine number of platform nuclei
  const nucleiCount = getPlatformNucleiCount();

  // Select random shield tiles as starting points
  const shieldArray = Array.from(shieldTiles);

  // shuffle the shieldArray to ensure randomness
  for (let i = shieldArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shieldArray[i], shieldArray[j]] = [shieldArray[j], shieldArray[i]];
  }

  const startingTiles: Tile[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < nucleiCount && usedIndices.size < shieldArray.length; i++) {
    let index: number;
    do {
      index = Math.floor(Math.random() * shieldArray.length);
    } while (usedIndices.has(index));

    usedIndices.add(index);
    startingTiles.push(shieldArray[index]);
  }

  if (startingTiles.length === 0) return;

  // Track tiles already converted to platform and accumulated area
  const assignedPlatform = new Set<Tile>();
  let accumulatedArea = 0;

  // Convert starting tiles to platform
  for (const tile of startingTiles) {
    tile.geologicalType = GeologicalType.PLATFORM;
    assignedPlatform.add(tile);
    accumulatedArea += tile.area;
  }

  // Initialize wave
  let wave: PlatformPropagatingState[] = startingTiles.map(tile => ({
    tile
  }));

  // Propagation loop - area-based
  while (wave.length > 0 && accumulatedArea < targetArea) {
    const nextWave: PlatformPropagatingState[] = [];

    // Compute current probability based on area coverage
    const currentProbability = computePlatformAreaProbability(accumulatedArea, targetArea);

    for (const state of wave) {
      // Stop if we've reached target area
      if (accumulatedArea >= targetArea) break;

      const neighbors = getNeighborTilesInPlate(state.tile, tectonicSystem);

      for (const neighbor of neighbors) {
        if (assignedPlatform.has(neighbor)) continue;

        // Check if neighbor is eligible for platform conversion
        if (!canConvertToPlatform(neighbor, tectonicSystem)) continue;

        // Probabilistic conversion based on area coverage
        if (Math.random() < currentProbability) {
          neighbor.geologicalType = GeologicalType.PLATFORM;
          assignedPlatform.add(neighbor);
          accumulatedArea += neighbor.area;

          nextWave.push({
            tile: neighbor
          });

          // Stop if we've reached target area
          if (accumulatedArea >= targetArea) break;
        }
      }
    }

    wave = nextWave;
  }
}

// ============================================================================
// Shield Zone Creation for Single Plate
// ============================================================================

/**
 * Creates shield zones for a single continental plate.
 * Samples starting points, creates paths toward centroid, then diffuses outward.
 * After shield propagation, creates platform zones within the shield.
 */
function createShieldZonesForPlate(
  plate: Plate,
  tectonicSystem: TectonicSystem
): number {
  const nucleiCount = getShieldNucleiCount(plate, tectonicSystem);
  if (nucleiCount === 0) return 0;

  // Get unassigned tiles
  const unassignedTiles = getUnassignedTiles(plate);
  if (unassignedTiles.length === 0) return 0;

  const assignedShield = new Set<Tile>();
  const allPathTiles: Tile[] = [];

  // Create paths for each nucleus
  for (let i = 0; i < nucleiCount; i++) {
    // Select random seed from unassigned tiles not already in shield
    const availableTiles = unassignedTiles.filter(t =>
      !assignedShield.has(t) && t.geologicalType === GeologicalType.UNKNOWN
    );
    if (availableTiles.length === 0) break;

    const seed = availableTiles[Math.floor(Math.random() * availableTiles.length)];

    // Create path from seed toward centroid
    const pathTiles = createShieldPath(seed, plate, tectonicSystem, assignedShield);
    allPathTiles.push(...pathTiles);
  }

  // Propagate shield from all path tiles and collect all shield tiles
  let allShieldTiles = new Set<Tile>();
  if (allPathTiles.length > 0) {
    allShieldTiles = propagateShieldFromPaths(allPathTiles, plate, tectonicSystem);
  }

  // Propagate platform within shield tiles
  if (allShieldTiles.size > 0) {
    propagatePlatformFromShield(allShieldTiles, tectonicSystem);
  }

  return allPathTiles.length;
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

    createShieldZonesForPlate(plate, tectonicSystem);
  }

  // Count shield and platform tiles
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
}
