import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, GeologicalIntensity, TectonicSystem, PlateBoundary, BoundaryEdge } from '../data/Plate';
import { kmToDistance } from '../../world/World';
import { getMotionDecile, getAreaDecile, getNeighborTilesInPlate, getUnassignedTiles } from './GeologyUtils';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';

// ============================================================================
// Propagation Parameters
// ============================================================================

export const PROPAGATION_CONFIG = {
  SIMILAR_AREA_RATIO: 2.0,  // Plates with area ratio below this are considered similar
  OCEANIC_OCEANIC_DAMPING: 0.2,  // Severe damping for oceanic/oceanic collisions
};

// ============================================================================
// Perlin Noise Configuration for Orogeny
// ============================================================================

/**
 * Configuration for Perlin noise-based orogeny distribution.
 * Uses mid-level octaves for moderate variation - not too uniform, not too sharp.
 */
const OROGENY_NOISE_CONFIG = {
  // Perlin noise parameters for intensity distribution
  NOISE_SCALE: 6.5,     // Scale of noise features
  NOISE_OCTAVES: 5,     // Mid-level octaves for moderate variation
  NOISE_PERSISTENCE: 0.5,
  NOISE_LACUNARITY: 2.0,

  // Perlin noise parameters for width variation along boundary
  WIDTH_NOISE_SCALE: 3.0,    // Scale for width variation (lower = larger features along boundary)
  WIDTH_NOISE_OCTAVES: 3,    // Moderate octaves for width variation
  WIDTH_VARIATION_MIN: 0.3,  // Minimum width factor (30% of base max)
  WIDTH_VARIATION_MAX: 1.2,  // Maximum width factor (120% of base max)

  // Distance damping - how noise is dampened with distance from boundary
  // Less than 1 to compensate a bit the distance effect, so it is actually not a dampening
  DISTANCE_DAMPING_POWER: 0.7,

  // Intensity thresholds - divides [0, 1] range into intensity levels
  // Values below UNASSIGNED_THRESHOLD leave tile unassigned
  UNASSIGNED_THRESHOLD: 0.15,   // 15% of tiles left unassigned
  LOW_THRESHOLD: 0.35,          // LOW: 15% - 35%
  MODERATE_THRESHOLD: 0.55,     // MODERATE: 35% - 55%
  HIGH_THRESHOLD: 0.75,         // HIGH: 55% - 75%
  // VERY_HIGH: 75% - 100%
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
  OCEANIC_CONTINENTAL_INTENSIVE: [200, 1000] as [number, number],
  OCEANIC_CONTINENTAL_SLOW: [150, 500] as [number, number],

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

  return {
    category,
    maxExpansionDistance,
    maxExpansionKm,
  };
}

// ============================================================================
// Perlin Noise-based Orogeny Assignment
// ============================================================================

/**
 * Information about a candidate tile for orogeny assignment.
 */
interface OrogenyCandidate {
  tile: Tile;
  distanceFromBoundary: number;  // Distance from nearest boundary tile
  rawNoiseValue: number;         // Raw Perlin noise sample
  dampenedNoiseValue: number;    // Noise dampened by distance
}

/**
 * Information about a boundary segment for orogeny processing.
 */
interface BoundarySegmentInfo {
  boundaryTiles: Set<Tile>;      // Tiles directly on the boundary
  targetPlate: Plate;            // The continental plate to expand into
  maxExpansionDistance: number;  // Max expansion distance for this segment
}

/**
 * Gets the tile on the specified target plate's side of a boundary edge.
 */
function getTileFromEdge(
  boundaryEdge: BoundaryEdge,
  targetPlate: Plate,
  tectonicSystem: TectonicSystem
): Tile | null {
  const tile = tectonicSystem.edge2TileMap.get(boundaryEdge.halfedge);
  if (tile && tile.plate === targetPlate) {
    return tile;
  }

  const twinTile = tectonicSystem.edge2TileMap.get(boundaryEdge.halfedge.twin);
  if (twinTile && twinTile.plate === targetPlate) {
    return twinTile;
  }

  return null;
}

/**
 * Computes per-boundary-tile max expansion distances using Perlin noise.
 * This creates variation in the width of orogeny along the boundary.
 */
