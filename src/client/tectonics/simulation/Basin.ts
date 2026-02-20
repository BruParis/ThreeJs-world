import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, GeologicalIntensity, TectonicSystem, PlateBoundary } from '../data/Plate';
import { getNeighborTilesInPlate, getMotionDecile, getAreaDecile } from './GeologyUtils';
import { kmToDistance } from '../../world/World';

// ============================================================================
// Basin Assignment
// ============================================================================
//
// Case 1: Foreland Basins
// - Form behind mountain ranges (orogens) at convergent boundaries
// - Start from within low/moderate intensity orogeny zones
// - Propagate to nearby low/moderate orogeny or UNKNOWN tiles
// - Limited by area ratio per basin
//
// Case 2: Rift Basins
// - Form at continental/continental divergent boundaries
// - Replace UNKNOWN or PLATFORM tiles with Basin
// - Propagate into both plates (symmetric)
// - Width depends on divergent motion amplitude (200-700km)
//
// Case 3: Intracratonic Basins
// - Form within larger continental plates
// - Randomly find Shield or Platform tiles as seeds
// - Propagate through Shield/Platform areas
// - Limited to 1% of plate area per basin
// ============================================================================

// ============================================================================
// Basin Configuration
// ============================================================================

const BASIN_CONFIG = {
  // Maximum area ratio per basin propagation (as fraction of plate area)
  // Each starting point can create a basin up to this ratio of the plate's area
  MAX_AREA_RATIO_PER_BASIN: 0.01,  // 1% of plate area per basin

  // Probability of selecting a low/moderate orogeny tile as starting point
  STARTING_PROBABILITY: 0.03,

  // Propagation width from starting point (in km)
  PROPAGATION_WIDTH_KM: 300,

  // Probability of propagation (adds randomization)
  PROPAGATION_PROBABILITY: 0.6,
};

// ============================================================================
// Helper Functions for Foreland Basins
// ============================================================================

/**
 * Checks if a tile has eligible intensity for basin starting (MODERATE or lower).
 */
function isEligibleIntensityForBasin(intensity: GeologicalIntensity): boolean {
  return intensity === GeologicalIntensity.LOW ||
         intensity === GeologicalIntensity.MODERATE;
}

/**
 * Collects all OROGEN tiles with MODERATE or lower intensity that could be
 * starting points for foreland basin assignment.
 */
function collectLowModerateOrogenyTilesForBasin(
  tectonicSystem: TectonicSystem
): Tile[] {
  const eligibleTiles: Tile[] = [];

  for (const plate of tectonicSystem.plates) {
    // Only continental plates have foreland basins
    if (plate.category !== PlateCategory.CONTINENTAL) {
      continue;
    }

    for (const tile of plate.tiles) {
      if (tile.geologicalType === GeologicalType.OROGEN &&
          isEligibleIntensityForBasin(tile.geologicalIntensity)) {
        eligibleTiles.push(tile);
      }
    }
  }

  return eligibleTiles;
}

/**
 * Randomly selects starting tiles from eligible orogeny tiles for basin assignment.
 */
function selectBasinStartingTiles(
  eligibleTiles: Tile[]
): Set<Tile> {
  const startingTiles = new Set<Tile>();

  for (const tile of eligibleTiles) {
    if (Math.random() < BASIN_CONFIG.STARTING_PROBABILITY) {
      startingTiles.add(tile);
    }
  }

  return startingTiles;
}

// ============================================================================
// Basin Propagation
// ============================================================================

/**
 * Propagates foreland basin from starting tiles within orogeny.
 * Can propagate to:
 * - OROGEN tiles with intensity <= MODERATE (convert to BASIN)
 * - UNKNOWN tiles (assign as BASIN)
 */
