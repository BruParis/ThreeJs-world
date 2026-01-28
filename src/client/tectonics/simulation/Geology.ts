import * as THREE from 'three';
import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, GeologicalIntensity, TectonicSystem, PlateBoundary } from '../data/Plate';

// ============================================================================
// Propagation Parameters
// ============================================================================

const PROPAGATION_CONFIG = {
  BASE_PROBABILITY: 0.2,    // Base probability to propagate
  DECILE_BONUS: 0.07,       // Additional prob per decile (0-9)
  DECAY_PROBABILITY: 0.5,   // Probability of intensity decay per step
  MIN_ALIGNMENT: 0.1,       // Minimum alignment with convergence direction
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the decile index (0-9) for a motion amplitude based on motion statistics.
 * Returns 0 for lowest motion, 9 for highest.
 */
function getMotionDecile(amplitude: number, tectonicSystem: TectonicSystem): number {
  const stats = tectonicSystem.motionStatistics;
  if (!stats || stats.deciles.length === 0) {
    return 5; // Default to middle if no stats
  }

  for (let i = 0; i < stats.deciles.length; i++) {
    if (amplitude <= stats.deciles[i]) {
      return i;
    }
  }
  return 9; // Above 90th percentile
}

/**
 * Finds neighbor tiles within the same plate.
 */
function getNeighborTilesInPlate(tile: Tile, tectonicSystem: TectonicSystem): Tile[] {
  const neighbors: Tile[] = [];
  const plate = tile.plate;

  for (const he of tile.loop()) {
    const twinTile = tectonicSystem.edge2TileMap.get(he.twin);
    if (twinTile && twinTile.plate === plate && twinTile !== tile) {
      neighbors.push(twinTile);
    }
  }

  return neighbors;
}

/**
 * Computes relative motion direction from smaller plate towards larger plate.
 * Returns normalized vector pointing "into" the larger plate.
 */
function computeConvergenceDirection(
  boundaryTile: Tile,
  smallerPlate: Plate,
  tectonicSystem: TectonicSystem
): THREE.Vector3 {
  // Find neighboring tile in smaller plate to compute relative motion
  let smallerPlateTile: Tile | null = null;
  for (const he of boundaryTile.loop()) {
    const twinTile = tectonicSystem.edge2TileMap.get(he.twin);
    if (twinTile && twinTile.plate === smallerPlate) {
      smallerPlateTile = twinTile;
      break;
    }
  }

  if (!smallerPlateTile) {
    // Fallback: use direction from smaller plate centroid to tile
    return boundaryTile.centroid.clone().sub(smallerPlate.centroid).normalize();
  }

  // Relative motion: smaller plate motion relative to larger plate at this point
  const relativeMotion = smallerPlateTile.motionVec.clone().sub(boundaryTile.motionVec);

  if (relativeMotion.length() < 1e-10) {
    // Fallback if motion is negligible
    return boundaryTile.centroid.clone().sub(smallerPlateTile.centroid).normalize();
  }

  return relativeMotion.normalize();
}

// ============================================================================
// Orogeny Propagation
// ============================================================================

interface PropagationState {
  queue: Array<{ tile: Tile; intensity: GeologicalIntensity; dir: THREE.Vector3 }>;
  processed: Set<Tile>;
}

/**
 * Propagates orogeny from a single tile to its neighbors.
 * Returns tiles that should be added to the propagation queue.
 */
function propagateOrogenyFromTile(
  tile: Tile,
  intensity: GeologicalIntensity,
  dir: THREE.Vector3,
  tectonicSystem: TectonicSystem,
  processed: Set<Tile>
): Array<{ tile: Tile; intensity: GeologicalIntensity; dir: THREE.Vector3 }> {
  const newEntries: Array<{ tile: Tile; intensity: GeologicalIntensity; dir: THREE.Vector3 }> = [];

  // Stop if intensity is too low
  if (intensity <= GeologicalIntensity.ANCIENT) {
    return newEntries;
  }

  // Get neighbors in the same plate
  const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

  for (const neighbor of neighbors) {
    // Check if neighbor is "downstream" (in convergence direction)
    const toNeighbor = neighbor.centroid.clone().sub(tile.centroid).normalize();
    const alignment = toNeighbor.dot(dir);

    // Only propagate to tiles roughly in the convergence direction
    if (alignment < PROPAGATION_CONFIG.MIN_ALIGNMENT) {
      continue;
    }

    // Calculate propagation probability based on motion decile
    const motionAmplitude = neighbor.motionVec.length();
    const decile = getMotionDecile(motionAmplitude, tectonicSystem);
    const propagationProb = PROPAGATION_CONFIG.BASE_PROBABILITY + decile * PROPAGATION_CONFIG.DECILE_BONUS;

    // Random check for propagation
    if (Math.random() > propagationProb) {
      continue;
    }

    // Calculate new intensity (may decay)
    let newIntensity = intensity;
    if (Math.random() < PROPAGATION_CONFIG.DECAY_PROBABILITY) {
      newIntensity = intensity - 1;
    }

    // Only update if new intensity is higher than existing
    if (newIntensity > neighbor.geologicalIntensity) {
      neighbor.geologicalType = GeologicalType.OROGEN;
      neighbor.geologicalIntensity = newIntensity;

      // Add to queue if not already processed
      if (!processed.has(neighbor)) {
        newEntries.push({ tile: neighbor, intensity: newIntensity, dir });
        processed.add(neighbor);
      }
    }
  }

  return newEntries;
}

/**
 * Runs BFS propagation of orogeny from initial boundary tiles.
 */
function runOrogenyPropagation(
  initialTiles: Array<{ tile: Tile; convergenceDir: THREE.Vector3 }>,
  tectonicSystem: TectonicSystem
): void {
  const state: PropagationState = {
    queue: [],
    processed: new Set<Tile>()
  };

  // Initialize queue with boundary tiles
  for (const info of initialTiles) {
    if (!state.processed.has(info.tile)) {
      state.queue.push({
        tile: info.tile,
        intensity: GeologicalIntensity.VERY_HIGH,
        dir: info.convergenceDir
      });
      state.processed.add(info.tile);
    }
  }

  // BFS propagation
  while (state.queue.length > 0) {
    const { tile, intensity, dir } = state.queue.shift()!;
    const newEntries = propagateOrogenyFromTile(tile, intensity, dir, tectonicSystem, state.processed);
    state.queue.push(...newEntries);
  }
}

// ============================================================================
// Orogeny Assignment at Boundary
// ============================================================================

interface BoundaryTileInfo {
  tile: Tile;
  convergenceDir: THREE.Vector3;
}

/**
 * Assigns orogeny to tiles along a single convergent boundary.
 * Returns the boundary tiles with their convergence directions for propagation.
 */
function assignOrogenyAtBoundary(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): BoundaryTileInfo[] {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  // Check if at least one plate is continental
  const hasContinent =
    plateA.category === PlateCategory.CONTINENTAL ||
    plateB.category === PlateCategory.CONTINENTAL;

  if (!hasContinent) {
    return [];
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
    return [];
  }

  // Identify larger and smaller plates
  const largerPlate = plateA.area >= plateB.area ? plateA : plateB;
  const smallerPlate = plateA.area >= plateB.area ? plateB : plateA;

  const boundaryTileInfos: BoundaryTileInfo[] = [];

  // Collect boundary tiles of larger plate
  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tile = tectonicSystem.edge2TileMap.get(he);
    const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

    const targetTile = tile?.plate === largerPlate ? tile :
                       twinTile?.plate === largerPlate ? twinTile : null;

    if (targetTile) {
      const convergenceDir = computeConvergenceDirection(targetTile, smallerPlate, tectonicSystem);
      boundaryTileInfos.push({ tile: targetTile, convergenceDir });

      // Assign VERY_HIGH intensity to boundary tile
      targetTile.geologicalType = GeologicalType.OROGEN;
      if (targetTile.geologicalIntensity < GeologicalIntensity.VERY_HIGH) {
        targetTile.geologicalIntensity = GeologicalIntensity.VERY_HIGH;
      }
    }
  }

  return boundaryTileInfos;
}

