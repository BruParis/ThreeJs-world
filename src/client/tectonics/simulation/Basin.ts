import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, TectonicSystem, PlateBoundary } from '../data/Plate';
import { getNeighborTilesInPlate, getMotionDecile, getAreaDecile } from './GeologyUtils';
import { kmToDistance } from '../../world/World';

// ============================================================================
// Basin Assignment
// ============================================================================
//
// Case 1: Foreland Basins
// - Form behind mountain ranges (orogens) at convergent boundaries
// - For each convergent boundary where at least one plate is continental
// - Navigate through orogeny to find UNKNOWN tiles, then propagate
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

  // Number of starting points per boundary length
  // Roughly 1 starting point per X km of boundary
  KM_PER_STARTING_POINT: 3000,

  // Minimum and maximum starting points per boundary
  MIN_STARTING_POINTS: 1,
  MAX_STARTING_POINTS: 5,

  // Maximum search depth when looking for UNKNOWN tiles through orogeny
  MAX_SEARCH_DEPTH: 50,

  // Probability of propagation (adds randomization)
  PROPAGATION_PROBABILITY: 0.75,
};

// ============================================================================
// Starting Point Selection
// ============================================================================

/**
 * Estimates the length of a boundary in km based on its edge count.
 * Uses average edge length approximation.
 */
function estimateBoundaryLengthKm(boundary: PlateBoundary): number {
  // Count convergent edges only
  let convergentEdgeCount = 0;
  let totalEdgeLength = 0;

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType === BoundaryType.CONVERGENT) {
      convergentEdgeCount++;
      const he = bEdge.halfedge;
      const edgeLength = he.vertex.position.distanceTo(he.twin.vertex.position);
      totalEdgeLength += edgeLength;
    }
  }

  if (convergentEdgeCount === 0) {
    return 0;
  }

  // Convert unit sphere distance to km (Earth radius ~6371 km)
  const earthRadiusKm = 6371;
  return totalEdgeLength * earthRadiusKm;
}

/**
 * Determines how many starting points to use for a boundary based on its length.
 */
function computeStartingPointCount(boundaryLengthKm: number): number {
  const count = Math.round(boundaryLengthKm / BASIN_CONFIG.KM_PER_STARTING_POINT);
  return Math.max(
    BASIN_CONFIG.MIN_STARTING_POINTS,
    Math.min(BASIN_CONFIG.MAX_STARTING_POINTS, count)
  );
}

/**
 * Selects evenly-spaced starting tiles from convergent boundary edges on a continental plate.
 */
function selectBoundaryStartingTiles(
  boundary: PlateBoundary,
  continentalPlate: Plate,
  tectonicSystem: TectonicSystem,
  count: number
): Tile[] {
  // Collect all continental tiles at convergent edges
  const boundaryTiles: Tile[] = [];
  const seenTiles = new Set<Tile>();

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    // Add tiles from the continental plate
    if (tileA && tileA.plate === continentalPlate && !seenTiles.has(tileA)) {
      boundaryTiles.push(tileA);
      seenTiles.add(tileA);
    }
    if (tileB && tileB.plate === continentalPlate && !seenTiles.has(tileB)) {
      boundaryTiles.push(tileB);
      seenTiles.add(tileB);
    }
  }

  if (boundaryTiles.length === 0) {
    return [];
  }

  // Select evenly-spaced tiles
  const selectedTiles: Tile[] = [];
  const step = Math.max(1, Math.floor(boundaryTiles.length / count));

  for (let i = 0; i < count && i * step < boundaryTiles.length; i++) {
    selectedTiles.push(boundaryTiles[i * step]);
  }

  return selectedTiles;
}

// ============================================================================
// Navigation Through Orogeny to Find Basin Starting Points
// ============================================================================

/**
 * Navigates from a boundary tile into the continental plate interior,
 * passing through orogeny tiles until finding UNKNOWN tiles.
 * Returns the first UNKNOWN tile found, or null if none found.
 */
function findBasinStartingTile(
  startTile: Tile,
  tectonicSystem: TectonicSystem
): Tile | null {
  const visited = new Set<Tile>();
  let currentWave: Tile[] = [startTile];
  visited.add(startTile);

  for (let depth = 0; depth < BASIN_CONFIG.MAX_SEARCH_DEPTH; depth++) {
    const nextWave: Tile[] = [];

    for (const tile of currentWave) {
      // Get neighbors in the same plate
      const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);

        // If we found an UNKNOWN tile, this is our starting point
        if (neighbor.geologicalType === GeologicalType.UNKNOWN) {
          return neighbor;
        }

        // Continue through orogeny tiles
        if (neighbor.geologicalType === GeologicalType.OROGEN ||
            neighbor.geologicalType === GeologicalType.ANCIENT_OROGEN) {
          nextWave.push(neighbor);
        }
      }
    }

    if (nextWave.length === 0) {
      break;
    }

    currentWave = nextWave;
  }

  return null;
}

// ============================================================================
// Basin Propagation
// ============================================================================