function computePerTileExpansionDistances(
  boundaryTiles: Set<Tile>,
  baseMaxDistance: number,
  widthNoise: PerlinNoise3D
): Map<Tile, number> {
  const tileMaxDistances = new Map<Tile, number>();

  for (const tile of boundaryTiles) {
    const centroid = tile.centroid;

    // Sample width noise at boundary tile position
    const rawNoise = widthNoise.fbm(
      centroid.x * OROGENY_NOISE_CONFIG.WIDTH_NOISE_SCALE,
      centroid.y * OROGENY_NOISE_CONFIG.WIDTH_NOISE_SCALE,
      centroid.z * OROGENY_NOISE_CONFIG.WIDTH_NOISE_SCALE,
      OROGENY_NOISE_CONFIG.WIDTH_NOISE_OCTAVES
    );

    // Convert from [-1, 1] to [0, 1]
    const normalizedNoise = (rawNoise + 1) / 2;

    // Map to width variation range
    const widthFactor = OROGENY_NOISE_CONFIG.WIDTH_VARIATION_MIN +
      normalizedNoise * (OROGENY_NOISE_CONFIG.WIDTH_VARIATION_MAX - OROGENY_NOISE_CONFIG.WIDTH_VARIATION_MIN);

    // Compute this tile's max expansion distance
    const tileMaxDistance = baseMaxDistance * widthFactor;
    tileMaxDistances.set(tile, tileMaxDistance);
  }

  return tileMaxDistances;
}

/**
 * Collects all candidate tiles within the expansion distance from boundary tiles.
 * Uses BFS to expand from boundary tiles into the plate interior.
 * Each boundary tile has its own max expansion distance for width variation.
 * Returns candidates with their distances from the boundary.
 */
function collectOrogenyCandidates(
  boundaryTiles: Set<Tile>,
  targetPlate: Plate,
  tileMaxDistances: Map<Tile, number>,
  tectonicSystem: TectonicSystem
): OrogenyCandidate[] {
  const candidates: OrogenyCandidate[] = [];
  const visited = new Set<Tile>();
  const tileDistances = new Map<Tile, number>();
  // Track which boundary tile's max distance applies to each candidate
  const tileMaxDistanceLimit = new Map<Tile, number>();

  // Initialize with boundary tiles (distance 0)
  for (const tile of boundaryTiles) {
    if (tile.plate !== targetPlate) continue;
    visited.add(tile);
    tileDistances.set(tile, 0);
    tileMaxDistanceLimit.set(tile, tileMaxDistances.get(tile) || 0);
    candidates.push({
      tile,
      distanceFromBoundary: 0,
      rawNoiseValue: 0,  // Will be filled later
      dampenedNoiseValue: 0,
    });
  }

  // BFS to expand into the plate
  let wave = Array.from(boundaryTiles).filter(t => t.plate === targetPlate);

  while (wave.length > 0) {
    const nextWave: Tile[] = [];

    for (const currentTile of wave) {
      const currentDistance = tileDistances.get(currentTile) || 0;
      const currentMaxDistance = tileMaxDistanceLimit.get(currentTile) || 0;

      // Get neighbors within the same plate
      const neighbors = getNeighborTilesInPlate(currentTile, tectonicSystem);

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;

        // Calculate distance from current tile to neighbor
        const stepDistance = currentTile.centroid.distanceTo(neighbor.centroid);
        const neighborDistance = currentDistance + stepDistance;

        // Check if within this path's max expansion distance
        if (neighborDistance > currentMaxDistance) continue;

        visited.add(neighbor);
        tileDistances.set(neighbor, neighborDistance);
        // Propagate the max distance limit from the originating boundary tile
        tileMaxDistanceLimit.set(neighbor, currentMaxDistance);

        candidates.push({
          tile: neighbor,
          distanceFromBoundary: neighborDistance,
          rawNoiseValue: 0,  // Will be filled later
          dampenedNoiseValue: 0,
        });

        nextWave.push(neighbor);
      }
    }

    wave = nextWave;
  }

  return candidates;
}

/**
 * Samples Perlin noise for all candidates and applies distance damping.
 * The damping reduces noise influence with distance from boundary.
 */
