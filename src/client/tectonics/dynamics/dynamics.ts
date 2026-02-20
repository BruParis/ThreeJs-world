import * as THREE from 'three';
import { BoundaryEdge, BoundaryType, ConvergentDominance, TransformSlide, Plate, PlateCategory, TectonicSystem, Tile } from '../data/Plate';

/**
 * Computes the net rotation vector of all plates in the tectonic system.
 * Net rotation = Σ(axis_i * ω_i * area_i)
 * Returns both the net rotation vector and the total area.
 */
function computeNetRotation(plates: Iterable<Plate>): { netRotation: THREE.Vector3; totalArea: number } {
  const netRotation = new THREE.Vector3(0, 0, 0);
  let totalArea = 0;

  for (const plate of plates) {
    const rotationVec = plate.rotationAxis.clone().multiplyScalar(plate.rotationSpeed * plate.area);
    netRotation.add(rotationVec);
    totalArea += plate.area;
  }

  return { netRotation, totalArea };
}

function computeTileMotionSpeed(tile: Tile): THREE.Vector3 {
  const plate = tile.plate;
  const tileCentroid = tile.centroid;

  // Compute move direction as cross product between
  // plate rotation axis and tile centroid
  const moveDir = new THREE.Vector3().crossVectors(plate.rotationAxis, tileCentroid).normalize();

  // Compute the distance of the tile from the rotation axis
  // (projection of the tile centroid onto the rotation axis)
  const distanceFromAxis = tileCentroid.clone().sub(
    plate.rotationAxis.clone().multiplyScalar(
      tileCentroid.dot(plate.rotationAxis)
    )
  ).length();

  // Compute move speed as proportional to rotation speed and distance from axis
  const speed = Math.abs(plate.rotationSpeed) * distanceFromAxis;

  return moveDir.multiplyScalar(speed);
}

function computeTectonicDynamics(tectonicSystem: TectonicSystem): void {

  // Ensure the plate centroids and areas are computed
  for (const plate of tectonicSystem.plates) {
    plate.updateCentroid();
    plate.computeArea();
  }

  // Randomly assign for each plate a rotation speed (-1, and 1)
  // and a rotation axis (random unit vector)
  for (const plate of tectonicSystem.plates) {
    const rotationSpeed = Math.random() * 2;

    const rotationAxis = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();

    plate.rotationAxis = rotationAxis;
    plate.rotationSpeed = rotationSpeed;
  }

  // Enforce zero net rotation:
  // Net rotation = Σ(axis_i * ω_i * area_i)
  // We subtract the area-weighted average from each plate's rotation vector
  const { netRotation, totalArea } = computeNetRotation(tectonicSystem.plates);

  if (totalArea > 0) {
    // Compute the average rotation vector (to be subtracted)
    const avgRotation = netRotation.divideScalar(totalArea);

    // Subtract from each plate's rotation vector and update axis/speed
    for (const plate of tectonicSystem.plates) {
      const rotationVec = plate.rotationAxis.clone().multiplyScalar(plate.rotationSpeed);
      const correctedVec = rotationVec.sub(avgRotation);

      const newSpeed = correctedVec.length();
      if (newSpeed > 1e-10) {
        plate.rotationAxis = correctedVec.normalize();
        plate.rotationSpeed = newSpeed;
      } else {
        // Plate effectively has no rotation after correction
        plate.rotationAxis = new THREE.Vector3(0, 1, 0);
        plate.rotationSpeed = 0;
      }
    }
  }

  // Compute motion vector for each tile
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      tile.motionVec = computeTileMotionSpeed(tile);
    }
  }

  // Compute motion statistics (deciles)
  computeMotionStatistics(tectonicSystem);
}

/**
 * Computes statistics about tile motion vector amplitudes.
 * Calculates min, max, mean, and deciles (10th, 20th, ..., 90th percentiles).
 */
function computeMotionStatistics(tectonicSystem: TectonicSystem): void {
  // Collect all motion amplitudes
  const amplitudes: number[] = [];
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      amplitudes.push(tile.motionVec.length());
    }
  }

  if (amplitudes.length === 0) {
    tectonicSystem.motionStatistics = null;
    return;
  }

  // Sort for percentile computation
  amplitudes.sort((a, b) => a - b);

  const n = amplitudes.length;
  const min = amplitudes[0];
  const max = amplitudes[n - 1];
  const mean = amplitudes.reduce((sum, val) => sum + val, 0) / n;

  // Compute deciles (10th, 20th, ..., 90th percentiles)
  const deciles: number[] = [];
  for (let p = 10; p <= 90; p += 10) {
    const index = Math.floor((p / 100) * n);
    deciles.push(amplitudes[Math.min(index, n - 1)]);
  }

  tectonicSystem.motionStatistics = { min, max, mean, deciles };

  console.log(`Motion statistics: min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}`);
  console.log(`Deciles: ${deciles.map(d => d.toFixed(4)).join(', ')}`);
}