function propagateForelandBasin(
  startTiles: Set<Tile>,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  const maxWidth = kmToDistance(BASIN_CONFIG.PROPAGATION_WIDTH_KM);
  let totalAssigned = 0;

  // Track tiles with their distance from starting point
  interface PropagatingTile {
    tile: Tile;
    distance: number;
    plate: Plate;
  }

  // Process each starting tile independently (each becomes a separate basin)
  for (const tile of startTiles) {
    // Compute maximum area for this basin based on plate area
    const maxArea = tile.plate.area * BASIN_CONFIG.MAX_AREA_RATIO_PER_BASIN;

    // Track area per basin (each starting tile is a separate basin)
    const basinAssigned = new Set<Tile>();
    let basinArea = 0;

    // Convert starting orogeny tile to basin
    tile.geologicalType = GeologicalType.BASIN;
    tile.geologicalIntensity = GeologicalIntensity.NONE;
    basinAssigned.add(tile);
    globalAssigned.add(tile);
    basinArea += tile.area;
    totalAssigned++;

    // Propagate from this starting tile
    let wave: PropagatingTile[] = [{ tile, distance: 0, plate: tile.plate }];

    while (wave.length > 0) {
      const nextWave: PropagatingTile[] = [];

      for (const { tile: currentTile, distance, plate } of wave) {
        const neighbors = getNeighborTilesInPlate(currentTile, tectonicSystem);

        for (const neighbor of neighbors) {
          // Skip already assigned tiles
          if (basinAssigned.has(neighbor) || globalAssigned.has(neighbor)) {
            continue;
          }

          // Check if neighbor is eligible:
          // - OROGEN with intensity <= MODERATE
          // - UNKNOWN
          const isEligibleOrogen = neighbor.geologicalType === GeologicalType.OROGEN &&
                                    isEligibleIntensityForBasin(neighbor.geologicalIntensity);
          const isUnknown = neighbor.geologicalType === GeologicalType.UNKNOWN;

          if (!isEligibleOrogen && !isUnknown) {
            continue;
          }

          // Compute distance
          const stepDistance = currentTile.centroid.distanceTo(neighbor.centroid);
          const newDistance = distance + stepDistance;

          // Stop if beyond max width
          if (newDistance > maxWidth) {
            continue;
          }

          // Check area limit
          if (basinArea + neighbor.area > maxArea) {
            continue;
          }

          // Probability decreases with distance
          const distanceFactor = 1 - (newDistance / maxWidth);
          const probability = BASIN_CONFIG.PROPAGATION_PROBABILITY * distanceFactor;

          if (Math.random() < probability) {
            neighbor.geologicalType = GeologicalType.BASIN;
            neighbor.geologicalIntensity = GeologicalIntensity.NONE;
            basinAssigned.add(neighbor);
            globalAssigned.add(neighbor);
            basinArea += neighbor.area;
            totalAssigned++;
            nextWave.push({ tile: neighbor, distance: newDistance, plate });
          }
        }
      }

      wave = nextWave;
    }
  }

  return totalAssigned;
}

// ============================================================================
// Main Entry Point - Case 1: Foreland Basins
// ============================================================================

/**
 * Assigns Basin geological type - Case 1: Foreland Basins.
 *
 * Foreland basins form behind mountain ranges where compressional forces
 * create downwarping of the crust. This function:
 * 1. Collects all OROGEN tiles with MODERATE or lower intensity
 * 2. Randomly selects some as starting points
 * 3. Propagates to nearby tiles that are either:
 *    - OROGEN with intensity <= MODERATE (converts to BASIN)
 *    - UNKNOWN (assigns as BASIN)
 *
 * This function should be called after orogeny and fold-and-thrust assignment.
 */
export function assignForelandBasins(tectonicSystem: TectonicSystem): void {
  // Collect all OROGEN tiles with MODERATE or lower intensity
  const eligibleTiles = collectLowModerateOrogenyTilesForBasin(tectonicSystem);

  if (eligibleTiles.length === 0) {
    console.log('Assigned BASIN (foreland) to 0 tiles (no eligible orogeny tiles found)');
    return;
  }

  // Randomly select starting tiles
  const startingTiles = selectBasinStartingTiles(eligibleTiles);

  if (startingTiles.size === 0) {
    console.log('Assigned BASIN (foreland) to 0 tiles (no starting tiles selected)');
    return;
  }

  const globalAssigned = new Set<Tile>();

  // Propagate basins from starting tiles
  const totalAssigned = propagateForelandBasin(startingTiles, tectonicSystem, globalAssigned);

  console.log(`Assigned BASIN (foreland) to ${totalAssigned} tiles (from ${startingTiles.size} starting points within orogeny)`);
}

// ============================================================================
// Case 2: Rift Basins at Continental/Continental Divergent Boundaries
// ============================================================================

const RIFT_BASIN_CONFIG = {
  // Width limits based on divergent motion (in km)
  MIN_WIDTH_KM: 200,
  MAX_WIDTH_KM: 700,

  // Probability of propagation (adds randomization)
  PROPAGATION_PROBABILITY: 0.8,
};

