import * as THREE from 'three';
import { Tile, Plate, PlateCategory, BoundaryType, GeologicalType, TectonicSystem, PlateBoundary, BoundaryEdge } from '../data/Plate';
import { kmToDistance, distanceToKm } from '../../../../shared/world/World';
import { getNeighborTilesInPlate } from './GeologyUtils';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';

// ============================================================================
// Igneous Province Configuration ============================================================================

/**
 * Configuration for Large Igneous Provinces (LIPs).
 * Based on real-world LIP distribution patterns.
 */
const LIP_CONFIG = {
  // === Continental LIP Count ===
  CONTINENTAL_LIP_COUNT: [3, 8] as [number, number],

  // === Continental LIPs (on Shield/Platform) ===
  CONTINENTAL_RADIUS_KM: [200, 600] as [number, number],

  // === Rift LIPs (at divergent boundaries) ===
  // Probability based on divergent intensity and boundary length
  RIFT_BASE_PROBABILITY: 0.2,       // Base probability for low intensity/short boundary
  RIFT_MAX_PROBABILITY: 0.95,       // Max probability for high intensity/long boundary
  RIFT_INTENSITY_THRESHOLD: 0.02,   // Intensity above which probability scales up
  RIFT_BOUNDARY_LENGTH_MIN_KM: 500,  // Divergent boundary length (km) for base probability
  RIFT_BOUNDARY_LENGTH_MAX_KM: 3000, // Divergent boundary length (km) for max probability boost

  // Random walk from most intensive divergent point, placed on ONE side only
  RIFT_LENGTH_KM: [500, 1500] as [number, number],      // Total length of main rift
  RIFT_WIDTH_KM: [50, 200] as [number, number],
  RIFT_TURN_PROBABILITY: 0.3,       // Probability of turning at each step
  RIFT_BRANCH_PROBABILITY: 0.08,    // Probability of creating a branch at each step
  RIFT_BRANCH_LENGTH_FACTOR: 0.4,   // Branch length as fraction of remaining main length

  // === Triple Junction LIPs (optional) ===
  TRIPLE_JUNCTION_PROBABILITY: 0.50,
  TRIPLE_JUNCTION_RADIUS_KM: [100, 400] as [number, number],

  // === Perlin Noise Parameters ===
  NOISE_SCALE: 9.0,
  NOISE_OCTAVES: 5,
  NOISE_PERSISTENCE: 0.3,
  NOISE_LACUNARITY: 1.0,
};

// ============================================================================
// Exclusion Rules
// ============================================================================

/**
 * Checks if a tile can have a LIP placed on it.
 * Excludes: Orogeny, Convergent boundaries, Active basins
 */
function canPlaceLIP(tile: Tile): boolean {
  const type = tile.geologicalType;
  // Exclude orogeny (mountain building zones)
  if (type === GeologicalType.OROGEN) return false;
  // Exclude active basins
  if (type === GeologicalType.BASIN) return false;
  return true;
}

/**
 * Checks if a tile is valid for continental LIP placement.
 * Must be on a continental plate with no assigned geological type (UNKNOWN).
 * Shield/Platform are assigned later, so we check for UNKNOWN here.
 */
function isValidContinentalLIPTile(tile: Tile): boolean {
  return tile.geologicalType === GeologicalType.UNKNOWN &&
    tile.plate.category === PlateCategory.CONTINENTAL &&
    canPlaceLIP(tile);
}


// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets all valid continental tiles (Shield/Platform) across all continental plates.
 */
function getAllContinentalTiles(tectonicSystem: TectonicSystem): Tile[] {
  const tiles: Tile[] = [];
  for (const plate of tectonicSystem.plates) {
    if (plate.category !== PlateCategory.CONTINENTAL) continue;
    for (const tile of plate.tiles) {
      if (isValidContinentalLIPTile(tile)) {
        tiles.push(tile);
      }
    }
  }
  return tiles;
}


