import * as THREE from 'three';
import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, GeologicalIntensity, TectonicSystem, PlateBoundary } from '../data/Plate';
import { kmToDistance } from '../../world/World';

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
// Orogeny Expansion Limits (in km)
// ============================================================================

/**
 * Maximum orogeny expansion distances based on boundary type and intensity.
 * Values are [min, max] ranges in kilometers.
 */
const OROGENY_EXPANSION_KM = {
  // Continental-Continental collisions
  CONTINENTAL_CONTINENTAL_INTENSIVE: [1000, 1500] as [number, number],
  CONTINENTAL_CONTINENTAL_SLOW: [500, 800] as [number, number],

  // Oceanic-Continental collisions (subduction)
  OCEANIC_CONTINENTAL_INTENSIVE: [200, 400] as [number, number],
  OCEANIC_CONTINENTAL_SLOW: [150, 300] as [number, number],

  // Oceanic-Oceanic collisions
  OCEANIC_OCEANIC: [100, 200] as [number, number],
};

/**
 * Threshold for determining "intensive" vs "slow" collisions.
 * Based on combined score of motion and plate area deciles.
 * Score ranges from 0 (slowest/smallest) to 1 (fastest/largest).
 */
const INTENSIVE_THRESHOLD = 0.5;

// ============================================================================
// Orogeny Expansion Category
// ============================================================================

enum OrogenyExpansionCategory {
  CONTINENTAL_CONTINENTAL_INTENSIVE = 'CONTINENTAL_CONTINENTAL_INTENSIVE',
  CONTINENTAL_CONTINENTAL_SLOW = 'CONTINENTAL_CONTINENTAL_SLOW',
  OCEANIC_CONTINENTAL_INTENSIVE = 'OCEANIC_CONTINENTAL_INTENSIVE',
  OCEANIC_CONTINENTAL_SLOW = 'OCEANIC_CONTINENTAL_SLOW',
  OCEANIC_OCEANIC = 'OCEANIC_OCEANIC',
}

interface BoundaryOrogenyConfig {
  category: OrogenyExpansionCategory;
  maxExpansionDistance: number;  // In unit sphere distance (converted from km)
  maxExpansionKm: number;        // Original km value for reference
}

/**
 * Computes the intensity score for a boundary based on motion and plate sizes.
 * Returns a value between 0 (slow/small) and 1 (fast/large).
 */
function computeBoundaryIntensityScore(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): number {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  // Compute average relative motion at convergent edges
  let totalRelativeMotion = 0;
  let convergentEdgeCount = 0;

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    if (tileA && tileB) {
      const relativeMotion = tileA.motionVec.clone().sub(tileB.motionVec).length();
      totalRelativeMotion += relativeMotion;
      convergentEdgeCount++;
    }
  }

  const avgRelativeMotion = convergentEdgeCount > 0
    ? totalRelativeMotion / convergentEdgeCount
    : 0;

  // Get motion decile
  const motionDecile = getMotionDecile(avgRelativeMotion, tectonicSystem);
  const motionFactor = motionDecile / 9; // 0 to 1

  // Get area deciles
  const areaDecileA = getAreaDecile(plateA.area, tectonicSystem);
  const areaDecileB = getAreaDecile(plateB.area, tectonicSystem);
  const avgAreaDecile = (areaDecileA + areaDecileB) / 2;
  const areaFactor = avgAreaDecile / 9; // 0 to 1

  // Combined score: both factors contribute equally
  return (motionFactor + areaFactor) / 2;
}

/**
 * Determines the orogeny expansion category and maximum distance for a boundary.
 */
