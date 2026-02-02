import * as THREE from 'three';
import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, TectonicSystem, PlateBoundary } from '../data/Plate';
import { kmToDistance } from '../../world/World';
import { getMotionDecile, getNeighborTilesInPlate } from './GeologyUtils';

// ============================================================================
// Oceanic Crust Expansion Configuration
// ============================================================================

/**
 * Oceanic crust expansion width into continental plates at divergent boundaries.
 * Low motion = ~200km, high motion = ~1000km.
 */
const OCEANIC_CRUST_EXPANSION_KM = {
  MIN_WIDTH: 200,
  MAX_WIDTH: 1000,
};

// ============================================================================
// Width Computation
// ============================================================================

/**
 * Computes the average divergent motion at a boundary between an oceanic
 * and continental plate. Only considers divergent edges.
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
 * Computes the maximum expansion width for oceanic crust based on divergent motion.
 * Returns the width in unit sphere distance.
 */
function computeOceanicCrustExpansionWidth(
  avgMotion: number,
  tectonicSystem: TectonicSystem
): number {
  // Get motion decile (0-9)
  const motionDecile = getMotionDecile(avgMotion, tectonicSystem);
  const motionFactor = motionDecile / 9; // 0 to 1

  // Interpolate width based on motion
  const { MIN_WIDTH, MAX_WIDTH } = OCEANIC_CRUST_EXPANSION_KM;
  const widthKm = MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * motionFactor;

  return kmToDistance(widthKm);
}

// ============================================================================
// Divergent Edge Collection
// ============================================================================

/**
 * Collects relative motion vectors for each continental tile from its oceanic neighbors.
 * Returns a map from continental tile to the list of relative motion vectors.
 * The relative motion is: continental_motion - oceanic_motion (direction continental is moving away).
 */
function collectRelativeMotionsOnContinentalSide(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem,
  continentalPlate: Plate
): Map<Tile, THREE.Vector3[]> {
  const tileRelativeMotions = new Map<Tile, THREE.Vector3[]>();

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.DIVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    if (!tileA || !tileB) {
      continue;
    }

    // Determine which is continental and which is oceanic
    let continentalTile: Tile;
    let oceanicTile: Tile;

    if (tileA.plate === continentalPlate) {
      continentalTile = tileA;
      oceanicTile = tileB;
    } else if (tileB.plate === continentalPlate) {
      continentalTile = tileB;
      oceanicTile = tileA;
    } else {
      continue;
    }

    // Compute relative motion: how continental tile moves relative to oceanic
    const relativeMotion = continentalTile.motionVec.clone().sub(oceanicTile.motionVec);

    if (!tileRelativeMotions.has(continentalTile)) {
      tileRelativeMotions.set(continentalTile, []);
    }
    tileRelativeMotions.get(continentalTile)!.push(relativeMotion);
  }

  return tileRelativeMotions;
}

/**
 * Computes the average relative motion direction for a tile.
 * Returns a normalized direction vector representing the divergence direction.
 */
function computeAverageRelativeMotionDirection(
  relativeMotions: THREE.Vector3[]
): THREE.Vector3 {
  if (relativeMotions.length === 0) {
    return new THREE.Vector3(0, 0, 1);
  }

  const avgMotion = new THREE.Vector3();
  for (const motion of relativeMotions) {
    avgMotion.add(motion);
  }
  avgMotion.divideScalar(relativeMotions.length);

  if (avgMotion.length() < 1e-10) {
    return new THREE.Vector3(0, 0, 1);
  }

  return avgMotion.normalize();
}

// ============================================================================
// Oceanic Crust Propagation into Continental Plate
// ============================================================================

interface PropagatingTileState {
  tile: Tile;
  dir: THREE.Vector3;  // The relative motion direction from boundary
  distanceFromBoundary: number;
  maxExpansionDistance: number;
}

/**
 * Minimum alignment with divergence direction to continue propagation.
 */
const MIN_ALIGNMENT = 0.0;

/**
 * Alignment threshold for full propagation (no dampening).
 * Below this, distance is dampened based on alignment.
 */
const FULL_ALIGNMENT_THRESHOLD = 0.5;