/**
 * Gets all continental/continental divergent boundaries.
 */
function getContContDivergentBoundaries(tectonicSystem: TectonicSystem): PlateBoundary[] {
  const boundaries: PlateBoundary[] = [];

  for (const boundary of tectonicSystem.boundaries) {
    // Check if at both plate is continental
    const bothContinental = (boundary.plateA.category === PlateCategory.CONTINENTAL &&
      boundary.plateB.category === PlateCategory.CONTINENTAL);
    if (!bothContinental) continue;

    // Check if boundary has divergent edges
    let hasDivergent = false;
    for (const bEdge of boundary.boundaryEdges) {
      if (bEdge.refinedType === BoundaryType.DIVERGENT) {
        hasDivergent = true;
        break;
      }
    }

    if (hasDivergent) {
      boundaries.push(boundary);
    }
  }

  return boundaries;
}

/**
 * Computes the divergent intensity for a boundary edge.
 * Returns the magnitude of relative motion away from each other.
 * Higher value = more intensive divergence.
 */
function computeDivergentIntensity(
  bEdge: BoundaryEdge,
  tectonicSystem: TectonicSystem
): number {
  if (bEdge.refinedType !== BoundaryType.DIVERGENT) return 0;

  const tileA = tectonicSystem.edge2TileMap.get(bEdge.halfedge);
  const tileB = tectonicSystem.edge2TileMap.get(bEdge.halfedge.twin);
  if (!tileA || !tileB) return 0;

  // Get motion vectors
  const motionA = tileA.motionVec;
  const motionB = tileB.motionVec;

  // Compute direction from A to B (across the boundary)
  const dirAtoB = new THREE.Vector3().subVectors(tileB.centroid, tileA.centroid).normalize();

  // Project motions onto this direction
  const projA = motionA.dot(dirAtoB);  // Positive = moving toward B
  const projB = motionB.dot(dirAtoB);  // Positive = moving toward B

  // Divergent intensity = how fast they're moving apart
  // A moving away (negative) + B moving away (positive) = divergent
  const divergentRate = projB - projA;

  return Math.max(0, divergentRate);
}

/**
 * Finds the most intensive divergent boundary edge and returns the tiles on both sides.
 */
function findMostIntensiveDivergentPoint(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): { bEdge: BoundaryEdge; tileA: Tile; tileB: Tile; intensity: number } | null {
  let bestEdge: BoundaryEdge | null = null;
  let bestTileA: Tile | null = null;
  let bestTileB: Tile | null = null;
  let bestIntensity = 0;

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.DIVERGENT) continue;

    // if the tiles on either side are already assigned to oceanic crust, skip
    const tileA = tectonicSystem.edge2TileMap.get(bEdge.halfedge);
    const tileB = tectonicSystem.edge2TileMap.get(bEdge.halfedge.twin);

    if (!tileA || !tileB) {
      console.error('Boundary edge missing adjacent tiles');
      continue;
    }

    if ((tileA.geologicalType === GeologicalType.OCEANIC_CRUST) ||
      (tileB.geologicalType === GeologicalType.OCEANIC_CRUST)) {
      continue;
    }

    const intensity = computeDivergentIntensity(bEdge, tectonicSystem);
    if (intensity > bestIntensity) {
      const tileA = tectonicSystem.edge2TileMap.get(bEdge.halfedge);
      const tileB = tectonicSystem.edge2TileMap.get(bEdge.halfedge.twin);
      if (tileA && tileB) {
        bestEdge = bEdge;
        bestTileA = tileA;
        bestTileB = tileB;
        bestIntensity = intensity;
      }
    }
  }

  if (!bestEdge || !bestTileA || !bestTileB) return null;

  return { bEdge: bestEdge, tileA: bestTileA, tileB: bestTileB, intensity: bestIntensity };
}

/**
 * Computes the total length of divergent edges in a boundary (in km).
 */