/**
 * Classifies a boundary edge based on relative plate motion.
 *
 * Geologically, plate boundaries are classified by decomposing relative velocity
 * into components normal and tangential to the boundary:
 *
 * - CONVERGENT: Plates moving toward each other (negative normal component dominates)
 *   Examples: Subduction zones, collision zones
 *
 * - DIVERGENT: Plates moving away from each other (positive normal component dominates)
 *   Examples: Mid-ocean ridges, continental rifts
 *
 * - TRANSFORM: Plates sliding past each other (tangential component dominates)
 *   Examples: San Andreas Fault, Alpine Fault
 *
 * - INACTIVE: Negligible relative motion (magnitude below threshold)
 *   Examples: Stable plate interiors, locked faults
 *
 * The classification uses an obliquity angle approach:
 * - Pure convergent/divergent: motion perpendicular to boundary (0° or 180°)
 * - Pure transform: motion parallel to boundary (90°)
 * - Oblique boundaries: combination of both components
 *
 * Thresholds:
 * - INACTIVE_THRESHOLD: Minimum relative motion to be considered active
 * - OBLIQUITY_THRESHOLD: Angle threshold (in degrees) for pure convergent/divergent vs transform
 *   Motion within this angle of perpendicular = convergent/divergent
 *   Motion within this angle of parallel = transform
 *   Between these = oblique (classified by dominant component)
 */
function caracterizeBoundaryEdge(tectonicSystem: TectonicSystem, bEdge: BoundaryEdge): void {

  // Thresholds for classification
  // Relative motion below this is considered inactive (as fraction of max motion)
  const INACTIVE_THRESHOLD = 0.05;
  // Angle threshold in degrees for distinguishing boundary types
  // If angle from perpendicular < this, it's primarily convergent/divergent
  // If angle from parallel < this, it's primarily transform
  const OBLIQUITY_THRESHOLD_DEG = 30;
  const OBLIQUITY_THRESHOLD = Math.cos(OBLIQUITY_THRESHOLD_DEG * Math.PI / 180);

  const he = bEdge.halfedge;
  const twinHe = he.twin;

  const tile = tectonicSystem.edge2TileMap.get(he);
  const twinTile = tectonicSystem.edge2TileMap.get(twinHe);

  if (!tile || !twinTile) {
    console.warn("Could not find tiles for boundary halfedge", he.id);
    bEdge.rawType = BoundaryType.INACTIVE;
    return;
  }

  // Get edge midpoint on the sphere surface
  const edgeMidpoint = new THREE.Vector3()
    .addVectors(he.vertex.position, twinHe.vertex.position)
    .multiplyScalar(0.5)
    .normalize();

  // Compute tangent direction (along the boundary edge, projected onto sphere surface)
  const edgeVec = new THREE.Vector3().subVectors(twinHe.vertex.position, he.vertex.position);
  // Project onto tangent plane at midpoint to get proper spherical tangent
  const tangentDir = edgeVec.clone()
    .sub(edgeMidpoint.clone().multiplyScalar(edgeVec.dot(edgeMidpoint)))
    .normalize();

  // Compute normal direction (perpendicular to boundary, in tangent plane)
  // This points from tile toward twinTile
  const normalDir = new THREE.Vector3().crossVectors(edgeMidpoint, tangentDir).normalize();

  // Verify normal points from tile to twinTile (flip if needed)
  const tileToTwin = new THREE.Vector3().subVectors(twinTile.centroid, tile.centroid);
  if (normalDir.dot(tileToTwin) < 0) {
    normalDir.negate();
  }

  // Compute relative velocity: v_twinTile - v_tile
  // Positive normal component means plates moving apart (divergent)
  // Negative normal component means plates approaching (convergent)
  const relativeVelocity = new THREE.Vector3().subVectors(twinTile.motionVec, tile.motionVec);

  // Project relative velocity onto tangent plane at boundary
  const relVelProjected = relativeVelocity.clone()
    .sub(edgeMidpoint.clone().multiplyScalar(relativeVelocity.dot(edgeMidpoint)));

  const relVelMagnitude = relVelProjected.length();

  // Check for inactive boundary (negligible relative motion)
  const maxMotion = tectonicSystem.motionStatistics?.max ?? 1;
  if (relVelMagnitude < INACTIVE_THRESHOLD * maxMotion) {
    bEdge.rawType = BoundaryType.INACTIVE;
    return;
  }

  // Decompose relative velocity into normal and tangential components
  const normalComponent = relVelProjected.dot(normalDir);
  const tangentialComponent = relVelProjected.dot(tangentDir);

  // Use the ratio of components to determine boundary type
  // This is equivalent to computing the obliquity angle
  const absNormal = Math.abs(normalComponent);
  const absTangent = Math.abs(tangentialComponent);

  // Compute obliquity: ratio tells us the dominant motion direction
  // When absNormal >> absTangent: motion is perpendicular to boundary
  // When absTangent >> absNormal: motion is parallel to boundary

  if (absNormal > absTangent * OBLIQUITY_THRESHOLD) {
    // Normal component dominates - convergent or divergent
    if (normalComponent < 0) {
      // Plates approaching (twinTile moving toward tile relative to tile)
      bEdge.rawType = BoundaryType.CONVERGENT;
    } else {
      // Plates separating
      bEdge.rawType = BoundaryType.DIVERGENT;
    }
  } else if (absTangent > absNormal * OBLIQUITY_THRESHOLD) {
    // Tangential component dominates - transform
    bEdge.rawType = BoundaryType.TRANSFORM;
  } else {
    // Oblique boundary - classify by dominant component
    // In real tectonics, oblique boundaries are common (e.g., oblique subduction)
    // We classify by the larger component
    if (absNormal >= absTangent) {
      bEdge.rawType = normalComponent < 0 ? BoundaryType.CONVERGENT : BoundaryType.DIVERGENT;
    } else {
      bEdge.rawType = BoundaryType.TRANSFORM;
    }
  }
}

