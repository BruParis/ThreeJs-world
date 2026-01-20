import { Halfedge } from '@core/Halfedge';
import { Tile, Plate, TectonicSystem } from './Plate';

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

export {
  floodFill,
  plateAbsorbedByPlate,
  splitPlateFromTile,
  transferTileToPlate,
};