function computeDivergentBoundaryLengthKm(
  boundary: PlateBoundary
): number {
  let totalLength = 0;

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType !== BoundaryType.DIVERGENT) continue;

    const he = bEdge.halfedge;
    const edgeLength = he.vertex.position.distanceTo(he.twin.vertex.position);
    totalLength += edgeLength;
  }

  return distanceToKm(totalLength);
}

/**
 * Gets neighbor tiles that are in the specified plate.
 */
function getNeighborTilesInSpecificPlate(
  tile: Tile,
  plate: Plate,
  tectonicSystem: TectonicSystem
): Tile[] {
  const neighbors: Tile[] = [];
  for (const he of tile.loop()) {
    const neighborTile = tectonicSystem.edge2TileMap.get(he.twin);
    if (neighborTile && neighborTile.plate === plate) {
      neighbors.push(neighborTile);
    }
  }
  return neighbors;
}

/**
 * Represents a triple junction where 3 plates meet.
 */
interface TripleJunction {
  position: THREE.Vector3;
  plates: [Plate, Plate, Plate];
  tiles: Tile[];  // Tiles around the junction
  divergentCount: number;  // Number of divergent boundaries (0-3)
}

/**
 * Finds all triple junctions in the tectonic system.
 * A triple junction is a point where exactly 3 plates meet.
 * Returns only junctions with at least 2 divergent boundaries.
 */
function findTripleJunctions(tectonicSystem: TectonicSystem): TripleJunction[] {
  const junctions: TripleJunction[] = [];

  // We need to find vertices in the primal graph (dual face corners) where 3 plates meet
  // Each tile is a face in the dual graph. The corners of tiles are vertices.
  // At each vertex, multiple tiles meet. If exactly 3 different plates meet there,
  // it's a triple junction.

  // Build a map from vertex ID to tiles that share that vertex
  const vertexToTiles = new Map<number, Set<Tile>>();

  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      for (const he of tile.loop()) {
        const vertexId = he.vertex.id;
        if (!vertexToTiles.has(vertexId)) {
          vertexToTiles.set(vertexId, new Set<Tile>());
        }
        vertexToTiles.get(vertexId)!.add(tile);
      }
    }
  }

  // For each vertex, check if exactly 3 plates meet there
  for (const [vertexId, tiles] of vertexToTiles) {
    const platesAtVertex = new Set<Plate>();
    for (const tile of tiles) {
      platesAtVertex.add(tile.plate);
    }

    if (platesAtVertex.size !== 3) continue;  // Not a triple junction

    const platesArray = Array.from(platesAtVertex) as [Plate, Plate, Plate];
    const tilesArray = Array.from(tiles);

    // Get vertex position (from any tile's halfedge with this vertex)
    let vertexPosition: THREE.Vector3 | null = null;
    for (const tile of tiles) {
      for (const he of tile.loop()) {
        if (he.vertex.id === vertexId) {
          vertexPosition = he.vertex.position.clone();
          break;
        }
      }
      if (vertexPosition) break;
    }

    if (!vertexPosition) continue;

    // Count divergent boundaries between the 3 plates
    let divergentCount = 0;
    const platePairs: [Plate, Plate][] = [
      [platesArray[0], platesArray[1]],
      [platesArray[1], platesArray[2]],
      [platesArray[0], platesArray[2]],
    ];

    for (const [plateA, plateB] of platePairs) {
      // Find the boundary between these two plates
      let boundary: PlateBoundary | undefined;
      for (const b of tectonicSystem.boundaries) {
        if ((b.plateA === plateA && b.plateB === plateB) ||
          (b.plateA === plateB && b.plateB === plateA)) {
          boundary = b;
          break;
        }
      }

      if (boundary) {
        // Check if any edge near this vertex is divergent
        for (const bEdge of boundary.boundaryEdges) {
          if (bEdge.refinedType === BoundaryType.DIVERGENT) {
            // Check if this edge is near the vertex
            const edgeMidpoint = new THREE.Vector3()
              .addVectors(bEdge.halfedge.vertex.position, bEdge.halfedge.twin.vertex.position)
              .multiplyScalar(0.5);
            const distToVertex = edgeMidpoint.distanceTo(vertexPosition);

            // If edge is close to vertex (within ~2 tile widths), count the boundary as divergent
            if (distToVertex < 0.15) {  // Approximate threshold
              divergentCount++;
              break;  // Only count once per boundary
            }
          }
        }
      }
    }

    // Only include junctions with at least 2 divergent boundaries
    if (divergentCount >= 2) {
      junctions.push({
        position: vertexPosition,
        plates: platesArray,
        tiles: tilesArray,
        divergentCount
      });
    }
  }

  return junctions;
}