function sampleNoiseForCandidates(
  candidates: OrogenyCandidate[],
  maxExpansionDistance: number,
  perlinNoise: PerlinNoise3D
): void {
  for (const candidate of candidates) {
    const centroid = candidate.tile.centroid;

    // Sample FBM noise at tile centroid
    const rawNoise = perlinNoise.fbm(
      centroid.x * OROGENY_NOISE_CONFIG.NOISE_SCALE,
      centroid.y * OROGENY_NOISE_CONFIG.NOISE_SCALE,
      centroid.z * OROGENY_NOISE_CONFIG.NOISE_SCALE,
      OROGENY_NOISE_CONFIG.NOISE_OCTAVES,
      OROGENY_NOISE_CONFIG.NOISE_PERSISTENCE,
      OROGENY_NOISE_CONFIG.NOISE_LACUNARITY
    );

    // Convert from [-1, 1] to [0, 1]
    const normalizedNoise = (rawNoise + 1) / 2;
    candidate.rawNoiseValue = normalizedNoise;

    // Apply distance damping: noise decreases with distance from boundary
    // damping = 1 at boundary, approaches 0 at max distance
    const distanceRatio = candidate.distanceFromBoundary / maxExpansionDistance;
    const damping = Math.pow(1 - distanceRatio, OROGENY_NOISE_CONFIG.DISTANCE_DAMPING_POWER);

    candidate.dampenedNoiseValue = normalizedNoise * damping;
  }
}

/**
 * Normalizes dampened noise values so they sum to 1.
 * This creates a probability-like distribution for intensity assignment.
 */
function normalizeCandidateNoiseValues(candidates: OrogenyCandidate[]): void {
  if (candidates.length === 0) return;

  // Sum all dampened values
  let totalDampenedNoise = 0;
  for (const candidate of candidates) {
    totalDampenedNoise += candidate.dampenedNoiseValue;
  }

  // Avoid division by zero
  if (totalDampenedNoise < 1e-10) {
    // If all noise values are essentially zero, distribute evenly
    const evenValue = 1 / candidates.length;
    for (const candidate of candidates) {
      candidate.dampenedNoiseValue = evenValue;
    }
    return;
  }

  // Normalize so sum equals 1
  for (const candidate of candidates) {
    candidate.dampenedNoiseValue = candidate.dampenedNoiseValue / totalDampenedNoise;
  }
}

/**
 * Maps a normalized noise value to a geological intensity level.
 * Values below the unassigned threshold leave the tile unassigned.
 */
function mapNoiseToIntensity(normalizedValue: number): GeologicalIntensity | null {
  // Sort candidates by dampened noise to find percentile rank
  // The normalizedValue here is the tile's share of the total noise
  // We need to convert this to a cumulative rank

  if (normalizedValue < OROGENY_NOISE_CONFIG.UNASSIGNED_THRESHOLD) {
    return null;  // Leave unassigned
  } else if (normalizedValue < OROGENY_NOISE_CONFIG.LOW_THRESHOLD) {
    return GeologicalIntensity.LOW;
  } else if (normalizedValue < OROGENY_NOISE_CONFIG.MODERATE_THRESHOLD) {
    return GeologicalIntensity.MODERATE;
  } else if (normalizedValue < OROGENY_NOISE_CONFIG.HIGH_THRESHOLD) {
    return GeologicalIntensity.HIGH;
  } else {
    return GeologicalIntensity.VERY_HIGH;
  }
}

/**
 * Assigns orogeny intensity to candidates based on their normalized noise values.
 * Uses cumulative distribution to assign intensity levels.
 */
function assignOrogenyIntensityToCandidates(candidates: OrogenyCandidate[]): void {
  if (candidates.length === 0) return;

  // Sort candidates by dampened noise value (ascending)
  const sortedCandidates = [...candidates].sort(
    (a, b) => a.dampenedNoiseValue - b.dampenedNoiseValue
  );

  // Compute cumulative sum to get percentile rank for each candidate
  let cumulativeSum = 0;
  for (const candidate of sortedCandidates) {
    cumulativeSum += candidate.dampenedNoiseValue;

    // Map cumulative position to intensity
    const intensity = mapNoiseToIntensity(cumulativeSum);

    if (intensity !== null) {
      candidate.tile.geologicalType = GeologicalType.OROGEN;
      candidate.tile.geologicalIntensity = intensity;
    }
    // If intensity is null, tile remains unassigned (UNKNOWN)
  }
}