/**
 * Computes the average divergent motion at a boundary.
 * Only considers divergent edges.
 */
function computeAverageDivergentMotion(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): number {
  let totalRelativeMotion = 0;
  let divergentEdgeCount = 0;

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.DIVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    if (tileA && tileB) {
      const relativeMotion = tileA.motionVec.clone().sub(tileB.motionVec).length();
      totalRelativeMotion += relativeMotion;
      divergentEdgeCount++;
    }
  }

  return divergentEdgeCount > 0 ? totalRelativeMotion / divergentEdgeCount : 0;
}

/**
 * Computes the rift basin width based on divergent motion amplitude.
 * Returns width in unit sphere distance.
 */
function computeRiftBasinWidth(
  avgMotion: number,
  tectonicSystem: TectonicSystem
): number {
  const motionDecile = getMotionDecile(avgMotion, tectonicSystem);
  const motionFactor = motionDecile / 9; // 0 to 1

  const { MIN_WIDTH_KM, MAX_WIDTH_KM } = RIFT_BASIN_CONFIG;
  const widthKm = MIN_WIDTH_KM + (MAX_WIDTH_KM - MIN_WIDTH_KM) * motionFactor;

  return kmToDistance(widthKm);
}

/**
 * Collects boundary tiles on a specific plate at divergent edges.
 */
function collectDivergentBoundaryTiles(
  boundary: PlateBoundary,
  plate: Plate,
  tectonicSystem: TectonicSystem
): Tile[] {
  const tiles: Tile[] = [];
  const seenTiles = new Set<Tile>();

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.DIVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    if (tileA && tileA.plate === plate && !seenTiles.has(tileA)) {
      tiles.push(tileA);
      seenTiles.add(tileA);
    }
    if (tileB && tileB.plate === plate && !seenTiles.has(tileB)) {
      tiles.push(tileB);
      seenTiles.add(tileB);
    }
  }

  return tiles;
}

/**
 * Checks if a tile can be converted to a rift basin.
 * Rift basins can replace UNKNOWN or PLATFORM tiles.
 */
function canConvertToRiftBasin(tile: Tile): boolean {
  return tile.geologicalType === GeologicalType.UNKNOWN ||
         tile.geologicalType === GeologicalType.PLATFORM;
}

interface RiftPropagatingTile {
  tile: Tile;
  distanceFromBoundary: number;
}

/**
 * Propagates rift basin from boundary tiles into a plate.
 * Replaces UNKNOWN or PLATFORM tiles with Basin.
 * Limited by width from boundary.
 */
function propagateRiftBasin(
  boundaryTiles: Tile[],
  maxWidth: number,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  const assigned = new Set<Tile>();
  let count = 0;

  // Initialize with boundary tiles that can be converted
  let currentWave: RiftPropagatingTile[] = [];

  for (const tile of boundaryTiles) {
    if (globalAssigned.has(tile)) {
      continue;
    }

    if (canConvertToRiftBasin(tile)) {
      tile.geologicalType = GeologicalType.BASIN;
      assigned.add(tile);
      globalAssigned.add(tile);
      count++;

      currentWave.push({
        tile,
        distanceFromBoundary: 0,
      });
    }
  }

  // Propagate inward
  while (currentWave.length > 0) {
    const nextWave: RiftPropagatingTile[] = [];

    for (const state of currentWave) {
      const { tile, distanceFromBoundary } = state;

      const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

      for (const neighbor of neighbors) {
        if (assigned.has(neighbor)) {
          continue;
        }

        if (globalAssigned.has(neighbor)) {
          continue;
        }

        if (!canConvertToRiftBasin(neighbor)) {
          continue;
        }

        // Check distance limit
        const stepDistance = neighbor.centroid.distanceTo(tile.centroid);
        const newDistance = distanceFromBoundary + stepDistance;

        if (newDistance > maxWidth) {
          continue;
        }

        // Random chance to skip (adds irregularity)
        if (Math.random() > RIFT_BASIN_CONFIG.PROPAGATION_PROBABILITY) {
          continue;
        }

        // Assign basin type
        neighbor.geologicalType = GeologicalType.BASIN;
        assigned.add(neighbor);
        globalAssigned.add(neighbor);
        count++;

        nextWave.push({
          tile: neighbor,
          distanceFromBoundary: newDistance,
        });
      }
    }

    currentWave = nextWave;
  }

  return count;
}

