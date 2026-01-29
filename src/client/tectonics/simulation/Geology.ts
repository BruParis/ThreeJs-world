import * as THREE from 'three';
import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, GeologicalIntensity, TectonicSystem, PlateBoundary } from '../data/Plate';

// ============================================================================
// Propagation Parameters
// ============================================================================

const PROPAGATION_CONFIG = {
  BASE_PROBABILITY: 0.2,    // Base probability to propagate
  DECILE_BONUS: 0.05,       // Additional prob per decile (0-9)
  DECAY_PROBABILITY: 0.5,   // Probability of intensity decay per step
  MIN_ALIGNMENT: 0.1,       // Minimum alignment with convergence direction
  SIMILAR_AREA_RATIO: 2.0,  // Plates with area ratio below this are considered similar
  OCEANIC_OCEANIC_DAMPING: 0.2,  // Severe damping for oceanic/oceanic collisions
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
 * Gets the decile index (0-9) for a plate area based on area statistics.
 * Returns 0 for smallest plates, 9 for largest.
 */
function getAreaDecile(plateArea: number, tectonicSystem: TectonicSystem): number {
  const stats = tectonicSystem.plateAreaStatistics;
  if (!stats || stats.deciles.length === 0) {
    return 5; // Default to middle if no stats
  }

  for (let i = 0; i < stats.deciles.length; i++) {
    if (plateArea <= stats.deciles[i]) {
      return i;
    }
  }
  return 9; // Above 90th percentile
}

/**
 * Computes the initial orogeny intensity based on motion amplitude and plate sizes.
 * Two small plates converging slowly produce low intensity orogeny.
 * Two large plates converging fast produce high intensity orogeny.
 *
 * @param relativeMotion - The relative motion amplitude at the boundary
 * @param plateA - First colliding plate
 * @param plateB - Second colliding plate
 * @param tectonicSystem - The tectonic system for statistics lookup
 * @returns The computed initial intensity (LOW to VERY_HIGH)
 */
function computeInitialOrogenyIntensity(
  relativeMotion: number,
  plateA: Plate,
  plateB: Plate,
  tectonicSystem: TectonicSystem
): GeologicalIntensity {
  // Get motion decile (0-9)
  const motionDecile = getMotionDecile(relativeMotion, tectonicSystem);

  // Get area deciles for both plates (0-9)
  const areaDecileA = getAreaDecile(plateA.area, tectonicSystem);
  const areaDecileB = getAreaDecile(plateB.area, tectonicSystem);

  // Use the smaller plate's area as limiting factor (smaller plate = less momentum)
  // but also consider combined mass effect
  const minAreaDecile = Math.min(areaDecileA, areaDecileB);
  const avgAreaDecile = (areaDecileA + areaDecileB) / 2;

  // Combined area factor: weight towards smaller plate but include average
  const areaFactor = (minAreaDecile * 0.6 + avgAreaDecile * 0.4) / 9; // 0 to 1

  // Motion factor
  const motionFactor = motionDecile / 9; // 0 to 1

  // Combined score: both factors contribute equally
  // Range: 0 to 1
  const combinedScore = (motionFactor + areaFactor) / 2;

  // Map to intensity levels (LOW=3 to VERY_HIGH=6)
  // Score 0.0 -> LOW (3)
  // Score 1.0 -> VERY_HIGH (6)
  const intensityRange = GeologicalIntensity.VERY_HIGH - GeologicalIntensity.LOW; // 3
  const intensityValue = Math.round(
    GeologicalIntensity.LOW + combinedScore * intensityRange
  );

  // Clamp to valid range
  const clampedIntensity = Math.max(
    GeologicalIntensity.LOW,
    Math.min(GeologicalIntensity.VERY_HIGH, intensityValue)
  ) as GeologicalIntensity;

  return clampedIntensity;
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

/**
 * Collects convergent neighbor motions for each tile from the boundary.
 * Returns a map from tile to the list of motion vectors of its convergent neighbors.
 */
function collectConvergentNeighborMotions(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): Map<Tile, THREE.Vector3[]> {
  const tileNeighborMotions = new Map<Tile, THREE.Vector3[]>();

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    if (tileA && tileB) {
      // Add tileB's motion to tileA's neighbor list
      if (!tileNeighborMotions.has(tileA)) {
        tileNeighborMotions.set(tileA, []);
      }
      tileNeighborMotions.get(tileA)!.push(tileB.motionVec);

      // Add tileA's motion to tileB's neighbor list
      if (!tileNeighborMotions.has(tileB)) {
        tileNeighborMotions.set(tileB, []);
      }
      tileNeighborMotions.get(tileB)!.push(tileA.motionVec);
    }
  }

  return tileNeighborMotions;
}

/**
 * Computes the relative motion amplitude for a tile given its convergent neighbor motions.
 */
function computeTileRelativeMotion(
  tile: Tile,
  neighborMotions: THREE.Vector3[]
): number {
  if (neighborMotions.length === 0) {
    return 0;
  }

  // Compute average neighbor motion
  const avgNeighborMotion = new THREE.Vector3();
  for (const motion of neighborMotions) {
    avgNeighborMotion.add(motion);
  }
  avgNeighborMotion.divideScalar(neighborMotions.length);

  // Compute relative motion amplitude
  return tile.motionVec.clone().sub(avgNeighborMotion).length();
}

// ============================================================================
// Orogeny Propagation
// ============================================================================

interface PropagatingTileState {
  tile: Tile;
  intensity: GeologicalIntensity;
  dir: THREE.Vector3;
  amplitudeScale: number;
}

interface NeighborContribution {
  intensity: GeologicalIntensity;
  dir: THREE.Vector3;
  amplitudeScale: number;
  alignment: number;
}

/**
 * Collects the contribution from a propagating tile to one of its neighbors.
 * Returns the contribution info or null if this tile doesn't contribute to this neighbor.
 */
function getContributionToNeighbor(
  propagatingState: PropagatingTileState,
  neighbor: Tile,
  tectonicSystem: TectonicSystem
): NeighborContribution | null {
  const { tile, intensity, dir, amplitudeScale } = propagatingState;

  // Stop if intensity is too low
  if (intensity <= GeologicalIntensity.ANCIENT) {
    return null;
  }

  // Check if neighbor is "downstream" (in convergence direction)
  const toNeighbor = neighbor.centroid.clone().sub(tile.centroid).normalize();
  const alignment = toNeighbor.dot(dir);

  // Only propagate to tiles roughly in the convergence direction
  if (alignment < PROPAGATION_CONFIG.MIN_ALIGNMENT) {
    return null;
  }

  // Calculate propagation probability based on motion decile
  const motionAmplitude = neighbor.motionVec.length() * amplitudeScale;
  const decile = getMotionDecile(motionAmplitude, tectonicSystem);
  const propagationProb = PROPAGATION_CONFIG.BASE_PROBABILITY + decile * PROPAGATION_CONFIG.DECILE_BONUS;

  // Random check for propagation
  if (Math.random() > propagationProb) {
    return null;
  }

  // Calculate new intensity (may decay)
  let newIntensity = intensity;
  if (Math.random() < PROPAGATION_CONFIG.DECAY_PROBABILITY) {
    newIntensity = intensity - 1;
  }

  return {
    intensity: newIntensity,
    dir: dir.clone(),
    amplitudeScale,
    alignment
  };
}

/**
 * Computes the average contribution from multiple propagating tiles to a neighbor.
 * Returns the averaged state or null if no valid contributions.
 */
function computeAverageContribution(
  contributions: NeighborContribution[]
): { intensity: GeologicalIntensity; dir: THREE.Vector3; amplitudeScale: number } | null {
  if (contributions.length === 0) {
    return null;
  }

  // Average intensity (round to nearest integer for enum)
  const avgIntensity = Math.round(
    contributions.reduce((sum, c) => sum + c.intensity, 0) / contributions.length
  ) as GeologicalIntensity;

  // Average direction (weighted by alignment for better results)
  const avgDir = new THREE.Vector3();
  let totalWeight = 0;
  for (const c of contributions) {
    avgDir.addScaledVector(c.dir, c.alignment);
    totalWeight += c.alignment;
  }
  if (totalWeight > 0) {
    avgDir.divideScalar(totalWeight);
  }
  avgDir.normalize();

  // Average amplitude scale
  const avgAmplitudeScale = contributions.reduce((sum, c) => sum + c.amplitudeScale, 0) / contributions.length;

  return {
    intensity: avgIntensity,
    dir: avgDir,
    amplitudeScale: avgAmplitudeScale
  };
}

/**
 * Performs a single step of orogeny propagation.
 *
 * For each propagating tile, collects contributions to neighbor tiles,
 * computes average contribution per neighbor, and updates their orogeny.
 *
 * @param propagatingTiles - Current set of tiles propagating orogeny
 * @param visited - Set of already visited tiles (modified in place)
 * @param tectonicSystem - The tectonic system
 * @returns The next set of propagating tiles
 */
function orogenyPropagationStep(
  propagatingTiles: PropagatingTileState[],
  visited: Set<Tile>,
  tectonicSystem: TectonicSystem
): PropagatingTileState[] {
  // Map to collect contributions for each neighbor tile
  // Key: neighbor tile, Value: array of contributions from propagating tiles
  const neighborContributions = new Map<Tile, NeighborContribution[]>();

  // Collect all contributions from propagating tiles to their neighbors
  for (const propagatingState of propagatingTiles) {
    const { tile } = propagatingState;

    // Get neighbors in the same plate
    const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);

    for (const neighbor of neighbors) {
      // Skip already visited tiles
      if (visited.has(neighbor)) {
        continue;
      }

      // Get contribution from this propagating tile to this neighbor
      const contribution = getContributionToNeighbor(propagatingState, neighbor, tectonicSystem);
      if (contribution) {
        if (!neighborContributions.has(neighbor)) {
          neighborContributions.set(neighbor, []);
        }
        neighborContributions.get(neighbor)!.push(contribution);
      }
    }
  }

  // Process each neighbor with its averaged contributions
  const nextPropagatingTiles: PropagatingTileState[] = [];

  for (const [neighbor, contributions] of neighborContributions) {
    // Compute average contribution
    const avgContribution = computeAverageContribution(contributions);
    if (!avgContribution) {
      continue;
    }

    // Only update if new intensity is higher than existing
    if (avgContribution.intensity > neighbor.geologicalIntensity) {
      neighbor.geologicalType = GeologicalType.OROGEN;
      neighbor.geologicalIntensity = avgContribution.intensity;

      // Add to next propagating set
      nextPropagatingTiles.push({
        tile: neighbor,
        intensity: avgContribution.intensity,
        dir: avgContribution.dir,
        amplitudeScale: avgContribution.amplitudeScale
      });

      // Mark as visited
      visited.add(neighbor);
    }
  }

  return nextPropagatingTiles;
}