/**
 * Identifies boundary segments for orogeny processing.
 * Groups convergent boundary edges by the plates they affect.
 * Handles continental-continental, oceanic-continental, and oceanic-oceanic cases.
 * For oceanic-oceanic, the larger plate (overriding) develops a thin island arc.
 */
function identifyOrogenyBoundarySegments(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): BoundarySegmentInfo[] {
  const plateA = boundary.plateA;
  const plateB = boundary.plateB;

  const plateAisContinental = plateA.category === PlateCategory.CONTINENTAL;
  const plateBisContinental = plateB.category === PlateCategory.CONTINENTAL;

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

  // Get boundary configuration for max expansion distance
  const boundaryConfig = categorizeBoundaryOrogeny(boundary, tectonicSystem);

  const segments: BoundarySegmentInfo[] = [];

  // Determine target plates based on plate categories:
  // - Continental-Continental: both plates (or larger only if asymmetric)
  // - Oceanic-Continental: continental plate only
  // - Oceanic-Oceanic: larger plate (overriding plate gets island arc)
  const targetPlates: Plate[] = [];

  const bothContinental = plateAisContinental && plateBisContinental;
  const bothOceanic = !plateAisContinental && !plateBisContinental;

  if (bothContinental) {
    // Both continental: check if symmetric or asymmetric
    const largerPlate = plateA.area >= plateB.area ? plateA : plateB;
    const smallerPlate = plateA.area >= plateB.area ? plateB : plateA;
    const areaRatio = smallerPlate.area > 0 ? largerPlate.area / smallerPlate.area : Infinity;

    if (areaRatio < PROPAGATION_CONFIG.SIMILAR_AREA_RATIO) {
      // Similar size: both plates get orogeny (symmetric)
      targetPlates.push(plateA, plateB);
    } else {
      // Asymmetric: only larger plate gets orogeny
      targetPlates.push(largerPlate);
    }
  } else if (bothOceanic) {
    // Oceanic-Oceanic: the larger plate typically acts as the overriding plate
    // and develops the volcanic island arc. Expansion is very thin.
    const overridingPlate = plateA.area >= plateB.area ? plateA : plateB;
    targetPlates.push(overridingPlate);
  } else if (plateAisContinental) {
    // Oceanic-Continental: continental plate gets orogeny
    targetPlates.push(plateA);
  } else {
    // Oceanic-Continental: continental plate gets orogeny
    targetPlates.push(plateB);
  }

  // Create segment for each target plate
  for (const targetPlate of targetPlates) {
    const boundaryTiles = new Set<Tile>();

    // Collect boundary tiles on the target plate from convergent edges
    for (const bEdge of boundary.boundaryEdges) {
      if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
        continue;
      }

      const tile = getTileFromEdge(bEdge, targetPlate, tectonicSystem);
      if (tile) {
        boundaryTiles.add(tile);
      }
    }

    if (boundaryTiles.size > 0) {
      // For symmetric continental collision, halve the expansion distance
      const maxDist = bothContinental && targetPlates.length > 1
        ? boundaryConfig.maxExpansionDistance * 0.5
        : boundaryConfig.maxExpansionDistance;

      segments.push({
        boundaryTiles,
        targetPlate,
        maxExpansionDistance: maxDist,
      });
    }
  }

  return segments;
}

/**
 * Processes a single boundary segment using Perlin noise-based orogeny assignment.
 */