/**
 * Assigns rift basins at a single continental/continental divergent boundary.
 * Propagates into both plates symmetrically.
 */
function assignRiftBasinsAtBoundary(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  // Check if both plates are continental
  const bothContinental =
    plateA.category === PlateCategory.CONTINENTAL &&
    plateB.category === PlateCategory.CONTINENTAL;

  if (!bothContinental) {
    return 0;
  }

  // Check if boundary has divergent edges
  let hasDivergent = false;
  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType === BoundaryType.DIVERGENT) {
      hasDivergent = true;
      break;
    }
  }

  if (!hasDivergent) {
    return 0;
  }

  // Compute rift basin width based on motion
  const avgMotion = computeAverageDivergentMotion(boundary, tectonicSystem);
  const maxWidth = computeRiftBasinWidth(avgMotion, tectonicSystem);

  let totalTiles = 0;

  // Process plate A
  const boundaryTilesA = collectDivergentBoundaryTiles(boundary, plateA, tectonicSystem);
  totalTiles += propagateRiftBasin(boundaryTilesA, maxWidth, tectonicSystem, globalAssigned);

  // Process plate B
  const boundaryTilesB = collectDivergentBoundaryTiles(boundary, plateB, tectonicSystem);
  totalTiles += propagateRiftBasin(boundaryTilesB, maxWidth, tectonicSystem, globalAssigned);

  return totalTiles;
}

// ============================================================================
// Main Entry Point - Case 2: Rift Basins
// ============================================================================

/**
 * Assigns Basin geological type - Case 2: Rift Basins.
 *
 * For each continental/continental divergent boundary:
 * 1. Compute rift width based on divergent motion (200-700km)
 * 2. Propagate into both plates from boundary tiles
 * 3. Replace UNKNOWN or PLATFORM tiles with Basin
 */
export function assignRiftBasins(tectonicSystem: TectonicSystem): void {
  const globalAssigned = new Set<Tile>();
  let totalBasinTiles = 0;
  let boundaryCount = 0;

  for (const boundary of tectonicSystem.boundaries) {
    const tilesAssigned = assignRiftBasinsAtBoundary(boundary, tectonicSystem, globalAssigned);
    if (tilesAssigned > 0) {
      totalBasinTiles += tilesAssigned;
      boundaryCount++;
    }
  }

  console.log(`Assigned BASIN (rift) to ${totalBasinTiles} tiles at ${boundaryCount} boundaries`);
}

// ============================================================================
// Case 3: Intracratonic Basins
// ============================================================================

const INTRACRATONIC_BASIN_CONFIG = {
  // Maximum area ratio per intracratonic basin (as fraction of plate area)
  MAX_AREA_RATIO_PER_BASIN: 0.01,  // 1% of plate area

  // Minimum plate area decile to be considered "large" (0-9)
  MIN_PLATE_SIZE_DECILE: 5,

  // Number of basins based on plate size
  BASINS_PER_LARGE_PLATE: [1, 3] as [number, number],  // Decile 7-9
  BASINS_PER_MEDIUM_PLATE: [0, 2] as [number, number], // Decile 5-6

  // Maximum random tile selections before giving up finding a seed
  MAX_RANDOM_ATTEMPTS: 100,

  // Probability of propagation (adds randomization)
  PROPAGATION_PROBABILITY: 0.7,
};

/**
 * Determines how many intracratonic basins a plate should have based on its size.
 */