function categorizeBoundaryOrogeny(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): BoundaryOrogenyConfig {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  const plateAisContinental = plateA.category === PlateCategory.CONTINENTAL;
  const plateBisContinental = plateB.category === PlateCategory.CONTINENTAL;

  const bothContinental = plateAisContinental && plateBisContinental;
  const bothOceanic = !plateAisContinental && !plateBisContinental;

  // Compute intensity score
  const intensityScore = computeBoundaryIntensityScore(boundary, tectonicSystem);
  const isIntensive = intensityScore >= INTENSIVE_THRESHOLD;

  // Determine category and get expansion range
  let category: OrogenyExpansionCategory;
  let expansionRange: [number, number];

  if (bothContinental) {
    if (isIntensive) {
      category = OrogenyExpansionCategory.CONTINENTAL_CONTINENTAL_INTENSIVE;
      expansionRange = OROGENY_EXPANSION_KM.CONTINENTAL_CONTINENTAL_INTENSIVE;
    } else {
      category = OrogenyExpansionCategory.CONTINENTAL_CONTINENTAL_SLOW;
      expansionRange = OROGENY_EXPANSION_KM.CONTINENTAL_CONTINENTAL_SLOW;
    }
  } else if (bothOceanic) {
    category = OrogenyExpansionCategory.OCEANIC_OCEANIC;
    expansionRange = OROGENY_EXPANSION_KM.OCEANIC_OCEANIC;
  } else {
    // Mixed: Oceanic-Continental
    if (isIntensive) {
      category = OrogenyExpansionCategory.OCEANIC_CONTINENTAL_INTENSIVE;
      expansionRange = OROGENY_EXPANSION_KM.OCEANIC_CONTINENTAL_INTENSIVE;
    } else {
      category = OrogenyExpansionCategory.OCEANIC_CONTINENTAL_SLOW;
      expansionRange = OROGENY_EXPANSION_KM.OCEANIC_CONTINENTAL_SLOW;
    }
  }

  // Interpolate within range based on intensity score
  const [minKm, maxKm] = expansionRange;
  const maxExpansionKm = minKm + (maxKm - minKm) * intensityScore;

  // Convert to unit sphere distance
  const maxExpansionDistance = kmToDistance(maxExpansionKm);

  console.log(`[Orogeny] Boundary ${boundary.id}: category=${category}, intensity=${intensityScore.toFixed(2)}, maxExpansion=${maxExpansionKm.toFixed(0)}km`);

  return {
    category,
    maxExpansionDistance,
    maxExpansionKm,
  };
}

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
 * Collects convergent edge midpoints for each tile from the boundary.
 * Returns a map from tile to the list of edge midpoints on convergent boundary edges.
 */
function collectConvergentEdgeMidpoints(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): Map<Tile, THREE.Vector3[]> {
  const tileEdgeMidpoints = new Map<Tile, THREE.Vector3[]>();

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
      continue;
    }

    const he = bEdge.halfedge;
    const tileA = tectonicSystem.edge2TileMap.get(he);
    const tileB = tectonicSystem.edge2TileMap.get(he.twin);

    // Compute edge midpoint
    const midpoint = he.vertex.position.clone().add(he.twin.vertex.position).multiplyScalar(0.5);

    if (tileA) {
      if (!tileEdgeMidpoints.has(tileA)) {
        tileEdgeMidpoints.set(tileA, []);
      }
      tileEdgeMidpoints.get(tileA)!.push(midpoint.clone());
    }

    if (tileB) {
      if (!tileEdgeMidpoints.has(tileB)) {
        tileEdgeMidpoints.set(tileB, []);
      }
      tileEdgeMidpoints.get(tileB)!.push(midpoint.clone());
    }
  }

  return tileEdgeMidpoints;
}

/**
 * Computes the average direction from edge midpoints to tile center.
 * This gives the direction from boundary into the plate interior.
 */