/**
 * Checks if a tile is valid for triple junction LIP placement.
 */
function isValidTripleJunctionLIPTile(tile: Tile): boolean {
  // Can place on most geology types except orogeny and basin
  return canPlaceLIP(tile);
}

/**
 * Assigns a triple junction LIP centered on the junction.
 */
function assignTripleJunctionLIP(
  junction: TripleJunction,
  tectonicSystem: TectonicSystem
): number {
  // Find the closest tile to the junction center
  let closestTile: Tile | null = null;
  let closestDist = Infinity;

  for (const tile of junction.tiles) {
    const dist = tile.centroid.distanceTo(junction.position);
    if (dist < closestDist) {
      closestDist = dist;
      closestTile = tile;
    }
  }

  if (!closestTile) return 0;

  // Random radius
  const [minRadius, maxRadius] = LIP_CONFIG.TRIPLE_JUNCTION_RADIUS_KM;
  const radiusKm = minRadius + Math.random() * (maxRadius - minRadius);

  // Create Perlin noise
  const seed = Math.floor(Math.random() * 100000);
  const perlinNoise = new PerlinNoise3D(seed);

  // Use createCircularLIP but allow crossing plate boundaries
  return createTripleJunctionLIP(closestTile, radiusKm, tectonicSystem, perlinNoise);
}

/**
 * Creates a circular LIP that can span multiple plates (for triple junctions).
 */
function createTripleJunctionLIP(
  seedTile: Tile,
  radiusKm: number,
  tectonicSystem: TectonicSystem,
  perlinNoise: PerlinNoise3D
): number {
  const maxRadius = kmToDistance(radiusKm);
  const seedCentroid = seedTile.centroid;

  const visited = new Set<Tile>();
  let assignedCount = 0;

  visited.add(seedTile);
  let wave = [seedTile];

  while (wave.length > 0) {
    const nextWave: Tile[] = [];

    for (const tile of wave) {
      const distFromSeed = tile.centroid.distanceTo(seedCentroid);

      // Sample noise for irregular shape
      const noiseValue = perlinNoise.fbm(
        tile.centroid.x * LIP_CONFIG.NOISE_SCALE,
        tile.centroid.y * LIP_CONFIG.NOISE_SCALE,
        tile.centroid.z * LIP_CONFIG.NOISE_SCALE,
        LIP_CONFIG.NOISE_OCTAVES,
        LIP_CONFIG.NOISE_PERSISTENCE,
        LIP_CONFIG.NOISE_LACUNARITY
      );
      const normalizedNoise = (noiseValue + 1) / 2;

      // Effective radius varies with noise (0.5 to 1.0 of max)
      const effectiveRadius = maxRadius * (0.5 + 0.5 * normalizedNoise);

      if (distFromSeed <= effectiveRadius) {
        // Assign if valid (can span multiple plates)
        if (isValidTripleJunctionLIPTile(tile)) {
          tile.geologicalType = GeologicalType.IGNEOUS_PROVINCE;
          assignedCount++;
        }

        // Expand to ALL neighbors (crossing plate boundaries)
        for (const he of tile.loop()) {
          const neighborTile = tectonicSystem.edge2TileMap.get(he.twin);
          if (neighborTile && !visited.has(neighborTile)) {
            visited.add(neighborTile);
            nextWave.push(neighborTile);
          }
        }
      }
    }

    wave = nextWave;
  }

  return assignedCount;
}

