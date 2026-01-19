import * as THREE from 'three';
import { Vertex } from '@core/Vertex';
import { Halfedge } from '@core/Halfedge';
import { Tile, Plate, BoundaryEdge, BoundaryType, TectonicSystem } from './Plate';

function floodFill(seeds: Halfedge[], selectedSet: Set<Halfedge>): Plate[] {

  // All new halfedge corresponds to a new plate (Set<Halfedge> -> Plate)
  const plates: Plate[] = seeds.map(he => new Plate(he));

  const plateUnclaimedBorderEdgeMap = new Map<number, Set<Halfedge>>();
  for (const plate of plates) {
    plateUnclaimedBorderEdgeMap.set(plate.id, new Set<Halfedge>(plate.borderEdge2TileMap.keys()));
  }

  const kPlates = Math.ceil(plates.length / 3);
  do {
    // Order plates by decreasing ratio of unclaimed border edges
    // -> select the top-k plates
    // (Plates with less unclaimed border edges will likely sample
    // frequently the same border halfedges, resulting in intertwined pattern of plates)
    // + it adds more variability in the process
    const sortedPlates = plates.sort((a, b) => {
      const aUnclaimedSize = plateUnclaimedBorderEdgeMap.get(a.id)?.size || 0;
      const bUnclaimedSize = plateUnclaimedBorderEdgeMap.get(b.id)?.size || 0;
      const aRatio = aUnclaimedSize / a.tiles.size;
      const bRatio = bUnclaimedSize / b.tiles.size;
      return bRatio - aRatio;
    });
    const topkPlates = sortedPlates.slice(0, kPlates);

    for (const plate of topkPlates) {
      const unclaimedBorderEdges = plateUnclaimedBorderEdgeMap.get(plate.id);
      if (!unclaimedBorderEdges || unclaimedBorderEdges.size === 0) {
        continue;
      }

      // Select a random border halfedge
      // Inefficient since this requires converting the set to an array
      const randomIndex = Math.floor(Math.random() * unclaimedBorderEdges.size);
      const borderEdges = Array.from(unclaimedBorderEdges);
      const borderHe = borderEdges[randomIndex];
      const twinHe = borderHe.twin;

      if (selectedSet.has(twinHe)) {
        // Already claimed by another plate
        unclaimedBorderEdges.delete(borderHe);
        continue;
      }

      // Claim the tile
      const tile = plate.addTileFromEdge(twinHe);
      if (!tile) {
        // Tile was already present in the plate
        console.log("Tile was already present in the plate", plate.id);
        unclaimedBorderEdges.delete(borderHe);
        continue;
      }

      // update selectedSet
      for (const he of tile.loop()) {
        selectedSet.add(he);
      }

      // update unclaimedBorderEdges from this tile
      // twin halfedges not already belonging to any plate
      for (const he of tile.loop()) {
        const twin = he.twin;

        if (selectedSet.has(twin)) {
          // already claimed
          continue;
        }

        unclaimedBorderEdges.add(he);
      }
    }

  } while (Array.from(plateUnclaimedBorderEdgeMap.values()).some(set => set.size > 0));

  return plates;
}


function plateAbsorbedByPlate(plateToAbsorb: Plate, targetPlate: Plate): void {

  const tectonicSystem = plateToAbsorb.system;

  // for all the toAbsorb border edges,
  // 1) if the twin is in the old target border edges, 
  //    remove it from old target border edges
  // 2) else, add the toAbsorb border edge to the new target border edges
  for (const he of plateToAbsorb.borderEdge2TileMap.keys()) {
    const twinHe = he.twin;
    if (targetPlate.borderEdge2TileMap.has(twinHe)) {
      targetPlate.borderEdge2TileMap.delete(twinHe);
      continue;
    }

    const auxTile = tectonicSystem.edge2TileMap.get(he);
    if (!auxTile) {
      console.error("Inconsistent state during plate absorption: halfedge not found in edge2TileMap.");
      continue;
    }

    targetPlate.borderEdge2TileMap.set(he, auxTile);
  }

  // transfer tiles from plateToAbsorb to targetPlate
  for (const tile of plateToAbsorb.tiles) {
    targetPlate.tiles.add(tile);
    tile.plate = targetPlate;
    plateToAbsorb.tiles.delete(tile);
  }

  tectonicSystem.removePlate(plateToAbsorb);
}