function computeBoundaryToTileDirection(
  tile: Tile,
  edgeMidpoints: THREE.Vector3[]
): THREE.Vector3 {
  if (edgeMidpoints.length === 0) {
    return new THREE.Vector3(0, 0, 1); // Fallback
  }

  const avgDir = new THREE.Vector3();
  for (const midpoint of edgeMidpoints) {
    // Vector from edge midpoint to tile center
    const dir = tile.centroid.clone().sub(midpoint);
    avgDir.add(dir);
  }
  avgDir.divideScalar(edgeMidpoints.length);

  if (avgDir.length() < 1e-10) {
    return new THREE.Vector3(0, 0, 1); // Fallback
  }

  return avgDir.normalize();
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
  distanceFromBoundary: number;  // Cumulative distance from boundary (unit sphere)
  maxExpansionDistance: number;  // Maximum allowed distance (unit sphere)
}

interface NeighborContribution {
  intensity: GeologicalIntensity;
  dir: THREE.Vector3;
  amplitudeScale: number;
  alignment: number;
  distanceFromBoundary: number;  // Distance to this neighbor from boundary
  maxExpansionDistance: number;  // Max expansion distance for this contribution
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
  const { tile, intensity, dir, amplitudeScale, distanceFromBoundary, maxExpansionDistance } = propagatingState;

  // Stop if intensity is too low (LOW tiles cannot propagate)
  if (intensity <= GeologicalIntensity.LOW) {
    return null;
  }

  // Check if neighbor is "downstream" (in convergence direction)
  const toNeighborVec = neighbor.centroid.clone().sub(tile.centroid);
  const stepDistance = toNeighborVec.length();
  const toNeighbor = toNeighborVec.normalize();
  const alignment = toNeighbor.dot(dir);

  // Only propagate to tiles roughly in the convergence direction
  if (alignment < PROPAGATION_CONFIG.MIN_ALIGNMENT) {
    return null;
  }

  // Compute new distance from boundary
  const newDistanceFromBoundary = distanceFromBoundary + stepDistance;

  // Stop if we've exceeded the maximum expansion distance
  if (newDistanceFromBoundary > maxExpansionDistance) {
    return null;
  }

  // Calculate new intensity (may decay)
  let newIntensity = intensity;
  if (Math.random() < PROPAGATION_CONFIG.DECAY_PROBABILITY) {
    newIntensity = intensity - 1;
  }

  // Direction for the neighbor: vector from propagating tile (boundary) to neighbor
  return {
    intensity: newIntensity,
    dir: toNeighbor.clone(),
    amplitudeScale,
    alignment,
    distanceFromBoundary: newDistanceFromBoundary,
    maxExpansionDistance,
  };
}

/**
 * Computes the average contribution from multiple propagating tiles to a neighbor.
 * Returns the averaged state or null if no valid contributions.
 */
function computeAverageContribution(
  contributions: NeighborContribution[]
): {
  intensity: GeologicalIntensity;
  dir: THREE.Vector3;
  amplitudeScale: number;
  distanceFromBoundary: number;
  maxExpansionDistance: number;
} | null {
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

  // Average distance from boundary
  const avgDistanceFromBoundary = contributions.reduce((sum, c) => sum + c.distanceFromBoundary, 0) / contributions.length;

  // Use minimum max expansion distance (most restrictive)
  const minMaxExpansionDistance = Math.min(...contributions.map(c => c.maxExpansionDistance));

  return {
    intensity: avgIntensity,
    dir: avgDir,
    amplitudeScale: avgAmplitudeScale,
    distanceFromBoundary: avgDistanceFromBoundary,
    maxExpansionDistance: minMaxExpansionDistance,
  };
}

/**
 * Performs a single step of orogeny propagation.
 *
 * For each propagating tile, collects contributions to neighbor tiles,
 * computes average contribution per neighbor, and updates their orogeny.
 *
 * @param propagatingTiles - Current set of tiles propagating orogeny
 * @param assigned - Set of already assigned tiles (modified in place)
 * @param tectonicSystem - The tectonic system
 * @returns The next set of propagating tiles
 */
