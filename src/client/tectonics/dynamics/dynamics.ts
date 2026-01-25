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

  const tilesNormVec = new THREE.Vector3().subVectors(twinTileCentroid, tileCentroid).normalize();

  const planeNormal = new THREE.Vector3().crossVectors(edgeNormVec, tilesNormVec).normalize();

  const tileMotionSpeed = tile.motionVec.clone();
  const twinTileMotionSpeed = twinTile.motionVec.clone();

  // Project both move speeds onto the edge plane, formed
  // by edgeNormVec and tilesNormVec
  const tileMotionSpeedProj = tileMotionSpeed.clone().projectOnPlane(planeNormal);
  const twinTileMoveSpeedProj = twinTileMotionSpeed.clone().projectOnPlane(planeNormal);

  const relativeMotionSpeed = twinTileMoveSpeedProj.clone().sub(tileMotionSpeedProj);

  const angleRelativeMotion2EdgeRad = relativeMotionSpeed.angleTo(edgeNormVec);
  const angleRelativeMotion2EdgeDeg = THREE.MathUtils.radToDeg(angleRelativeMotion2EdgeRad);

  const motionRelative2Edge = relativeMotionSpeed.clone().projectOnVector(edgeNormVec);
  const motionTile2TwinTile = relativeMotionSpeed.clone().projectOnVector(tilesNormVec);

  const speedAlongBoundary = motionRelative2Edge.length();
  const speedAcrossBoundary = motionTile2TwinTile.length();

  const motionAlongIsNegligible = speedAlongBoundary < speedThreshold;
  const motionAcrossIsNegligible = speedAcrossBoundary < speedThreshold;
  const motionIsNegligible = motionAlongIsNegligible && motionAcrossIsNegligible;

  const motionIsApart = angleRelativeMotion2EdgeDeg > 90;
  const motionIsPureShear = Math.abs(angleRelativeMotion2EdgeDeg - 90) < 10;

  if (motionIsNegligible) {
    bEdge.type = BoundaryType.INACTIVE;
  }

  if (motionIsPureShear) {
    bEdge.type = BoundaryType.TRANSFORM;
  } else if (motionIsApart) {
    bEdge.type = BoundaryType.DIVERGENT;
  } else {
    bEdge.type = BoundaryType.CONVERGENT;
  }
}

export {
  computeTectonicDynamics,
  caracterizeBoundaryEdge
};
