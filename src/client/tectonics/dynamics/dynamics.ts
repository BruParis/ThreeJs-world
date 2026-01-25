import * as THREE from 'three';
import { BoundaryEdge, BoundaryType, TectonicSystem, Tile } from '../data/Plate';

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

  // Ensure the plate centroids are computed
  for (const plate of tectonicSystem.plates) {
    plate.updateCentroid();
  }

  // Randomly assign for each plate a rotation speed (-1, and 1)
  // and a rotation axis (random unit vector)
  for (const plate of tectonicSystem.plates) {
    const rotationSpeed = Math.random() * 2 - 1; // (-1, 1)

    const rotationAxis = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();


    plate.rotationAxis = rotationAxis;
    plate.rotationSpeed = rotationSpeed;
  }

  // Compute motion vector for each tile
  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      tile.motionVec = computeTileMotionSpeed(tile);
    }
  }
}

function caracterizeBoundaryEdge(tectonicSystem: TectonicSystem, bEdge: BoundaryEdge): void {
  const speedThreshold = 0.01;

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

  // normalize both
  const tileMotionVecProjNorm = tileMotionVecProj.clone().normalize();
  const twinTileMoveSpeedProjNorm = twinTileMoveSpeedProj.clone().normalize();

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
      bEdge.type = BoundaryType.CONVERGENT;
    } else {
      bEdge.type = BoundaryType.DIVERGENT;
    }
  } else if (motionVecDot < 0) {
    // Motion is primarily along the edge
    bEdge.type = BoundaryType.TRANSFORM;
  } else {
    bEdge.type = BoundaryType.INACTIVE;
  }
}

export {
  computeTectonicDynamics,
  caracterizeBoundaryEdge
};