function transferTileToPlate(tile: Tile, targetPlate: Plate): void {

  // Preconditions:
  // 1) The tile should have at least one twin edge belonging to the target plate
  let hasTwinInTargetPlate = false;

  for (const he of tile.loop()) {
    const twinHe = he.twin;
    if (targetPlate.borderEdge2TileMap.has(twinHe)) {
      hasTwinInTargetPlate = true;
      break;
    }
  }

  if (!hasTwinInTargetPlate) {
    console.warn("Tile cannot be transferred to target plate: no twin edges belong to the target plate.");
    return;
  }

  // 2) It should not cut the current plate in two (not a bridge tile)
  if (tile.isABridge()) {
    console.warn("Tile cannot be transferred to target plate: it is a bridge tile.");
    return;
  }

  const currentPlate = tile.plate;
  const system = currentPlate.system;

  // remove tile from current plate
  // -> delete from set
  currentPlate.tiles.delete(tile);
  // -> remove the tile border edges from borderEdge2TileMap
  for (const he of tile.loop()) {
    currentPlate.borderEdge2TileMap.delete(he);
  }
  //    .. and add the nonborder edges twin to borderEdge2TileMap
  for (const he of tile.loop()) {

    const twinHe = he.twin;
    const twinTile = system.edge2TileMap.get(twinHe);

    if (!twinTile) {
      console.error("Inconsistent state during tile transfer: twin halfedge not found in borderEdge2TileMap.");
      continue;
    }

    if (twinTile.plate !== currentPlate) {
      continue;
    }

    currentPlate.borderEdge2TileMap.set(twinHe, twinTile);
  }

  // if the current plate has no more tiles, remove it from the system
  if (currentPlate.tiles.size === 0) {
    system.removePlate(currentPlate);
  }

  // add the tile to target plate
  // -> add to set
  targetPlate.tiles.add(tile);

  // -> remove the tile nonborder edges twin from borderEdge2TileMap
  for (const he of tile.loop()) {
    const twinHe = he.twin;
    targetPlate.borderEdge2TileMap.delete(twinHe);
  }

  //   ... and add the border edges to borderEdge2TileMap
  //   if their twin tile is not in the target plate
  for (const he of tile.loop()) {
    const twinHe = he.twin;
    const twinTile = system.edge2TileMap.get(twinHe);
    if (!twinTile) {
      console.error("Inconsistent state during tile transfer: twin halfedge not found in borderEdge2TileMap.");
      continue;
    }

    const twinTilePlate = twinTile.plate;
    if (twinTilePlate === targetPlate) {
      continue;
    }

    targetPlate.borderEdge2TileMap.set(he, tile);
  }

  // update tile plate reference
  tile.plate = targetPlate;

}

function splitPlateFromTile(tectonicSystem: TectonicSystem, tile: Tile): void {
  const currentPlate = tile.plate;

  // Take the Full edge2TileMap as base
  const edgesSet = Array.from(tectonicSystem.edge2TileMap.keys());

  // collect edges for each tile of the old plate in a set
  // to subtract selectedSet from
  const auxSelectedSet = new Set<Halfedge>(edgesSet);
  currentPlate.tiles.forEach(t => {
    for (const he of t.loop()) {
      auxSelectedSet.delete(he);
    }
  });

  // select 2 seeds from the old plate edges, both belonging
  // to the current plate (do not take as seed a border edge)
  const auxSeeds: Halfedge[] = [];
  for (const he of tile.loop()) {
    const twinHe = he.twin;

    if (currentPlate.borderEdge2TileMap.has(he)) {
      continue;
    }

    if (!currentPlate.borderEdge2TileMap.has(twinHe)) {
      auxSeeds.push(twinHe);
      auxSeeds.push(he);
      break;
    }
  }

  if (auxSeeds.length < 2) {
    console.warn("Could not find suitable seeds to split the plate at the given tile.");
    return;
  }

  // At this point: the split is valid, remove the current plate and
  // proceed with flood fill from the 2 seeds
  tectonicSystem.removePlate(currentPlate);

  for (const seed of auxSeeds) {
    // Mark all halfedges in the loop as selected
    for (const auxHe of seed.nextLoop()) {
      auxSelectedSet.add(auxHe);
    }
  }

  const newPlates = floodFill(auxSeeds, auxSelectedSet);
  newPlates.forEach(plate => tectonicSystem.plates.add(plate));

  tectonicSystem.update();
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

  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {

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

      // Apply the movement to the tile
      tile.motionSpeed = moveDir.multiplyScalar(speed);
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

  const tileMotionSpeed = tile.motionSpeed.clone();
  const twinTileMotionSpeed = twinTile.motionSpeed.clone();

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

  const motionIsDominantAlongBoundary = speedAlongBoundary > speedAcrossBoundary;

  const motionIsApart = angleRelativeMotion2EdgeDeg > 90;
  const motionIsPureShear = Math.abs(angleRelativeMotion2EdgeDeg - 90) < 10;

  bEdge.relativeMotionSpeed = relativeMotionSpeed;

  if (motionIsNegligible) {
    bEdge.type = BoundaryType.INACTIVE;
  }

  if (motionIsPureShear) {
    bEdge.type = BoundaryType.TRANSFORM;
  }

  if (motionIsDominantAlongBoundary) {
    if (motionIsApart) {
      bEdge.type = BoundaryType.OBLIQUE_DIVERGENT;
    } else {
      bEdge.type = BoundaryType.OBLIQUE_CONVERGENT;
    }
  }

  // if motion is not dominant along boundary, and it is not negligible nor pure shear
  // ... then it is dominant across boundary
  if (motionIsApart) {
    bEdge.type = BoundaryType.DIVERGENT;
  } else {
    bEdge.type = BoundaryType.CONVERGENT;
  }
}



export {
  floodFill,
  plateAbsorbedByPlate,
  splitPlateFromTile,
  transferTileToPlate,
  computeTectonicDynamics,
  caracterizeBoundaryEdge
};