/**
 * Computes the convergent dominance for a boundary edge based on plate categories.
 *
 * Geological rules for subduction/collision:
 *
 * 1. OCEANIC vs CONTINENTAL:
 *    - Continental plate ALWAYS dominates (oceanic lithosphere is denser, subducts)
 *    - Creates volcanic arcs on continental side (Andes, Cascades)
 *
 * 2. OCEANIC vs OCEANIC:
 *    - Older oceanic crust is denser and subducts
 *    - Since we don't track age, use plate area as proxy (smaller plate subducts)
 *    - Creates island arcs (Japan, Philippines, Aleutians)
 *
 * 3. CONTINENTAL vs CONTINENTAL:
 *    - Neither subducts cleanly - too buoyant
 *    - Creates collision orogens affecting both plates (Himalayas, Alps)
 *    - Returns NEITHER - orogeny propagates into both plates
 *
 * 4. MICROPLATE interactions:
 *    - Microplates typically subduct under larger plates
 *    - Treated as less dominant than major plates
 *
 * 5. DEFORMATION zones:
 *    - Complex behavior, treated as UNDETERMINED
 *
 * @param tectonicSystem The tectonic system context
 * @param bEdge The boundary edge to compute dominance for
 */
function computeConvergentDominance(tectonicSystem: TectonicSystem, bEdge: BoundaryEdge): void {

  // Only compute for convergent boundaries
  if (bEdge.refinedType !== BoundaryType.CONVERGENT) {
    bEdge.dominance = ConvergentDominance.NOT_APPLICABLE;
    return;
  }

  const he = bEdge.halfedge;
  const tile = tectonicSystem.edge2TileMap.get(he);
  const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

  if (!tile || !twinTile) {
    console.warn("Could not find tiles for boundary halfedge", he.id);
    bEdge.dominance = ConvergentDominance.UNDETERMINED;
    return;
  }

  const thisCat = tile.plate.category;
  const twinCat = twinTile.plate.category;

  // Helper to determine dominance between two categories
  // Returns: 1 if thisPlate dominates, -1 if twinPlate dominates, 0 if neither
  const compareDominance = (cat1: PlateCategory, cat2: PlateCategory): number => {

    // Continental vs Oceanic: Continental always dominates
    if (cat1 === PlateCategory.CONTINENTAL && cat2 === PlateCategory.OCEANIC) {
      return 1;
    }
    if (cat1 === PlateCategory.OCEANIC && cat2 === PlateCategory.CONTINENTAL) {
      return -1;
    }

    // Continental vs Continental: Neither dominates (collision)
    if (cat1 === PlateCategory.CONTINENTAL && cat2 === PlateCategory.CONTINENTAL) {
      return 0;
    }

    // Oceanic vs Oceanic: Neither dominates
    // In reality, the older/denser plate subducts, but without age tracking
    // we treat this as a symmetric case where orogeny can propagate to both sides
    if (cat1 === PlateCategory.OCEANIC && cat2 === PlateCategory.OCEANIC) {
      return 0; // Neither dominates - orogeny propagates to both plates
    }

    // Microplate interactions
    if (cat1 === PlateCategory.MICROPLATE) {
      if (cat2 === PlateCategory.CONTINENTAL || cat2 === PlateCategory.OCEANIC) {
        return -1; // Microplate subducts under major plates
      }
    }
    if (cat2 === PlateCategory.MICROPLATE) {
      if (cat1 === PlateCategory.CONTINENTAL || cat1 === PlateCategory.OCEANIC) {
        return 1; // Major plate dominates over microplate
      }
    }

    // Microplate vs Microplate: use area
    if (cat1 === PlateCategory.MICROPLATE && cat2 === PlateCategory.MICROPLATE) {
      const area1 = tile.plate.area;
      const area2 = twinTile.plate.area;
      if (area1 > area2 * 1.2) return 1;
      if (area2 > area1 * 1.2) return -1;
      return 0;
    }

    // Deformation zones - complex, undetermined
    if (cat1 === PlateCategory.DEFORMATION || cat2 === PlateCategory.DEFORMATION) {
      return 0;
    }

    // Unknown categories
    return 0;
  };

  const dominanceResult = compareDominance(thisCat, twinCat);

  if (dominanceResult > 0) {
    bEdge.dominance = ConvergentDominance.THIS_SIDE;
  } else if (dominanceResult < 0) {
    bEdge.dominance = ConvergentDominance.TWIN_SIDE;
  } else {
    bEdge.dominance = ConvergentDominance.NEITHER;
  }
}

