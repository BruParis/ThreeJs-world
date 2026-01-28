import * as THREE from 'three';
import { BoundaryEdge, BoundaryType, Plate, TectonicSystem, Tile } from '../data/Plate';

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

function caracterizeBoundaryEdge(tectonicSystem: TectonicSystem, bEdge: BoundaryEdge): void {

  const he = bEdge.halfedge;
  const twinHe = he.twin;

  const vertexPos = he.vertex.position;
  const twinVertexPos = twinHe.vertex.position;

  const edgeNormVec = new THREE.Vector3().subVectors(twinVertexPos, vertexPos).normalize();

  const tile = tectonicSystem.edge2TileMap.get(he);
  const twinTile = tectonicSystem.edge2TileMap.get(twinHe);

  if (!tile || !twinTile) {
    console.warn("Could not find tiles for boundary halfedge", he.id);
    return;
  }

  const tileCentroid = tile.centroid;
  const twinTileCentroid = twinTile.centroid;

  const twinToTileNormVec = new THREE.Vector3().subVectors(twinTileCentroid, tileCentroid).normalize();

  const planeNormal = new THREE.Vector3().crossVectors(edgeNormVec, twinToTileNormVec).normalize();

  const tileMotionVec = tile.motionVec.clone();
  const twinTileMotionVec = twinTile.motionVec.clone();

  // Project both move speeds onto the plane defined by the normal vec 
  // (edgeNormVec cross tilesNormVec)
  const tileMotionVecProj = tileMotionVec.clone().projectOnPlane(planeNormal);
  const twinTileMoveSpeedProj = twinTileMotionVec.clone().projectOnPlane(planeNormal);

  const relativeMotionVec = twinTileMoveSpeedProj.clone().sub(tileMotionVecProj);
  const relativeMotionNormVec = relativeMotionVec.clone().normalize();

  // Dot product between relative motion of twin tile and the twin2Tile vector
  // tells us if tile are moving toward (>0) or away from (<0) each other
  const relMotionDot = relativeMotionNormVec.dot(twinToTileNormVec);

  // Dot product with edge direction tells us about transform motion
  const edgeAlignmentDot = relativeMotionNormVec.dot(edgeNormVec);

  // Dot product of both motion vectors tells us if they are moving in the same direction
  const motionVecDot = tileMotionVec.dot(twinTileMotionVec);

  // Determine boundary type based on dot products
  if (Math.abs(relMotionDot) > Math.abs(edgeAlignmentDot)) {
    // Motion is primarily toward/away from each other
    if (relMotionDot < 0) {
      bEdge.rawType = BoundaryType.CONVERGENT;
    } else {
      bEdge.rawType = BoundaryType.DIVERGENT;
    }
  } else if (motionVecDot < 0) {
    // Motion is primarily along the edge
    bEdge.rawType = BoundaryType.TRANSFORM;
  } else {
    bEdge.rawType = BoundaryType.INACTIVE;
  }
}

export {
  computeNetRotation,
  computeTectonicDynamics,
  caracterizeBoundaryEdge
};