/**
 * Runs step-by-step propagation of orogeny from initial boundary tiles.
 *
 * At each step:
 * 1. Collect all direct neighbor tiles of propagating tiles (same plate only)
 * 2. For each neighbor, gather contributions from all propagating tiles that reach it
 * 3. Compute the average contribution for each neighbor
 * 4. Update neighbor's orogeny based on averaged values
 * 5. Use updated neighbors as new propagating tiles
 * 6. Track visited tiles to avoid re-processing
 */
function runOrogenyPropagation(
  initialTiles: BoundaryTileInfo[],
  tectonicSystem: TectonicSystem
): void {
  const visited = new Set<Tile>();

  console.log(`[Orogeny Propagation] Starting with ${initialTiles.length} initial tiles`);

  // Initialize propagating tiles from boundary tiles
  let propagatingTiles: PropagatingTileState[] = [];
  for (const info of initialTiles) {
    if (!visited.has(info.tile)) {
      console.log(`[Orogeny Propagation] Initial tile ${info.tile.id} in plate ${info.tile.plate.id} (${info.tile.plate.category}), intensity=${info.initialIntensity}`);
      propagatingTiles.push({
        tile: info.tile,
        intensity: info.initialIntensity,
        dir: info.convergenceDir,
        amplitudeScale: info.amplitudeScale
      });
      visited.add(info.tile);
    }
  }

  let step = 0;

  // Step-by-step propagation
  // while (propagatingTiles.length > 0) {
  //   step++;
  //   propagatingTiles = orogenyPropagationStep(propagatingTiles, visited, tectonicSystem);
  //   break;
  // }

  console.log(`[Orogeny Propagation] Completed in ${step} steps`);
}

