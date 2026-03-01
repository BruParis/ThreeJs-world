import * as THREE from 'three';
import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, TectonicSystem, PlateBoundary } from '../data/Plate';
import { kmToDistance } from '../../../../shared/world/World';
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
// Intra-Continental Divergent Boundaries Connecting to Oceanic Plates
// ============================================================================

/**
 * Configuration for oceanic crust propagation along intra-continental divergent boundaries.
 */
const INTRA_CONTINENTAL_CONFIG = {
  // Maximum propagation distance from oceanic connection (in km)
  MAX_PROPAGATION_KM: 2000,

  // Base probability of assigning oceanic crust at connection point
  BASE_PROBABILITY: 0.9,

  // Minimum probability at maximum distance
  MIN_PROBABILITY: 0.1,

  // Width of the oceanic crust zone perpendicular to boundary (in km)
  ZONE_WIDTH_KM: 150,
};

/**
 * Finds the endpoints of divergent segments on a continental-continental boundary.
 * Returns tiles that are at the boundary and adjacent to tiles already assigned as OCEANIC_CRUST.
 * This should be called after oceanic crust has been assigned at oceanic/continental boundaries.
 */
function findDivergentBoundaryEndpoints(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): { tile: Tile; plate: Plate }[] {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  // Only process continental-continental boundaries
  if (plateA.category !== PlateCategory.CONTINENTAL ||
      plateB.category !== PlateCategory.CONTINENTAL) {
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

  const endpoints: { tile: Tile; plate: Plate }[] = [];

  // For each continental plate, find tiles at the divergent boundary
  // that are adjacent to tiles already assigned as OCEANIC_CRUST
  for (const continentalPlate of [plateA, plateB]) {
    for (const bEdge of boundary.boundaryEdges) {
      if (bEdge.refinedType !== BoundaryType.DIVERGENT) {
        continue;
      }

      const he = bEdge.halfedge;
      const tileOnThisSide = tectonicSystem.edge2TileMap.get(he);
      const tileOnOtherSide = tectonicSystem.edge2TileMap.get(he.twin);

      // Get the tile on this continental plate
      let continentalTile: Tile | undefined;
      if (tileOnThisSide?.plate === continentalPlate) {
        continentalTile = tileOnThisSide;
      } else if (tileOnOtherSide?.plate === continentalPlate) {
        continentalTile = tileOnOtherSide;
      }

      if (!continentalTile) continue;

      // Check if this tile has any neighbor already assigned as OCEANIC_CRUST
      for (const neighborHe of continentalTile.loop()) {
        const neighborTile = tectonicSystem.edge2TileMap.get(neighborHe.twin);
        if (neighborTile && neighborTile.geologicalType === GeologicalType.OCEANIC_CRUST) {
          // This tile is at the junction between continental divergence and oceanic crust
          endpoints.push({ tile: continentalTile, plate: continentalPlate });
          break;
        }
      }
    }
  }

  // Remove duplicates (same tile might be found multiple times)
  const seen = new Set<Tile>();
  const uniqueEndpoints: { tile: Tile; plate: Plate }[] = [];
  for (const ep of endpoints) {
    if (!seen.has(ep.tile)) {
      seen.add(ep.tile);
      uniqueEndpoints.push(ep);
    }
  }

  return uniqueEndpoints;
}

/**
 * Collects all tiles along the divergent boundary for a given continental plate.
 * Returns tiles ordered by their approximate position along the boundary.
 */
function collectDivergentBoundaryTiles(
  boundary: PlateBoundary,
  continentalPlate: Plate,
  tectonicSystem: TectonicSystem
): Set<Tile> {
  const boundaryTiles = new Set<Tile>();

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.DIVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    if (tileA?.plate === continentalPlate) {
      boundaryTiles.add(tileA);
    }
    if (tileB?.plate === continentalPlate) {
      boundaryTiles.add(tileB);
    }
  }

  return boundaryTiles;
}

/**
 * Propagates oceanic crust from endpoints along a continental-continental divergent boundary.
 * Uses BFS along boundary tiles with dampening based on distance from oceanic connection.
 */