function processOrogenySegmentWithNoise(
  segment: BoundarySegmentInfo,
  tectonicSystem: TectonicSystem,
  intensityNoise: PerlinNoise3D,
  widthNoise: PerlinNoise3D
): number {
  // Compute per-boundary-tile max expansion distances using width noise
  const tileMaxDistances = computePerTileExpansionDistances(
    segment.boundaryTiles,
    segment.maxExpansionDistance,
    widthNoise
  );

  // Collect all candidate tiles within expansion distance (varies per boundary tile)
  const candidates = collectOrogenyCandidates(
    segment.boundaryTiles,
    segment.targetPlate,
    tileMaxDistances,
    tectonicSystem
  );

  if (candidates.length === 0) {
    return 0;
  }

  // Sample noise for all candidates with distance damping
  // Use the base max distance for normalization
  sampleNoiseForCandidates(candidates, segment.maxExpansionDistance, intensityNoise);

  // Normalize noise values so they sum to 1
  normalizeCandidateNoiseValues(candidates);

  // Assign orogeny intensity based on normalized values
  assignOrogenyIntensityToCandidates(candidates);

  // Count assigned tiles
  let assignedCount = 0;
  for (const candidate of candidates) {
    if (candidate.tile.geologicalType === GeologicalType.OROGEN) {
      assignedCount++;
    }
  }

  return assignedCount;
}

// ============================================================================
// Orogeny Type Assignment (Main Entry Point)
// ============================================================================

/**
 * Assigns orogeny type to tiles at convergent boundaries involving continental plates.
 * Uses Perlin noise to determine intensity distribution with distance damping.
 *
 * Algorithm:
 * 1. For each boundary involving at least one continental plate
 * 2. Identify convergent edges and collect boundary tiles on continental side
 * 3. Expand into continental plate to collect candidate tiles within max distance
 * 4. Sample Perlin noise for each candidate, dampened by distance to boundary
 * 5. Normalize all dampened values so they sum to 1
 * 6. Assign intensity based on cumulative position in the distribution
 */