function getIntracratonicBasinCount(plate: Plate, tectonicSystem: TectonicSystem): number {
  const areaDecile = getAreaDecile(plate.area, tectonicSystem);

  if (areaDecile < INTRACRATONIC_BASIN_CONFIG.MIN_PLATE_SIZE_DECILE) {
    return 0;
  }

  let range: [number, number];
  if (areaDecile >= 7) {
    range = INTRACRATONIC_BASIN_CONFIG.BASINS_PER_LARGE_PLATE;
  } else {
    range = INTRACRATONIC_BASIN_CONFIG.BASINS_PER_MEDIUM_PLATE;
  }

  const [min, max] = range;
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Checks if a tile can be a seed for an intracratonic basin.
 * Seeds must be Shield or Platform tiles.
 */
function canBeIntracratonicSeed(tile: Tile): boolean {
  return tile.geologicalType === GeologicalType.SHIELD ||
         tile.geologicalType === GeologicalType.PLATFORM;
}

/**
 * Randomly selects a seed tile for an intracratonic basin.
 * Keeps trying random tiles until finding a Shield or Platform tile.
 */
function findIntracratonicSeed(
  plate: Plate,
  globalAssigned: Set<Tile>
): Tile | null {
  const tilesArray = Array.from(plate.tiles);

  for (let attempt = 0; attempt < INTRACRATONIC_BASIN_CONFIG.MAX_RANDOM_ATTEMPTS; attempt++) {
    const randomIndex = Math.floor(Math.random() * tilesArray.length);
    const tile = tilesArray[randomIndex];

    if (globalAssigned.has(tile)) {
      continue;
    }

    if (canBeIntracratonicSeed(tile)) {
      return tile;
    }
  }

  return null;
}

/**
 * Propagates an intracratonic basin from a seed tile.
 * Can replace Shield or Platform tiles.
 * Limited by area ratio of the plate.
 */
function propagateIntracratonicBasin(
  seedTile: Tile,
  plate: Plate,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  const maxArea = plate.area * INTRACRATONIC_BASIN_CONFIG.MAX_AREA_RATIO_PER_BASIN;

  const assigned = new Set<Tile>();
  let assignedArea = 0;

  // Initialize with seed tile
  seedTile.geologicalType = GeologicalType.BASIN;
  assigned.add(seedTile);
  globalAssigned.add(seedTile);
  assignedArea += seedTile.area;

  let currentWave: Tile[] = [seedTile];

  while (currentWave.length > 0) {
    const nextWave: Tile[] = [];

    for (const tile of currentWave) {
      const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

      for (const neighbor of neighbors) {
        if (assigned.has(neighbor)) {
          continue;
        }

        if (globalAssigned.has(neighbor)) {
          continue;
        }

        // Intracratonic basins can only spread through Shield or Platform
        if (!canBeIntracratonicSeed(neighbor)) {
          continue;
        }

        // Check area limit
        if (assignedArea + neighbor.area > maxArea) {
          continue;
        }

        // Random chance to skip (adds irregularity)
        if (Math.random() > INTRACRATONIC_BASIN_CONFIG.PROPAGATION_PROBABILITY) {
          continue;
        }

        // Assign basin type
        neighbor.geologicalType = GeologicalType.BASIN;
        assigned.add(neighbor);
        globalAssigned.add(neighbor);
        assignedArea += neighbor.area;

        nextWave.push(neighbor);
      }
    }

    currentWave = nextWave;
  }

  return assigned.size;
}

/**
 * Creates intracratonic basins on a single plate.
 */
function assignIntracratonicBasinsOnPlate(
  plate: Plate,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  // Only continental plates
  if (plate.category !== PlateCategory.CONTINENTAL) {
    return 0;
  }

  const basinCount = getIntracratonicBasinCount(plate, tectonicSystem);
  if (basinCount === 0) {
    return 0;
  }

  let totalTiles = 0;

  for (let i = 0; i < basinCount; i++) {
    const seed = findIntracratonicSeed(plate, globalAssigned);
    if (!seed) {
      continue;
    }

    const count = propagateIntracratonicBasin(seed, plate, tectonicSystem, globalAssigned);
    totalTiles += count;
  }

  return totalTiles;
}

// ============================================================================
// Main Entry Point - Case 3: Intracratonic Basins
// ============================================================================

/**
 * Assigns Basin geological type - Case 3: Intracratonic Basins.
 *
 * For larger continental plates:
 * 1. Determine basin count based on plate size
 * 2. Randomly select Shield or Platform tiles as seeds
 * 3. Propagate from seed, replacing Shield/Platform with Basin
 * 4. Limited to 1% of plate area per basin
 */
export function assignIntracratonicBasins(tectonicSystem: TectonicSystem): void {
  const globalAssigned = new Set<Tile>();
  let totalBasinTiles = 0;
  let plateCount = 0;

  for (const plate of tectonicSystem.plates) {
    const tilesAssigned = assignIntracratonicBasinsOnPlate(plate, tectonicSystem, globalAssigned);
    if (tilesAssigned > 0) {
      totalBasinTiles += tilesAssigned;
      plateCount++;
    }
  }

  console.log(`Assigned BASIN (intracratonic) to ${totalBasinTiles} tiles on ${plateCount} plates`);
}