// ============================================================================
// Orogeny Type Assignment
// ============================================================================

/**
 * Assigns orogeny type to all applicable boundaries and propagates inward.
 */
function assignOrogenyType(tectonicSystem: TectonicSystem): void {
  const allBoundaryTiles: BoundaryTileInfo[] = [];

  // Process each boundary
  for (const boundary of tectonicSystem.boundaries) {
    const boundaryTiles = assignOrogenyAtBoundary(boundary, tectonicSystem);
    allBoundaryTiles.push(...boundaryTiles);
  }

  // Run propagation from all boundary tiles
  runOrogenyPropagation(allBoundaryTiles, tectonicSystem);

  // Log results
  const intensityCounts: Record<number, number> = {};
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      if (tile.geologicalType === GeologicalType.OROGEN) {
        intensityCounts[tile.geologicalIntensity] = (intensityCounts[tile.geologicalIntensity] || 0) + 1;
      }
    }
  }

  const total = Object.values(intensityCounts).reduce((a, b) => a + b, 0);
  console.log(`Assigned OROGEN to ${total} tiles:`, intensityCounts);
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Assigns geological types to all tiles in the tectonic system.
 * Currently handles orogeny assignment at convergent continental boundaries.
 */
function assignGeologicalTypes(tectonicSystem: TectonicSystem): void {
  // Reset all tiles
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      tile.geologicalType = GeologicalType.UNKNOWN;
      tile.geologicalIntensity = GeologicalIntensity.NONE;
    }
  }

  // Assign orogeny at convergent boundaries
  assignOrogenyType(tectonicSystem);
}

export {
  assignGeologicalTypes,
  assignOrogenyType,
  assignOrogenyAtBoundary,
  propagateOrogenyFromTile,
  PROPAGATION_CONFIG
};