// ============================================================================
// LIP Creation Functions
// ============================================================================

/**
 * Creates a circular/irregular LIP using Perlin noise.
 */
function createCircularLIP(
  seedTile: Tile,
  radiusKm: number,
  tectonicSystem: TectonicSystem,
  perlinNoise: PerlinNoise3D,
  validityCheck: (tile: Tile) => boolean
): number {
  const maxRadius = kmToDistance(radiusKm);
  const seedCentroid = seedTile.centroid;

  const visited = new Set<Tile>();
  let assignedCount = 0;

  visited.add(seedTile);
  let wave = [seedTile];

  while (wave.length > 0) {
    const nextWave: Tile[] = [];

    for (const tile of wave) {
      const distFromSeed = tile.centroid.distanceTo(seedCentroid);

      // Sample noise for irregular shape
      const noiseValue = perlinNoise.fbm(
        tile.centroid.x * LIP_CONFIG.NOISE_SCALE,
        tile.centroid.y * LIP_CONFIG.NOISE_SCALE,
        tile.centroid.z * LIP_CONFIG.NOISE_SCALE,
        LIP_CONFIG.NOISE_OCTAVES,
        LIP_CONFIG.NOISE_PERSISTENCE,
        LIP_CONFIG.NOISE_LACUNARITY
      );
      const normalizedNoise = (noiseValue + 1) / 2;

      // Effective radius varies with noise (0.5 to 1.0 of max)
      const effectiveRadius = maxRadius * (0.5 + 0.5 * normalizedNoise);

      if (distFromSeed <= effectiveRadius) {
        // Assign if valid
        if (validityCheck(tile) && canPlaceLIP(tile)) {
          tile.geologicalType = GeologicalType.IGNEOUS_PROVINCE;
          assignedCount++;
        }

        // Expand to neighbors within same plate
        const neighbors = getNeighborTilesInPlate(tile, tectonicSystem);
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            nextWave.push(neighbor);
          }
        }
      }
    }

    wave = nextWave;
  }

  return assignedCount;
}

/**
 * Represents a branch to be processed in the rift walk.
 */
interface RiftBranch {
  startTile: Tile;
  previousTile: Tile | null;
  maxLength: number;  // Maximum length for this branch in world units
}

/**
 * Creates a jagged rift LIP using random walk from a starting tile.
 * Uses length-based termination and supports branching.
 * Branches are processed iteratively using a queue (dynamic programming approach).
 */