// ============================================================================
// Orogeny Assignment at Boundary
// ============================================================================

interface BoundaryTileInfo {
  tile: Tile;
  convergenceDir: THREE.Vector3;
  amplitudeScale: number;  // 1.0 normally, 0.5 for symmetric continental collision
  initialIntensity: GeologicalIntensity;  // Computed from motion and plate sizes
}

/**
 * Initializes symmetric orogeny propagation on both plates.
 * Used for:
 * - Oceanic/oceanic collisions (with severe damping)
 * - Continental/continental collisions with similar area
 *
 * Each tile gets its own initial intensity based on its motion relative to
 * its convergent neighbors on the other plate.
 */
function initSymmetricOrogeny(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem,
  amplitudeScale: number
): BoundaryTileInfo[] {
  const boundaryTileInfos: BoundaryTileInfo[] = [];
  const symmetricAmplitudeScale = amplitudeScale * 0.5;
  const processedTiles = new Set<Tile>();

  // Collect convergent neighbor motions for each tile
  const tileNeighborMotions = collectConvergentNeighborMotions(boundary, tectonicSystem);

  // Process each tile with convergent neighbors
  for (const [tile, neighborMotions] of tileNeighborMotions) {
    if (processedTiles.has(tile)) {
      continue;
    }
    processedTiles.add(tile);

    // Compute per-tile relative motion and intensity
    const relativeMotion = computeTileRelativeMotion(tile, neighborMotions);
    const initialIntensity = computeInitialOrogenyIntensity(
      relativeMotion,
      boundary.plateA,
      boundary.plateB,
      tectonicSystem
    );

    // Determine the other plate for convergence direction
    const otherPlate = tile.plate === boundary.plateA ? boundary.plateB : boundary.plateA;
    const convergenceDir = computeConvergenceDirection(tile, otherPlate, tectonicSystem);

    boundaryTileInfos.push({
      tile,
      convergenceDir,
      amplitudeScale: symmetricAmplitudeScale,
      initialIntensity
    });

    tile.geologicalType = GeologicalType.OROGEN;
    if (tile.geologicalIntensity < initialIntensity) {
      tile.geologicalIntensity = initialIntensity;
    }
  }

  return boundaryTileInfos;
}