export function assignOrogenyType(tectonicSystem: TectonicSystem): void {
  let totalAssigned = 0;

  // Process each boundary
  for (const boundary of tectonicSystem.boundaries) {
    // Create separate noise instances for intensity and width variation
    const intensitySeed = Math.floor(Math.random() * 100000);
    const widthSeed = Math.floor(Math.random() * 100000);
    const intensityNoise = new PerlinNoise3D(intensitySeed);
    const widthNoise = new PerlinNoise3D(widthSeed);

    // Get boundary segments (one per continental plate involved)
    const segments = identifyOrogenyBoundarySegments(boundary, tectonicSystem);

    for (const segment of segments) {
      totalAssigned += processOrogenySegmentWithNoise(segment, tectonicSystem, intensityNoise, widthNoise);
    }
  }

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

/**
 * Recomputes orogeny for a single boundary using Perlin noise.
 * This is called when the user clicks on a boundary in recompute orogeny mode.
 * Returns the number of tiles assigned as orogen.
 */
export function recomputeOrogenyForBoundary(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): number {
  // Create separate noise instances for intensity and width variation
  const intensitySeed = Math.floor(Math.random() * 100000);
  const widthSeed = Math.floor(Math.random() * 100000);
  const intensityNoise = new PerlinNoise3D(intensitySeed);
  const widthNoise = new PerlinNoise3D(widthSeed);

  // Get boundary segments (one per continental plate involved)
  const segments = identifyOrogenyBoundarySegments(boundary, tectonicSystem);

  let totalAssigned = 0;
  for (const segment of segments) {
    totalAssigned += processOrogenySegmentWithNoise(segment, tectonicSystem, intensityNoise, widthNoise);
  }

  console.log(`[Recompute Orogeny] Assigned OROGEN to ${totalAssigned} tiles`);
  return totalAssigned;
}

// ============================================================================
// Ancient Orogeny Zones (Perlin Noise-based)
// ============================================================================

/**
 * Configuration for ancient orogeny zones using Perlin noise.
 * Ancient orogens are eroded remnants of ancient mountain belts,
 * distributed organically across continental interiors.
 */
const ANCIENT_OROGENY_NOISE_CONFIG = {
  // Target area coverage (fraction of remaining unassigned continental area)
  TARGET_AREA_RATIO: [0.06, 0.12] as [number, number],  // 6%-12% of remaining unassigned area

  // Perlin noise parameters for ancient orogeny distribution
  NOISE_SCALE: 3.0,       // Scale of noise features
  NOISE_OCTAVES: 3,       // Low-level octaves for moderate variation
  NOISE_PERSISTENCE: 0.5,
  NOISE_LACUNARITY: 2.0,

  // Convergent boundary avoidance: ancient orogens are traces from past orogenies,
  // so they should be more likely to appear farther from CONVERGENT boundaries
  // (which represent active orogens). Divergent/transform boundaries don't matter.
  // Weight decays as tiles get closer to convergent boundaries.
  CONVERGENT_AVOIDANCE_POWER: 0.5,  // Power for distance weighting (< 1 = weaker avoidance)
};

/**
 * Gets the tile on a specific plate's side of a boundary edge.
 */
function getTileOnPlateSideForAncient(
  boundaryEdge: BoundaryEdge,
  plate: Plate,
  tectonicSystem: TectonicSystem
): Tile | null {
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
 * Computes distance statistics for all tiles in a plate relative to CONVERGENT boundaries only.
 * Returns the maximum distance any tile has from the nearest convergent boundary edge.
 * Tiles not reachable from convergent boundaries get distance Infinity (no avoidance applied).
 */
function computeConvergentBoundaryDistanceStats(
  plate: Plate,
  tectonicSystem: TectonicSystem
): { maxDistFromConvergent: number; tileDistances: Map<Tile, number> } {
  const tileDistances = new Map<Tile, number>();

  // Find tiles adjacent to convergent boundary edges
  const convergentBoundaryTiles = new Set<Tile>();

  for (const boundary of tectonicSystem.boundaries) {
    // Check if this boundary involves our plate
    const isPlateInvolved = boundary.plateA === plate || boundary.plateB === plate;
    if (!isPlateInvolved) continue;

    // Find convergent edges and get tiles on our plate's side
    for (const bEdge of boundary.boundaryEdges) {
      if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
        continue;
      }

      const tile = getTileOnPlateSideForAncient(bEdge, plate, tectonicSystem);
      if (tile) {
        convergentBoundaryTiles.add(tile);
      }
    }
  }

  // If no convergent boundaries, return empty distances (no avoidance will be applied)
  if (convergentBoundaryTiles.size === 0) {
    return { maxDistFromConvergent: 0, tileDistances };
  }

  // BFS from convergent boundary tiles to compute distances
  const visited = new Set<Tile>();

  // Initialize convergent boundary tiles with distance 0
  for (const tile of convergentBoundaryTiles) {
    tileDistances.set(tile, 0);
    visited.add(tile);
  }

  // BFS to propagate distances
  let wave = Array.from(convergentBoundaryTiles);
  while (wave.length > 0) {
    const nextWave: Tile[] = [];

    for (const currentTile of wave) {
      const currentDist = tileDistances.get(currentTile) || 0;

      // Get neighbors in same plate
      const neighbors = getNeighborTilesInPlate(currentTile, tectonicSystem);
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;

        const stepDist = currentTile.centroid.distanceTo(neighbor.centroid);
        const neighborDist = currentDist + stepDist;

        tileDistances.set(neighbor, neighborDist);
        visited.add(neighbor);
        nextWave.push(neighbor);
      }
    }

    wave = nextWave;
  }

  // Find max distance
  let maxDistFromConvergent = 0;
  for (const dist of tileDistances.values()) {
    maxDistFromConvergent = Math.max(maxDistFromConvergent, dist);
  }

  return { maxDistFromConvergent, tileDistances };
}

/**
 * Assigns ancient orogeny type to unassigned tiles in a plate using Perlin noise.
 * Creates a unique Perlin noise field per plate.
 * Weights noise by distance from convergent boundaries (farther = higher chance).
 * Uses a target area ratio to determine how many tiles become ancient orogen.
 * Returns the number of tiles assigned.
 */