function createRandomWalkRiftLIP(
  startTile: Tile,
  plate: Plate,
  lengthKm: number,
  widthKm: number,
  tectonicSystem: TectonicSystem,
  perlinNoise: PerlinNoise3D
): number {
  const maxWidth = kmToDistance(widthKm);
  const maxLength = kmToDistance(lengthKm);

  // All ridge tiles across main rift and all branches
  const ridgePath: Tile[] = [];
  const visitedRidge = new Set<Tile>();

  // Queue of branches to process (main rift is the first branch)
  const branchQueue: RiftBranch[] = [{
    startTile,
    previousTile: null,
    maxLength
  }];

  // Process all branches iteratively
  while (branchQueue.length > 0) {
    const branch = branchQueue.shift()!;
    let currentTile = branch.startTile;
    let previousTile = branch.previousTile;
    let distanceTraveled = 0;

    // Walk this branch until max length reached
    while (distanceTraveled < branch.maxLength) {
      // Add to ridge if not already visited
      if (!visitedRidge.has(currentTile)) {
        ridgePath.push(currentTile);
        visitedRidge.add(currentTile);
      }

      // Get neighbors within the same plate
      const neighbors = getNeighborTilesInSpecificPlate(currentTile, plate, tectonicSystem);
      if (neighbors.length === 0) break;

      // Filter out already visited tiles
      const unvisitedNeighbors = neighbors.filter(n => !visitedRidge.has(n));
      if (unvisitedNeighbors.length === 0) break;

      // Check for branch creation (only if we have enough remaining length)
      const remainingLength = branch.maxLength - distanceTraveled;
      if (unvisitedNeighbors.length > 1 && Math.random() < LIP_CONFIG.RIFT_BRANCH_PROBABILITY) {
        const branchLength = remainingLength * LIP_CONFIG.RIFT_BRANCH_LENGTH_FACTOR;
        if (branchLength > maxWidth) {  // Only branch if length is meaningful
          // Pick a random neighbor for the branch (different from main direction)
          const branchTile = unvisitedNeighbors[Math.floor(Math.random() * unvisitedNeighbors.length)];
          branchQueue.push({
            startTile: branchTile,
            previousTile: currentTile,
            maxLength: branchLength
          });
        }
      }

      // Select next tile for main walk
      let nextTile: Tile;

      if (previousTile && Math.random() > LIP_CONFIG.RIFT_TURN_PROBABILITY) {
        // Try to continue in same general direction
        const prevDir = new THREE.Vector3().subVectors(currentTile.centroid, previousTile.centroid).normalize();

        // Score neighbors by how well they continue the direction (with noise)
        let bestScore = -Infinity;
        nextTile = unvisitedNeighbors[0];

        for (const neighbor of unvisitedNeighbors) {
          const neighborDir = new THREE.Vector3().subVectors(neighbor.centroid, currentTile.centroid).normalize();
          const dotScore = prevDir.dot(neighborDir);
          const noiseJitter = (Math.random() - 0.5) * 0.5;
          const score = dotScore + noiseJitter;

          if (score > bestScore) {
            bestScore = score;
            nextTile = neighbor;
          }
        }
      } else {
        // Random turn - pick a random neighbor
        nextTile = unvisitedNeighbors[Math.floor(Math.random() * unvisitedNeighbors.length)];
      }

      // Update distance traveled
      const stepDist = currentTile.centroid.distanceTo(nextTile.centroid);
      distanceTraveled += stepDist;

      previousTile = currentTile;
      currentTile = nextTile;
    }
  }

  if (ridgePath.length === 0) return 0;

  // Now expand width from the ridge path
  const visited = new Set<Tile>();
  const tileDistFromRidge = new Map<Tile, number>();
  let assignedCount = 0;

  // Initialize ridge tiles
  for (const tile of ridgePath) {
    visited.add(tile);
    tileDistFromRidge.set(tile, 0);

    if (canPlaceLIP(tile)) {
      tile.geologicalType = GeologicalType.IGNEOUS_PROVINCE;
      assignedCount++;
    }
  }

  // BFS to expand width from ridge
  let wave = [...ridgePath];

  while (wave.length > 0) {
    const nextWave: Tile[] = [];

    for (const currentTile of wave) {
      const currentDist = tileDistFromRidge.get(currentTile) || 0;

      const neighbors = getNeighborTilesInSpecificPlate(currentTile, plate, tectonicSystem);
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;

        const stepDist = currentTile.centroid.distanceTo(neighbor.centroid);
        const neighborDist = currentDist + stepDist;

        // Sample noise for width variation
        const noiseValue = perlinNoise.fbm(
          neighbor.centroid.x * LIP_CONFIG.NOISE_SCALE,
          neighbor.centroid.y * LIP_CONFIG.NOISE_SCALE,
          neighbor.centroid.z * LIP_CONFIG.NOISE_SCALE,
          LIP_CONFIG.NOISE_OCTAVES
        );
        const normalizedNoise = (noiseValue + 1) / 2;
        const effectiveWidth = maxWidth * (0.3 + 0.7 * normalizedNoise);

        if (neighborDist > effectiveWidth) continue;

        visited.add(neighbor);
        tileDistFromRidge.set(neighbor, neighborDist);

        if (canPlaceLIP(neighbor)) {
          neighbor.geologicalType = GeologicalType.IGNEOUS_PROVINCE;
          assignedCount++;
        }

        nextWave.push(neighbor);
      }
    }

    wave = nextWave;
  }

  return assignedCount;
}