/**
 * Initializes asymmetric orogeny propagation on the overriding plate only.
 * Used for:
 * - Continental/oceanic collisions (continental overrides)
 * - Continental/continental collisions with asymmetric area (larger overrides)
 *
 * Each tile gets its own initial intensity based on its motion relative to
 * its convergent neighbors on the subducting plate.
 */
function initAsymmetricOrogeny(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem,
  amplitudeScale: number
): BoundaryTileInfo[] {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;
  const largerPlate = plateA.area >= plateB.area ? plateA : plateB;

  // Determine overriding plate:
  // - In oceanic/continental collision: continental plate ALWAYS overrides
  // - In same-type collision (not similar area): larger plate overrides
  let overridingPlate: Plate;

  const plateAisContinental = plateA.category === PlateCategory.CONTINENTAL;
  const plateBisContinental = plateB.category === PlateCategory.CONTINENTAL;

  if (plateAisContinental && !plateBisContinental) {
    overridingPlate = plateA;
    console.log(`[Orogeny] Continental/Oceanic: overriding plate ${overridingPlate.id} (${overridingPlate.category})`);
  } else if (!plateAisContinental && plateBisContinental) {
    overridingPlate = plateB;
    console.log(`[Orogeny] Oceanic/Continental: overriding plate ${overridingPlate.id} (${overridingPlate.category})`);
  } else {
    overridingPlate = largerPlate;
    console.log(`[Orogeny] Same type asymmetric: overriding plate ${overridingPlate.id} (${overridingPlate.category})`);
  }

  const subductingPlate = (overridingPlate === plateA) ? plateB : plateA;
  const boundaryTileInfos: BoundaryTileInfo[] = [];
  const processedTiles = new Set<Tile>();

  // Collect convergent neighbor motions for tiles on the overriding plate only
  const tileNeighborMotions = collectConvergentNeighborMotions(boundary, tectonicSystem);

  // Process only tiles from the overriding plate
  for (const [tile, neighborMotions] of tileNeighborMotions) {
    if (tile.plate !== overridingPlate) {
      continue;
    }
    if (processedTiles.has(tile)) {
      continue;
    }
    processedTiles.add(tile);

    // Compute per-tile relative motion and intensity
    const relativeMotion = computeTileRelativeMotion(tile, neighborMotions);
    const initialIntensity = computeInitialOrogenyIntensity(
      relativeMotion,
      plateA,
      plateB,
      tectonicSystem
    );

    console.log(`[Orogeny] Adding boundary tile ${tile.id} from plate ${tile.plate.id} (${tile.plate.category})`);

    const convergenceDir = computeConvergenceDirection(tile, subductingPlate, tectonicSystem);
    boundaryTileInfos.push({ tile, convergenceDir, amplitudeScale, initialIntensity });

    tile.geologicalType = GeologicalType.OROGEN;
    if (tile.geologicalIntensity < initialIntensity) {
      tile.geologicalIntensity = initialIntensity;
    }
  }

  return boundaryTileInfos;
}

