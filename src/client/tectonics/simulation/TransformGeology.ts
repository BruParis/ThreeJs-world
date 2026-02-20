import * as THREE from 'three';
import { Tile, BoundaryType, GeologicalType, TectonicSystem, PlateBoundary, BoundaryEdge } from '../data/Plate';

// ============================================================================
// Transform Boundary Geological Types
// ============================================================================
//
// Transform boundaries create pull-apart basins at releasing bends:
// - Form where the fault bends or steps and the geometry opens up a gap
// - Localized extension and subsidence
// - Examples: Dead Sea, Salton Sea trough, Sea of Marmara
// - Assigned where local boundary direction shifts (20-30% of transform tiles)
//
// ============================================================================

// ============================================================================
// Configuration
// ============================================================================

const TRANSFORM_GEOLOGY_CONFIG = {
  // Probability of assigning basin at releasing bends
  BASIN_PROBABILITY: 0.25,  // 25% (within 20-30% range from doc)

  // Minimum angle change (in radians) to consider a "bend"
  // About 15 degrees - noticeable direction shift
  MIN_BEND_ANGLE: Math.PI / 12,

  // Boost probability when bend angle is larger
  // Linear interpolation from base probability to this factor * base probability
  // at 90 degree bends
  MAX_BEND_ANGLE: Math.PI / 2,  // 90 degrees
  LARGE_BEND_PROBABILITY_BOOST: 2.0,  // Double the probability at 90 degree bends
};

// ============================================================================
// Bend Detection
// ============================================================================

/**
 * Computes the direction vector of a boundary edge (tangent to boundary).
 * Returns a normalized vector in the tangent plane at the edge midpoint.
 */
function computeEdgeDirection(bEdge: BoundaryEdge): THREE.Vector3 {
  const he = bEdge.halfedge;
  const edgeVec = new THREE.Vector3().subVectors(
    he.twin.vertex.position,
    he.vertex.position
  );

  // Get edge midpoint on sphere
  const midpoint = new THREE.Vector3()
    .addVectors(he.vertex.position, he.twin.vertex.position)
    .multiplyScalar(0.5)
    .normalize();

  // Project onto tangent plane and normalize
  return edgeVec.clone()
    .sub(midpoint.clone().multiplyScalar(edgeVec.dot(midpoint)))
    .normalize();
}

/**
 * Computes the angle between two edge directions.
 * Returns angle in radians [0, PI].
 */
function angleBetweenEdges(dir1: THREE.Vector3, dir2: THREE.Vector3): number {
  // Clamp dot product to handle numerical precision issues
  const dot = Math.max(-1, Math.min(1, dir1.dot(dir2)));
  return Math.acos(Math.abs(dot));  // Use abs to handle opposite directions
}

/**
 * Determines if a bend is "releasing" (transtensional).
 *
 * At a bend in a transform fault:
 * - Releasing bend: The fault geometry opens up, creating extension
 *
 * We determine this by looking at whether the relative plate motion
 * at the bend point would cause the crust to pull apart.
 */
function isReleasingBend(
  prevEdge: BoundaryEdge,
  currentEdge: BoundaryEdge,
  tectonicSystem: TectonicSystem
): boolean {
  const he = currentEdge.halfedge;

  // Get tiles on both sides of the current edge
  const tile = tectonicSystem.edge2TileMap.get(he);
  const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

  if (!tile || !twinTile) {
    return false;
  }

  // Get edge midpoint on sphere
  const midpoint = new THREE.Vector3()
    .addVectors(he.vertex.position, he.twin.vertex.position)
    .multiplyScalar(0.5)
    .normalize();

  // Compute tangent direction along boundary
  const tangentDir = computeEdgeDirection(currentEdge);

  // Compute direction change from previous edge to current
  const prevDir = computeEdgeDirection(prevEdge);
  const currentDir = computeEdgeDirection(currentEdge);

  // Cross product tells us which way the boundary is curving
  const curveCross = new THREE.Vector3().crossVectors(prevDir, currentDir);
  const curveSign = curveCross.dot(midpoint);

  // Compute relative velocity between plates
  const relativeVelocity = new THREE.Vector3().subVectors(twinTile.motionVec, tile.motionVec);

  // Get tangential component of relative motion
  const tangentialComponent = relativeVelocity.dot(tangentDir);

  // If slip direction and curve direction align: releasing (pull-apart)
  const interaction = curveSign * tangentialComponent;

  return interaction > 0.001;
}

/**
 * Computes a probability boost based on bend angle.
 * Larger bends are more likely to produce geological features.
 */