// ============================================================================
// LIP Assignment Functions
// ============================================================================

/**
 * Assigns a continental LIP on Shield/Platform.
 */
function assignContinentalLIP(tectonicSystem: TectonicSystem): number {
  const validTiles = getAllContinentalTiles(tectonicSystem);
  if (validTiles.length === 0) return 0;

  // Pick random seed tile
  const seedTile = validTiles[Math.floor(Math.random() * validTiles.length)];

  // Random radius
  const [minRadius, maxRadius] = LIP_CONFIG.CONTINENTAL_RADIUS_KM;
  const radiusKm = minRadius + Math.random() * (maxRadius - minRadius);

  // Create Perlin noise
  const seed = Math.floor(Math.random() * 100000);
  const perlinNoise = new PerlinNoise3D(seed);

  return createCircularLIP(seedTile, radiusKm, tectonicSystem, perlinNoise, isValidContinentalLIPTile);
}

/**
 * Computes the rift probability based on divergent intensity and boundary length.
 * Higher intensity and longer boundaries = higher probability of rift formation.
 *
 * @param intensity - The maximum divergent intensity at the boundary
 * @param boundaryLengthKm - The total length of divergent edges in km
 */
function computeRiftProbability(intensity: number, boundaryLengthKm: number): number {
  if (intensity <= 0 || boundaryLengthKm <= 0) return 0;

  const baseProbability = LIP_CONFIG.RIFT_BASE_PROBABILITY;
  const maxProbability = LIP_CONFIG.RIFT_MAX_PROBABILITY;

  // Compute intensity factor (0 to 1)
  const intensityThreshold = LIP_CONFIG.RIFT_INTENSITY_THRESHOLD;
  let intensityFactor: number;
  if (intensity < intensityThreshold) {
    intensityFactor = 0.5 * (intensity / intensityThreshold);
  } else {
    const normalizedIntensity = Math.min((intensity - intensityThreshold) / intensityThreshold, 1.0);
    intensityFactor = 0.5 + 0.5 * normalizedIntensity;
  }

  // Compute length factor (0 to 1)
  const lengthThreshold = LIP_CONFIG.RIFT_BOUNDARY_LENGTH_MIN_KM;
  const lengthMax = LIP_CONFIG.RIFT_BOUNDARY_LENGTH_MAX_KM;
  let lengthFactor: number;
  if (boundaryLengthKm < lengthThreshold) {
    lengthFactor = 0.5 * (boundaryLengthKm / lengthThreshold);
  } else {
    const normalizedLength = Math.min((boundaryLengthKm - lengthThreshold) / (lengthMax - lengthThreshold), 1.0);
    lengthFactor = 0.5 + 0.5 * normalizedLength;
  }

  // Combined factor: geometric mean of intensity and length factors
  // This ensures both need to be significant for high probability
  const combinedFactor = Math.sqrt(intensityFactor * lengthFactor);

  return baseProbability + (maxProbability - baseProbability) * combinedFactor;
}

/**
 * Attempts to assign a rift LIP at a continental divergent boundary.
 * Probability of creation depends on divergent intensity.
 * Rift only propagates into ONE of the two continental plates.
 *
 * Returns the number of tiles assigned, or 0 if no rift was created.
 */