/**
 * Initializes orogeny at a single convergent boundary.
 * Returns the boundary tiles with their convergence directions for propagation.
 *
 * For continental-continental collisions:
 * - If plates are similar in area: symmetric propagation on both plates
 * - If one plate is significantly larger: asymmetric, larger plate only
 *
 * For oceanic-oceanic collisions:
 * - Always symmetric propagation on both plates with severe damping
 *
 * For continental-oceanic collisions:
 * - Asymmetric propagation on the continental (overriding) plate only
 */
function initOrogenyAtBoundary(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): BoundaryTileInfo[] {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  console.log(`[Orogeny] Processing boundary ${boundary.id}: plate ${plateA.id} (${plateA.category}) vs plate ${plateB.id} (${plateB.category})`);

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

  // Check plate categories
  const bothContinental =
    plateA.category === PlateCategory.CONTINENTAL &&
    plateB.category === PlateCategory.CONTINENTAL;

  const bothOceanic =
    plateA.category === PlateCategory.OCEANIC &&
    plateB.category === PlateCategory.OCEANIC;

  // Determine if symmetric propagation should be used (both plates)
  const largerPlate = plateA.area >= plateB.area ? plateA : plateB;
  const smallerPlate = plateA.area >= plateB.area ? plateB : plateA;
  const areaRatio = smallerPlate.area > 0 ? largerPlate.area / smallerPlate.area : Infinity;
  const useSymmetricPropagation = bothOceanic || (bothContinental && areaRatio < PROPAGATION_CONFIG.SIMILAR_AREA_RATIO);

  // Base amplitude scale: severely damped for oceanic/oceanic collisions
  const baseAmplitudeScale = bothOceanic ? PROPAGATION_CONFIG.OCEANIC_OCEANIC_DAMPING : 1.0;

  // Dispatch to appropriate initialization function
  // Each function computes per-tile intensity based on the tile's own relative motion
  let boundaryTileInfos: BoundaryTileInfo[];
  if (useSymmetricPropagation) {
    boundaryTileInfos = initSymmetricOrogeny(boundary, tectonicSystem, baseAmplitudeScale);
  } else {
    boundaryTileInfos = initAsymmetricOrogeny(boundary, tectonicSystem, baseAmplitudeScale);
  }

  console.log(`[Orogeny] Boundary ${boundary.id}: added ${boundaryTileInfos.length} tiles for propagation`);

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
    const boundaryTiles = initOrogenyAtBoundary(boundary, tectonicSystem);
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
  initOrogenyAtBoundary,
  runOrogenyPropagation,
  orogenyPropagationStep,
  getContributionToNeighbor,
  computeAverageContribution,
  PROPAGATION_CONFIG
};