/**
 * Computes a dampening factor based on alignment with the motion direction.
 * Perfect alignment (1.0) = no dampening (factor 1.0)
 * Threshold alignment (0.5) = no dampening (factor 1.0)
 * Zero alignment (0.0) = maximum dampening (factor ~0.3)
 * Negative alignment = blocked (handled by MIN_ALIGNMENT check)
 */
function computeAlignmentDampening(alignment: number): number {
  if (alignment >= FULL_ALIGNMENT_THRESHOLD) {
    return 1.0;
  }
  // Linear interpolation from MIN_ALIGNMENT to FULL_ALIGNMENT_THRESHOLD
  // At MIN_ALIGNMENT: dampening = 0.3
  // At FULL_ALIGNMENT_THRESHOLD: dampening = 1.0
  const t = (alignment - MIN_ALIGNMENT) / (FULL_ALIGNMENT_THRESHOLD - MIN_ALIGNMENT);
  return 0.3 + 0.7 * t;
}

/**
 * Performs a single step of oceanic crust propagation into continental plate.
 * Propagation follows the relative motion direction from the boundary.
 * Off-axis propagation is dampened (effective distance increases faster).
 * Returns the next set of propagating tiles.
 */
function oceanicCrustPropagationStep(
  propagatingTiles: PropagatingTileState[],
  assigned: Set<Tile>,
  tectonicSystem: TectonicSystem
): PropagatingTileState[] {
  const nextPropagatingTiles: PropagatingTileState[] = [];

  for (const state of propagatingTiles) {
    const { tile, dir, distanceFromBoundary, maxExpansionDistance } = state;

    // Get neighbors in the same plate
    const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

    for (const neighbor of neighbors) {
      // Skip already assigned tiles (in this propagation)
      if (assigned.has(neighbor)) {
        continue;
      }

      // Skip tiles that already have a geological type
      if (neighbor.geologicalType !== GeologicalType.UNKNOWN) {
        continue;
      }

      // Check alignment with propagation direction (relative motion from boundary)
      const toNeighborVec = neighbor.centroid.clone().sub(tile.centroid);
      const stepDistance = toNeighborVec.length();
      const toNeighbor = toNeighborVec.normalize();
      const alignment = toNeighbor.dot(dir);

      // Block propagation in opposite direction
      if (alignment < MIN_ALIGNMENT) {
        continue;
      }

      // Apply dampening for off-axis propagation
      // Off-axis steps count as longer distance (reach limit sooner)
      const dampening = computeAlignmentDampening(alignment);
      const effectiveStepDistance = stepDistance / dampening;

      // Check distance limit with dampened distance
      const newDistance = distanceFromBoundary + effectiveStepDistance;
      if (newDistance > maxExpansionDistance) {
        continue;
      }

      // Assign oceanic crust type
      neighbor.geologicalType = GeologicalType.OCEANIC_CRUST;
      assigned.add(neighbor);

      // Add to next wave - keep the original motion direction for consistency
      nextPropagatingTiles.push({
        tile: neighbor,
        dir: dir.clone(),  // Preserve the original motion direction
        distanceFromBoundary: newDistance,
        maxExpansionDistance,
      });
    }
  }

  return nextPropagatingTiles;
}

/**
 * Runs propagation of oceanic crust from initial boundary tiles into continental plate.
 */
function runOceanicCrustPropagation(
  initialTiles: PropagatingTileState[],
  tectonicSystem: TectonicSystem
): void {
  const assigned = new Set<Tile>();

  // Initialize with boundary tiles
  let propagatingTiles: PropagatingTileState[] = [];
  for (const state of initialTiles) {
    if (!assigned.has(state.tile)) {
      propagatingTiles.push(state);
      assigned.add(state.tile);
    }
  }

  // Step-by-step propagation
  while (propagatingTiles.length > 0) {
    propagatingTiles = oceanicCrustPropagationStep(propagatingTiles, assigned, tectonicSystem);
  }
}

// ============================================================================
// Oceanic Crust Assignment at Boundary
// ============================================================================

/**
 * Initializes oceanic crust propagation at an oceanic/continental divergent boundary.
 * Propagates INTO the continental plate from the boundary.
 */