function tryAssignRiftLIP(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem
): number {
  // Find the most intensive divergent point
  const intensivePoint = findMostIntensiveDivergentPoint(boundary, tectonicSystem);
  if (!intensivePoint) return 0;

  const { tileA, tileB, intensity } = intensivePoint;

  // Compute divergent boundary length
  const boundaryLengthKm = computeDivergentBoundaryLengthKm(boundary);

  // Compute probability based on intensity and boundary length
  const riftProbability = computeRiftProbability(intensity, boundaryLengthKm);

  // Roll for rift creation
  if (Math.random() > riftProbability) {
    return 0;  // No rift created
  }

  // Random dimensions
  const [minLength, maxLength] = LIP_CONFIG.RIFT_LENGTH_KM;
  const lengthKm = minLength + Math.random() * (maxLength - minLength);

  const [minWidth, maxWidth] = LIP_CONFIG.RIFT_WIDTH_KM;
  const widthKm = minWidth + Math.random() * (maxWidth - minWidth);

  // Create Perlin noise
  const seed = Math.floor(Math.random() * 100000);
  const perlinNoise = new PerlinNoise3D(seed);

  // Select ONE continental plate for the rift to propagate into
  const continentalTiles = [tileA, tileB].filter(t => t.plate.category === PlateCategory.CONTINENTAL);

  if (continentalTiles.length === 0) return 0;

  // Pick one randomly - rift only propagates into ONE plate
  const startTile = continentalTiles[Math.floor(Math.random() * continentalTiles.length)];

  return createRandomWalkRiftLIP(startTile, startTile.plate, lengthKm, widthKm, tectonicSystem, perlinNoise);
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Assigns Large Igneous Provinces (LIPs) to the tectonic system.
 *
 * Distribution:
 *   - Continental: 3-8 LIPs randomly placed on Shield/Platform (300-700 km radius)
 *   - Rift: Created at continental divergent boundaries based on divergent intensity
 *           (higher intensity = higher probability). Rifts propagate into ONE plate only.
 *   - Triple junctions: 50% chance at each junction with 2+ divergent boundaries (300-600 km radius)
 */
export function assignIgneousProvinces(tectonicSystem: TectonicSystem): void {
  let totalContinentalTiles = 0;
  let totalRiftTiles = 0;
  let totalTripleJunctionTiles = 0;
  let riftCount = 0;
  let tripleJunctionCount = 0;

  // Calculate continental LIP count
  const [minCount, maxCount] = LIP_CONFIG.CONTINENTAL_LIP_COUNT;
  const continentalCount = Math.floor(minCount + Math.random() * (maxCount - minCount + 1));

  // Assign continental LIPs
  for (let i = 0; i < continentalCount; i++) {
    totalContinentalTiles += assignContinentalLIP(tectonicSystem);
  }

  // Assign rift LIPs based on divergent boundary intensity
  // For each continental divergent boundary, probability depends on intensity
  const boundaries = getContContDivergentBoundaries(tectonicSystem);
  for (const boundary of boundaries) {
    const tilesAssigned = tryAssignRiftLIP(boundary, tectonicSystem);
    if (tilesAssigned > 0) {
      totalRiftTiles += tilesAssigned;
      riftCount++;
    }
  }

  // Assign triple junction LIPs (optional, based on probability)
  // Find all triple junctions with at least 2 divergent boundaries
  const tripleJunctions = findTripleJunctions(tectonicSystem);
  for (const junction of tripleJunctions) {
    if (Math.random() < LIP_CONFIG.TRIPLE_JUNCTION_PROBABILITY) {
      totalTripleJunctionTiles += assignTripleJunctionLIP(junction, tectonicSystem);
      tripleJunctionCount++;
    }
  }

  const totalTiles = totalContinentalTiles + totalRiftTiles + totalTripleJunctionTiles;
  const totalLIPs = continentalCount + riftCount + tripleJunctionCount;
  console.log(`Assigned ${totalLIPs} LIPs (${continentalCount} continental, ${riftCount} rift, ${tripleJunctionCount} triple junction) = ${totalTiles} tiles`);
  if (tripleJunctions.length > 0) {
    console.log(`  Found ${tripleJunctions.length} triple junctions with 2+ divergent boundaries`);
  }
  if (boundaries.length > 0) {
    console.log(`  Evaluated ${boundaries.length} continental divergent boundaries for rifts`);
  }
}