function computeBendProbabilityFactor(bendAngle: number): number {
  const { MIN_BEND_ANGLE, MAX_BEND_ANGLE, LARGE_BEND_PROBABILITY_BOOST } = TRANSFORM_GEOLOGY_CONFIG;

  if (bendAngle < MIN_BEND_ANGLE) {
    return 0;  // Below threshold, no feature
  }

  // Linear interpolation from 1.0 at min angle to boost at max angle
  const t = Math.min(1, (bendAngle - MIN_BEND_ANGLE) / (MAX_BEND_ANGLE - MIN_BEND_ANGLE));
  return 1.0 + t * (LARGE_BEND_PROBABILITY_BOOST - 1.0);
}

// ============================================================================
// Transform Boundary Edge Collection
// ============================================================================

/**
 * Collects transform boundary edges from a boundary, ordered along the boundary.
 * Returns edges grouped by connected segments.
 */
function collectTransformEdgeSegments(boundary: PlateBoundary): BoundaryEdge[][] {
  const segments: BoundaryEdge[][] = [];
  let currentSegment: BoundaryEdge[] = [];

  for (const bEdge of boundary.boundaryEdges) {
    if (bEdge.refinedType === BoundaryType.TRANSFORM) {
      currentSegment.push(bEdge);
    } else {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

// ============================================================================
// Geological Type Assignment
// ============================================================================

/**
 * Assigns basins to tiles along a transform boundary segment at releasing bends.
 */
function assignBasinsToTransformSegment(
  segment: BoundaryEdge[],
  tectonicSystem: TectonicSystem,
  assignedTiles: Set<Tile>
): number {
  let basins = 0;

  if (segment.length < 2) {
    return basins;
  }

  for (let i = 1; i < segment.length; i++) {
    const prevEdge = segment[i - 1];
    const currentEdge = segment[i];

    // Compute angle between edges
    const prevDir = computeEdgeDirection(prevEdge);
    const currentDir = computeEdgeDirection(currentEdge);
    const bendAngle = angleBetweenEdges(prevDir, currentDir);

    // Check if bend is significant enough
    if (bendAngle < TRANSFORM_GEOLOGY_CONFIG.MIN_BEND_ANGLE) {
      continue;
    }

    // Only assign basins at releasing bends
    if (!isReleasingBend(prevEdge, currentEdge, tectonicSystem)) {
      continue;
    }

    // Compute probability factor based on bend angle
    const probabilityFactor = computeBendProbabilityFactor(bendAngle);

    // Get tiles at this edge
    const he = currentEdge.halfedge;
    const tile = tectonicSystem.edge2TileMap.get(he);
    const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

    const tilesToProcess = [tile, twinTile].filter(t => t !== undefined) as Tile[];

    for (const t of tilesToProcess) {
      if (assignedTiles.has(t)) {
        continue;
      }

      if (t.geologicalType !== GeologicalType.UNKNOWN) {
        continue;
      }

      const probability = TRANSFORM_GEOLOGY_CONFIG.BASIN_PROBABILITY * probabilityFactor;
      if (Math.random() < probability) {
        t.geologicalType = GeologicalType.BASIN;
        assignedTiles.add(t);
        basins++;
      }
    }
  }

  return basins;
}

/**
 * Assigns basins along a single boundary's transform segments.
 */
function assignBasinsAtTransformBoundary(
  boundary: PlateBoundary,
  tectonicSystem: TectonicSystem,
  assignedTiles: Set<Tile>
): number {
  let totalBasins = 0;

  const segments = collectTransformEdgeSegments(boundary);

  for (const segment of segments) {
    totalBasins += assignBasinsToTransformSegment(segment, tectonicSystem, assignedTiles);
  }

  return totalBasins;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Assigns geological types along transform boundaries.
 *
 * Transform boundaries create pull-apart basins at releasing bends (20-30% probability).
 *
 * This function should be called after basic boundary characterization
 * but before shield/platform assignment (so it doesn't overwrite features).
 */
export function assignTransformGeology(tectonicSystem: TectonicSystem): void {
  const assignedTiles = new Set<Tile>();
  let totalBasins = 0;

  for (const boundary of tectonicSystem.boundaries) {
    let hasTransform = false;
    for (const bEdge of boundary.boundaryEdges) {
      if (bEdge.refinedType === BoundaryType.TRANSFORM) {
        hasTransform = true;
        break;
      }
    }

    if (!hasTransform) {
      continue;
    }

    totalBasins += assignBasinsAtTransformBoundary(boundary, tectonicSystem, assignedTiles);
  }

  console.log(`Assigned transform geology: ${totalBasins} BASIN (pull-apart)`);
}