function propagateOceanicCrustFromEndpoints(
  endpoints: { tile: Tile; plate: Plate }[],
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  if (endpoints.length === 0) {
    return 0;
  }

  const maxDistance = kmToDistance(INTRA_CONTINENTAL_CONFIG.MAX_PROPAGATION_KM);
  const zoneWidth = kmToDistance(INTRA_CONTINENTAL_CONFIG.ZONE_WIDTH_KM);
  let totalAssigned = 0;

  // Group endpoints by plate
  const endpointsByPlate = new Map<Plate, Tile[]>();
  for (const ep of endpoints) {
    if (!endpointsByPlate.has(ep.plate)) {
      endpointsByPlate.set(ep.plate, []);
    }
    endpointsByPlate.get(ep.plate)!.push(ep.tile);
  }

  // Process each plate separately
  for (const [plate, plateEndpoints] of endpointsByPlate) {
    // Get all divergent boundary tiles for this plate
    const boundaryTiles = collectDivergentBoundaryTiles(boundary, plate, tectonicSystem);

    // Track assigned tiles and their distances
    const assigned = new Set<Tile>();
    const tileDistances = new Map<Tile, number>();

    // Initialize BFS from endpoints
    interface WaveTile {
      tile: Tile;
      distance: number;
    }

    let wave: WaveTile[] = [];

    for (const endpointTile of plateEndpoints) {
      if (endpointTile.geologicalType === GeologicalType.UNKNOWN) {
        // Assign oceanic crust to endpoint
        endpointTile.geologicalType = GeologicalType.OCEANIC_CRUST;
        assigned.add(endpointTile);
        globalAssigned.add(endpointTile);
        tileDistances.set(endpointTile, 0);
        totalAssigned++;
        wave.push({ tile: endpointTile, distance: 0 });
      }
    }

    // BFS along boundary tiles
    while (wave.length > 0) {
      const nextWave: WaveTile[] = [];

      for (const { tile, distance } of wave) {
        // Get neighbors
        const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

        for (const neighbor of neighbors) {
          // Skip if already assigned
          if (assigned.has(neighbor) || globalAssigned.has(neighbor)) {
            continue;
          }

          // Skip if already has a geological type
          if (neighbor.geologicalType !== GeologicalType.UNKNOWN) {
            continue;
          }

          // Calculate distance to neighbor
          const stepDistance = tile.centroid.distanceTo(neighbor.centroid);
          const newDistance = distance + stepDistance;

          // Check if within max propagation distance
          if (newDistance > maxDistance) {
            continue;
          }

          // Check if neighbor is on or near the boundary
          const isOnBoundary = boundaryTiles.has(neighbor);

          // If not on boundary, check if within zone width of a boundary tile
          let isNearBoundary = isOnBoundary;
          if (!isOnBoundary) {
            for (const boundaryTile of boundaryTiles) {
              const distToBoundary = neighbor.centroid.distanceTo(boundaryTile.centroid);
              if (distToBoundary <= zoneWidth) {
                isNearBoundary = true;
                break;
              }
            }
          }

          if (!isNearBoundary) {
            continue;
          }

          // Compute probability with dampening based on distance
          const distanceFactor = 1 - (newDistance / maxDistance);
          const probability = INTRA_CONTINENTAL_CONFIG.MIN_PROBABILITY +
            (INTRA_CONTINENTAL_CONFIG.BASE_PROBABILITY - INTRA_CONTINENTAL_CONFIG.MIN_PROBABILITY) * distanceFactor;

          // Random check with connectivity requirement
          // Only assign if we pass probability check
          if (Math.random() > probability) {
            continue;
          }

          // Assign oceanic crust
          neighbor.geologicalType = GeologicalType.OCEANIC_CRUST;
          assigned.add(neighbor);
          globalAssigned.add(neighbor);
          tileDistances.set(neighbor, newDistance);
          totalAssigned++;

          nextWave.push({ tile: neighbor, distance: newDistance });
        }
      }

      wave = nextWave;
    }
  }

  return totalAssigned;
}

/**
 * Assigns oceanic crust along intra-continental divergent boundaries
 * that connect to oceanic plates at their endpoints.
 */
function assignOceanicCrustAtIntraContinentalDivergence(
  tectonicSystem: TectonicSystem,
  globalAssigned: Set<Tile>
): number {
  let totalAssigned = 0;

  for (const boundary of tectonicSystem.boundaries) {
    // Find endpoints where continental divergence meets oceanic plate
    const endpoints = findDivergentBoundaryEndpoints(boundary, tectonicSystem);

    if (endpoints.length === 0) {
      continue;
    }

    // Propagate oceanic crust from endpoints
    const count = propagateOceanicCrustFromEndpoints(
      endpoints,
      boundary,
      tectonicSystem,
      globalAssigned
    );
    totalAssigned += count;
  }

  return totalAssigned;
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
 * 3. Propagates along intra-continental divergent boundaries from oceanic connections
 */
export function assignOceanicCrustType(tectonicSystem: TectonicSystem): void {
  // Track all assigned tiles globally to prevent duplicates
  const globalAssigned = new Set<Tile>();

  // First: assign OCEANIC_CRUST to all tiles on oceanic plates
  const oceanicPlateCount = assignAllOceanicPlateTiles(tectonicSystem);
  console.log(`Assigned OCEANIC_CRUST to ${oceanicPlateCount} tiles on oceanic plates`);

  // Second: propagate into continental plates at oceanic/continental divergent boundaries
  const allBoundaryTiles: PropagatingTileState[] = [];

  for (const boundary of tectonicSystem.boundaries) {
    const boundaryTiles = initOceanicCrustAtBoundary(boundary, tectonicSystem);
    allBoundaryTiles.push(...boundaryTiles);
  }

  // Run propagation from all boundary tiles into continental plates
  runOceanicCrustPropagation(allBoundaryTiles, tectonicSystem);

  // Update globalAssigned with tiles assigned so far
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      if (tile.geologicalType === GeologicalType.OCEANIC_CRUST) {
        globalAssigned.add(tile);
      }
    }
  }

  // Third: propagate along intra-continental divergent boundaries from oceanic connections
  const intraContinentalCount = assignOceanicCrustAtIntraContinentalDivergence(
    tectonicSystem,
    globalAssigned
  );
  if (intraContinentalCount > 0) {
    console.log(`Assigned OCEANIC_CRUST to ${intraContinentalCount} tiles along intra-continental divergent boundaries`);
  }

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
  console.log(`Propagated OCEANIC_CRUST to ${propagatedCount} tiles in continental plates (total)`);
  console.log(`Total OCEANIC_CRUST tiles: ${totalOceanicCrustCount}`);
}