function assignAncientOrogenyWithNoise(
  unassignedTiles: Tile[],
  plate: Plate,
  tectonicSystem: TectonicSystem
): number {
  if (unassignedTiles.length === 0) return 0;

  // Create a new Perlin noise instance with a random seed for this plate
  const seed = Math.floor(Math.random() * 100000);
  const perlinNoise = new PerlinNoise3D(seed);

  // Compute distance from convergent boundaries for weighting
  const { maxDistFromConvergent, tileDistances } = computeConvergentBoundaryDistanceStats(plate, tectonicSystem);

  // Compute noise value for each unassigned tile, weighted by convergent boundary distance
  const tileWeightedValues: Map<Tile, number> = new Map();

  for (const tile of unassignedTiles) {
    const centroid = tile.centroid;

    // Sample FBM noise at tile centroid
    const rawNoise = perlinNoise.fbm(
      centroid.x * ANCIENT_OROGENY_NOISE_CONFIG.NOISE_SCALE,
      centroid.y * ANCIENT_OROGENY_NOISE_CONFIG.NOISE_SCALE,
      centroid.z * ANCIENT_OROGENY_NOISE_CONFIG.NOISE_SCALE,
      ANCIENT_OROGENY_NOISE_CONFIG.NOISE_OCTAVES,
      ANCIENT_OROGENY_NOISE_CONFIG.NOISE_PERSISTENCE,
      ANCIENT_OROGENY_NOISE_CONFIG.NOISE_LACUNARITY
    );
    // Convert from [-1, 1] to [0, 1]
    const normalizedNoise = (rawNoise + 1) / 2;

    // Compute convergent boundary distance weight (farther from convergent = higher weight)
    // If no convergent boundaries exist, all tiles get weight 1 (no avoidance)
    let convergentWeight = 1.0;
    if (maxDistFromConvergent > 0) {
      const convergentDist = tileDistances.get(tile) || maxDistFromConvergent;
      const normalizedConvergentDist = convergentDist / maxDistFromConvergent;
      // Weight: 0 at convergent boundary, 1 at farthest point
      convergentWeight = Math.pow(normalizedConvergentDist, ANCIENT_OROGENY_NOISE_CONFIG.CONVERGENT_AVOIDANCE_POWER);
    }

    // Combine noise with convergent boundary weight
    const weightedValue = normalizedNoise * convergentWeight;
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

  // Sample target area ratio for ancient orogeny coverage
  const [minRatio, maxRatio] = ANCIENT_OROGENY_NOISE_CONFIG.TARGET_AREA_RATIO;
  const targetRatio = minRatio + Math.random() * (maxRatio - minRatio);

  // Compute total unassigned area and target ancient orogeny area
  let totalUnassignedArea = 0;
  for (const tile of unassignedTiles) {
    totalUnassignedArea += tile.area;
  }
  const targetArea = totalUnassignedArea * targetRatio;

  // Sort tiles by normalized value (descending - highest values first)
  const sortedTiles = Array.from(unassignedTiles).sort((a, b) => {
    const valueA = tileNormalizedValues.get(a) || 0;
    const valueB = tileNormalizedValues.get(b) || 0;
    return valueB - valueA;  // Descending order (highest values first)
  });

  // Accumulate area until we reach target, marking tiles as ancient orogen
  let accumulatedArea = 0;
  let assignedCount = 0;

  for (const tile of sortedTiles) {
    if (accumulatedArea >= targetArea) {
      break;
    }

    tile.geologicalType = GeologicalType.ANCIENT_OROGEN;
    assignedCount++;
    accumulatedArea += tile.area;
  }

  return assignedCount;
}

/**
 * Assigns ancient orogeny zones to continental plates using Perlin noise.
 * Ancient orogeny zones are only placed on continental plates.
 * Uses noise-based distribution weighted by distance from convergent boundaries.
 */
export function assignAncientOrogenyZones(tectonicSystem: TectonicSystem): void {
  let totalAssigned = 0;

  for (const plate of tectonicSystem.plates) {
    // Only continental plates get ancient orogeny zones
    if (plate.category !== PlateCategory.CONTINENTAL) {
      continue;
    }

    // Get unassigned tiles for this plate
    const unassignedTiles = getUnassignedTiles(plate);
    if (unassignedTiles.length === 0) {
      continue;
    }

    // Assign ancient orogeny using noise-based distribution
    totalAssigned += assignAncientOrogenyWithNoise(unassignedTiles, plate, tectonicSystem);
  }

  console.log(`Assigned ANCIENT_OROGEN to ${totalAssigned} tiles`);
}