function orogenyPropagationStep(
  propagatingTiles: PropagatingTileState[],
  assigned: Set<Tile>,
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
      // Skip already assigned tiles
      if (assigned.has(neighbor)) {
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
        amplitudeScale: avgContribution.amplitudeScale,
        distanceFromBoundary: avgContribution.distanceFromBoundary,
        maxExpansionDistance: avgContribution.maxExpansionDistance,
      });

      // Mark as assigned
      assigned.add(neighbor);
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
 * 6. Track assigned tiles to avoid re-processing
 */
function runOrogenyPropagation(
  initialTiles: BoundaryTileInfo[],
  tectonicSystem: TectonicSystem
): void {
  const assigned = new Set<Tile>();

  console.log(`[Orogeny Propagation] Starting with ${initialTiles.length} initial tiles`);

  // Initialize propagating tiles from boundary tiles
  let propagatingTiles: PropagatingTileState[] = [];
  for (const info of initialTiles) {
    if (!assigned.has(info.tile)) {
      console.log(`[Orogeny Propagation] Initial tile ${info.tile.id} in plate ${info.tile.plate.id} (${info.tile.plate.category}), intensity=${info.initialIntensity}`);
      propagatingTiles.push({
        tile: info.tile,
        intensity: info.initialIntensity,
        dir: info.convergenceDir,
        amplitudeScale: info.amplitudeScale,
        distanceFromBoundary: 0,  // Initial tiles are at the boundary
        maxExpansionDistance: info.maxExpansionDistance,
      });
      assigned.add(info.tile);
    }
  }

  let step = 0;

  // Step-by-step propagation
  while (propagatingTiles.length > 0) {
    step++;
    propagatingTiles = orogenyPropagationStep(propagatingTiles, assigned, tectonicSystem);
    // break;
  }

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
  maxExpansionDistance: number;  // Maximum expansion distance (unit sphere)
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
  amplitudeScale: number,
  maxExpansionDistance: number
): BoundaryTileInfo[] {
  const boundaryTileInfos: BoundaryTileInfo[] = [];
  const symmetricAmplitudeScale = amplitudeScale * 0.5;
  const processedTiles = new Set<Tile>();

  // Collect convergent neighbor motions and edge midpoints for each tile
  const tileNeighborMotions = collectConvergentNeighborMotions(boundary, tectonicSystem);
  const tileEdgeMidpoints = collectConvergentEdgeMidpoints(boundary, tectonicSystem);

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

    // Compute direction from edge midpoints to tile center
    const edgeMidpoints = tileEdgeMidpoints.get(tile) || [];
    const convergenceDir = computeBoundaryToTileDirection(tile, edgeMidpoints);

    boundaryTileInfos.push({
      tile,
      convergenceDir,
      amplitudeScale: symmetricAmplitudeScale,
      initialIntensity,
      maxExpansionDistance,
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
  amplitudeScale: number,
  maxExpansionDistance: number
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

  const boundaryTileInfos: BoundaryTileInfo[] = [];
  const processedTiles = new Set<Tile>();

  // Collect convergent neighbor motions and edge midpoints for tiles on the overriding plate only
  const tileNeighborMotions = collectConvergentNeighborMotions(boundary, tectonicSystem);
  const tileEdgeMidpoints = collectConvergentEdgeMidpoints(boundary, tectonicSystem);

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

    // Compute direction from edge midpoints to tile center
    const edgeMidpoints = tileEdgeMidpoints.get(tile) || [];
    const convergenceDir = computeBoundaryToTileDirection(tile, edgeMidpoints);
    boundaryTileInfos.push({ tile, convergenceDir, amplitudeScale, initialIntensity, maxExpansionDistance });

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

  // Categorize boundary to determine max expansion distance
  const boundaryConfig = categorizeBoundaryOrogeny(boundary, tectonicSystem);

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
    boundaryTileInfos = initSymmetricOrogeny(boundary, tectonicSystem, baseAmplitudeScale, boundaryConfig.maxExpansionDistance);
  } else {
    boundaryTileInfos = initAsymmetricOrogeny(boundary, tectonicSystem, baseAmplitudeScale, boundaryConfig.maxExpansionDistance);
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