/**
 * Computes the transform slide directions for a boundary edge.
 *
 * For transform boundaries, each plate slides past the other. The slide direction
 * is determined by the tangential component of each plate's motion relative to the edge:
 * - FORWARD: Plate is moving in the direction of the edge vector (vertex -> twin.vertex)
 * - BACKWARD: Plate is moving opposite to the edge vector
 *
 * This information is used to visualize the relative motion with arrows parallel to the edge.
 *
 * @param tectonicSystem The tectonic system context
 * @param bEdge The boundary edge to compute slide directions for
 */
function computeTransformSlide(tectonicSystem: TectonicSystem, bEdge: BoundaryEdge): void {
  // Only compute for transform boundaries
  if (bEdge.refinedType !== BoundaryType.TRANSFORM) {
    bEdge.thisSideSlide = TransformSlide.NOT_APPLICABLE;
    bEdge.twinSideSlide = TransformSlide.NOT_APPLICABLE;
    return;
  }

  const he = bEdge.halfedge;
  const tile = tectonicSystem.edge2TileMap.get(he);
  const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

  if (!tile || !twinTile) {
    console.warn("Could not find tiles for boundary halfedge", he.id);
    bEdge.thisSideSlide = TransformSlide.UNDETERMINED;
    bEdge.twinSideSlide = TransformSlide.UNDETERMINED;
    return;
  }

  // Get edge midpoint on the sphere surface
  const edgeMidpoint = new THREE.Vector3()
    .addVectors(he.vertex.position, he.twin.vertex.position)
    .multiplyScalar(0.5)
    .normalize();

  // Compute edge direction (tangent to sphere at midpoint)
  // This is the direction from vertex to twin.vertex
  const edgeVec = new THREE.Vector3().subVectors(he.twin.vertex.position, he.vertex.position);
  const edgeDir = edgeVec.clone()
    .sub(edgeMidpoint.clone().multiplyScalar(edgeVec.dot(edgeMidpoint)))
    .normalize();

  // Project each tile's motion onto the edge direction (tangential component)
  // Positive = moving in edge direction (FORWARD)
  // Negative = moving opposite to edge direction (BACKWARD)

  // This side's motion projected onto tangent plane at midpoint
  const thisSideMotion = tile.motionVec.clone()
    .sub(edgeMidpoint.clone().multiplyScalar(tile.motionVec.dot(edgeMidpoint)));
  const thisSideTangent = thisSideMotion.dot(edgeDir);

  // Twin side's motion projected onto tangent plane at midpoint
  const twinSideMotion = twinTile.motionVec.clone()
    .sub(edgeMidpoint.clone().multiplyScalar(twinTile.motionVec.dot(edgeMidpoint)));
  const twinSideTangent = twinSideMotion.dot(edgeDir);

  // Determine slide directions
  // Use a small threshold to avoid noise
  const threshold = 0.0001;

  if (thisSideTangent > threshold) {
    bEdge.thisSideSlide = TransformSlide.FORWARD;
  } else if (thisSideTangent < -threshold) {
    bEdge.thisSideSlide = TransformSlide.BACKWARD;
  } else {
    // Very small motion - default to forward (arbitrary choice)
    bEdge.thisSideSlide = TransformSlide.FORWARD;
  }

  if (twinSideTangent > threshold) {
    bEdge.twinSideSlide = TransformSlide.FORWARD;
  } else if (twinSideTangent < -threshold) {
    bEdge.twinSideSlide = TransformSlide.BACKWARD;
  } else {
    bEdge.twinSideSlide = TransformSlide.FORWARD;
  }
}

export {
  computeNetRotation,
  computeTectonicDynamics,
  caracterizeBoundaryEdge,
  computeConvergentDominance,
  computeTransformSlide
};