function initOceanicCrustAtBoundary(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): PropagatingTileState[] {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  // Check if one plate is oceanic and one is continental
  const plateAisOceanic = plateA.category === PlateCategory.OCEANIC;
  const plateBisOceanic = plateB.category === PlateCategory.OCEANIC;
  const plateAisContinental = plateA.category === PlateCategory.CONTINENTAL;
  const plateBisContinental = plateB.category === PlateCategory.CONTINENTAL;

  const isOceanicContinentalBoundary =
    (plateAisOceanic && plateBisContinental) ||
    (plateBisOceanic && plateAisContinental);

  if (!isOceanicContinentalBoundary) {
    return [];
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
    return [];
  }

  // Determine which plate is continental (target for propagation)
  const continentalPlate = plateAisContinental ? plateA : plateB;

  // Compute average divergent motion and expansion width
  const avgMotion = computeAverageDivergentMotion(boundary, tectonicSystem);
  const maxExpansionDistance = computeOceanicCrustExpansionWidth(avgMotion, tectonicSystem);

  // Collect relative motion vectors for tiles on the continental plate
  const tileRelativeMotions = collectRelativeMotionsOnContinentalSide(boundary, tectonicSystem, continentalPlate);

  // Initialize propagating tiles
  const propagatingTiles: PropagatingTileState[] = [];
  const processedTiles = new Set<Tile>();

  for (const [tile, relativeMotions] of tileRelativeMotions) {
    if (processedTiles.has(tile)) {
      continue;
    }
    processedTiles.add(tile);

    // Only assign to tiles that are not already assigned
    if (tile.geologicalType !== GeologicalType.UNKNOWN) {
      continue;
    }

    // Compute the average relative motion direction (divergence direction)
    const divergenceDir = computeAverageRelativeMotionDirection(relativeMotions);

    // Mark tile as oceanic crust
    tile.geologicalType = GeologicalType.OCEANIC_CRUST;

    propagatingTiles.push({
      tile,
      dir: divergenceDir,
      distanceFromBoundary: 0,
      maxExpansionDistance,
    });
  }

  return propagatingTiles;
}

// ============================================================================
// Assign All Oceanic Plate Tiles
// ============================================================================

/**
 * Assigns OCEANIC_CRUST to all tiles on oceanic plates.
 */
function assignAllOceanicPlateTiles(tectonicSystem: TectonicSystem): number {
  let count = 0;

  for (const plate of tectonicSystem.plates) {
    if (plate.category !== PlateCategory.OCEANIC) {
      continue;
    }

    for (const tile of plate.tiles) {
      // Only assign if not already assigned
      if (tile.geologicalType === GeologicalType.UNKNOWN) {
        tile.geologicalType = GeologicalType.OCEANIC_CRUST;
        count++;
      }
    }
  }

  return count;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Assigns oceanic crust type:
 * 1. To all tiles on oceanic plates
 * 2. Propagates into continental plates at oceanic/continental divergent boundaries
 */
export function assignOceanicCrustType(tectonicSystem: TectonicSystem): void {
  // First: assign OCEANIC_CRUST to all tiles on oceanic plates
  const oceanicPlateCount = assignAllOceanicPlateTiles(tectonicSystem);
  console.log(`Assigned OCEANIC_CRUST to ${oceanicPlateCount} tiles on oceanic plates`);

  // Second: propagate into continental plates at divergent boundaries
  const allBoundaryTiles: PropagatingTileState[] = [];

  for (const boundary of tectonicSystem.boundaries) {
    const boundaryTiles = initOceanicCrustAtBoundary(boundary, tectonicSystem);
    allBoundaryTiles.push(...boundaryTiles);
  }

  // Run propagation from all boundary tiles into continental plates
  runOceanicCrustPropagation(allBoundaryTiles, tectonicSystem);

  // Log total results
  let totalOceanicCrustCount = 0;
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      if (tile.geologicalType === GeologicalType.OCEANIC_CRUST) {
        totalOceanicCrustCount++;
      }
    }
  }

  const propagatedCount = totalOceanicCrustCount - oceanicPlateCount;
  console.log(`Propagated OCEANIC_CRUST to ${propagatedCount} tiles in continental plates`);
  console.log(`Total OCEANIC_CRUST tiles: ${totalOceanicCrustCount}`);
}