/**
 * Performs basin propagation from a starting tile.
 * Propagates in all directions with randomization.
 * Limited by area ratio of the target plate.
 *
 * @param startTile - The tile to start propagation from
 * @param plate - The plate we're propagating into (for area limit calculation)
 * @param tectonicSystem - The tectonic system
 * @param globalAssigned - Set of tiles already assigned (modified in place)
 * @returns Number of tiles assigned to this basin
 */
function propagateBasin(
  startTile: Tile,
  plate: Plate,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  // Compute maximum area for this basin based on plate area
  const maxArea = plate.area * BASIN_CONFIG.MAX_AREA_RATIO_PER_BASIN;

  const assigned = new Set<Tile>();
  let assignedArea = 0;

  // Initialize with starting tile
  startTile.geologicalType = GeologicalType.BASIN;
  assigned.add(startTile);
  globalAssigned.add(startTile);
  assignedArea += startTile.area;

  let currentWave: Tile[] = [startTile];

  while (currentWave.length > 0) {
    const nextWave: Tile[] = [];

    for (const tile of currentWave) {
      // Get neighbors in the same plate
      const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

      for (const neighbor of neighbors) {
        // Skip already assigned in this basin
        if (assigned.has(neighbor)) {
          continue;
        }

        // Skip tiles already assigned globally (other basins or other types)
        if (globalAssigned.has(neighbor)) {
          continue;
        }

        // Only propagate to UNKNOWN tiles
        if (neighbor.geologicalType !== GeologicalType.UNKNOWN) {
          continue;
        }

        // Check area limit
        if (assignedArea + neighbor.area > maxArea) {
          continue;
        }

        // Random chance to skip (adds irregularity)
        if (Math.random() > BASIN_CONFIG.PROPAGATION_PROBABILITY) {
          continue;
        }

        // Assign basin type
        neighbor.geologicalType = GeologicalType.BASIN;
        assigned.add(neighbor);
        globalAssigned.add(neighbor);
        assignedArea += neighbor.area;

        // Add to next wave
        nextWave.push(neighbor);
      }
    }

    currentWave = nextWave;
  }

  return assigned.size;
}

// ============================================================================
// Foreland Basin Assignment at Convergent Boundaries
// ============================================================================

/**
 * Processes a single convergent boundary for foreland basin assignment.
 * For each continental plate on the boundary, navigates through orogeny
 * to find UNKNOWN tiles and starts basin propagation.
 */
function assignForelandBasinsAtBoundary(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  // Check if at least one plate is continental
  const plateAisContinental = plateA.category === PlateCategory.CONTINENTAL;
  const plateBisContinental = plateB.category === PlateCategory.CONTINENTAL;

  if (!plateAisContinental && !plateBisContinental) {
    return 0;
  }

  // Check if boundary has convergent edges
  let hasConvergent = false;
  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType === BoundaryType.CONVERGENT) {
      hasConvergent = true;
      break;
    }
  }

  if (!hasConvergent) {
    return 0;
  }

  // Estimate boundary length and compute starting point count
  const boundaryLengthKm = estimateBoundaryLengthKm(boundary);
  const startingPointCount = computeStartingPointCount(boundaryLengthKm);

  let totalBasinTiles = 0;

  // Process each continental plate on this boundary
  const continentalPlates: Plate[] = [];
  if (plateAisContinental) continentalPlates.push(plateA);
  if (plateBisContinental) continentalPlates.push(plateB);

  for (const continentalPlate of continentalPlates) {
    // Select starting tiles at the boundary
    const boundaryStartTiles = selectBoundaryStartingTiles(
      boundary,
      continentalPlate,
      tectonicSystem,
      startingPointCount
    );

    // For each starting tile, navigate through orogeny to find basin starting point
    for (const boundaryTile of boundaryStartTiles) {
      const basinStartTile = findBasinStartingTile(boundaryTile, tectonicSystem);

      if (basinStartTile && !globalAssigned.has(basinStartTile)) {
        // Propagate basin from this starting point (limited by plate area ratio)
        const count = propagateBasin(basinStartTile, continentalPlate, tectonicSystem, globalAssigned);
        totalBasinTiles += count;
      }
    }
  }

  return totalBasinTiles;
}

// ============================================================================
// Main Entry Point - Case 1: Foreland Basins
// ============================================================================

/**
 * Assigns Basin geological type - Case 1: Foreland Basins.
 *
 * For each convergent boundary where at least one plate is continental:
 * 1. Select starting points along the boundary
 * 2. Navigate into the continental plate, passing through orogeny
 * 3. When reaching UNKNOWN tiles, start Basin propagation
 * 4. Propagate in all directions with randomization (limited by area ratio per basin)
 */
export function assignForelandBasins(tectonicSystem: TectonicSystem): void {
  const globalAssigned = new Set<Tile>();
  let totalBasinTiles = 0;
  let basinCount = 0;

  // Process each boundary
  for (const boundary of tectonicSystem.boundaries) {
    const tilesAssigned = assignForelandBasinsAtBoundary(boundary, tectonicSystem, globalAssigned);
    if (tilesAssigned > 0) {
      totalBasinTiles += tilesAssigned;
      basinCount++;
    }
  }

  console.log(`Assigned BASIN (foreland) to ${totalBasinTiles} tiles in ${basinCount} basins`);
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
