import { Halfedge } from '@core/Halfedge';
import { HalfedgeGraph } from '@core/HalfedgeGraph';
import { Tile, Plate, TectonicSystem, PlateBoundary, BoundaryEdge, BoundaryType } from './Plate';

/**
 * Builds all tiles from a halfedge graph.
 * Each unique face loop in the graph becomes a Tile.
 * @param halfedgeGraph The halfedge graph representing the dual mesh
 * @returns A Map from Halfedge to its containing Tile
 */
function buildAllTiles(halfedgeGraph: HalfedgeGraph): Map<Halfedge, Tile> {
  const edge2TileMap = new Map<Halfedge, Tile>();
  const processedEdges = new Set<Halfedge>();

  for (const he of halfedgeGraph.halfedges.values()) {
    if (processedEdges.has(he)) {
      continue;
    }

    // Create a tile for this face loop (without plate assignment)
    const tile = new Tile(he);

    // Mark all halfedges in this loop and map them to the tile
    for (const loopHe of tile.loop()) {
      processedEdges.add(loopHe);
      edge2TileMap.set(loopHe, tile);
    }
  }

  console.log(`Built ${edge2TileMap.size / 6} tiles from halfedge graph`); // Approximate: assumes hexagonal tiles on average
  return edge2TileMap;
}

/**
 * Performs flood fill starting from seed tiles to create plates.
 * @param system The tectonic system to add plates to
 * @param seeds Array of seed tiles, one for each plate
 * @param edge2TileMap Map from halfedges to tiles (built by buildAllTiles)
 * @returns Array of created plates
 */
function floodFill(system: TectonicSystem, seeds: Tile[], edge2TileMap: Map<Halfedge, Tile>): Plate[] {
  // Track which tiles have been claimed
  const claimedTiles = new Set<Tile>();

  // Create a plate for each seed tile
  const plates: Plate[] = seeds.map(seedTile => {
    claimedTiles.add(seedTile);
    return new Plate(system, seedTile);
  });

  // Track unclaimed border tiles for each plate
  // (border tiles whose twin tiles are not yet claimed)
  const plateUnclaimedBorderTilesMap = new Map<number, Set<Tile>>();
  for (const plate of plates) {
    const unclaimedBorderTiles = new Set<Tile>();

    // Find neighboring tiles of the seed tile that are not yet claimed
    for (const he of plate.borderEdge2TileMap.keys()) {
      const twinTile = edge2TileMap.get(he.twin);
      if (twinTile && !claimedTiles.has(twinTile)) {
        unclaimedBorderTiles.add(twinTile);
      }
    }

    plateUnclaimedBorderTilesMap.set(plate.id, unclaimedBorderTiles);
  }

  const kPlates = Math.ceil(plates.length / 3);
  do {
    // Order plates by decreasing ratio of unclaimed border tiles
    // -> select the top-k plates
    const sortedPlates = plates.sort((a, b) => {
      const aUnclaimedSize = plateUnclaimedBorderTilesMap.get(a.id)?.size || 0;
      const bUnclaimedSize = plateUnclaimedBorderTilesMap.get(b.id)?.size || 0;
      const aRatio = aUnclaimedSize / a.tiles.size;
      const bRatio = bUnclaimedSize / b.tiles.size;
      return bRatio - aRatio;
    });
    const topkPlates = sortedPlates.slice(0, kPlates);

    for (const plate of topkPlates) {
      const unclaimedBorderTiles = plateUnclaimedBorderTilesMap.get(plate.id);
      if (!unclaimedBorderTiles || unclaimedBorderTiles.size === 0) {
        continue;
      }

      // Select a random unclaimed border tile
      const randomIndex = Math.floor(Math.random() * unclaimedBorderTiles.size);
      const borderTilesArray = Array.from(unclaimedBorderTiles);
      const targetTile = borderTilesArray[randomIndex];

      // Check if this tile was claimed by another plate since we last checked
      if (claimedTiles.has(targetTile)) {
        unclaimedBorderTiles.delete(targetTile);
        continue;
      }

      // Claim the tile
      claimedTiles.add(targetTile);
      const added = plate.addTile(targetTile);
      if (!added) {
        console.log("Tile was already present in the plate", plate.id);
        unclaimedBorderTiles.delete(targetTile);
        continue;
      }

      // Remove this tile from unclaimed set
      unclaimedBorderTiles.delete(targetTile);

      // Add neighboring unclaimed tiles to the border set
      for (const he of targetTile.loop()) {
        const twinTile = edge2TileMap.get(he.twin);
        if (twinTile && !claimedTiles.has(twinTile)) {
          unclaimedBorderTiles.add(twinTile);
        }
      }
    }

  } while (Array.from(plateUnclaimedBorderTilesMap.values()).some(set => set.size > 0));

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

/**
 * Splits a plate at a bridge tile into two separate plates.
 * A bridge tile connects multiple regions of the same plate.
 * @param tectonicSystem The tectonic system containing the plate
 * @param bridgeTile The bridge tile where the split occurs
 */
function splitPlateFromTile(tectonicSystem: TectonicSystem, bridgeTile: Tile): void {
  const currentPlate = bridgeTile.plate;

  if (currentPlate.tiles.size <= 2) {
    console.warn("Cannot split plate with only 2 or fewer tiles.");
    return;
  }

  // Build edge2TileMap for just this plate's tiles
  const plateTileEdge2TileMap = new Map<Halfedge, Tile>();
  for (const tile of currentPlate.tiles) {
    for (const he of tile.loop()) {
      plateTileEdge2TileMap.set(he, tile);
    }
  }

  // Find seed tiles from different regions connected by the bridge tile.
  // A bridge tile has multiple "runs" of internal edges (non-border edges),
  // each run connecting to a different region of the plate.
  const halfedges = Array.from(bridgeTile.loop());
  const n = halfedges.length;

  // Check if we start inside an internal run (handle wrap-around)
  const firstIsBorder = currentPlate.borderEdge2TileMap.has(halfedges[0]);
  const lastIsBorder = currentPlate.borderEdge2TileMap.has(halfedges[n - 1]);
  const startsMidRun = !firstIsBorder && !lastIsBorder;

  const seeds: Tile[] = [];
  let inInternalRun = startsMidRun;

  for (const he of halfedges) {
    const isBorder = currentPlate.borderEdge2TileMap.has(he);

    if (!isBorder && !inInternalRun) {
      // Starting a new run of internal edges - get one neighbor from this region
      inInternalRun = true;

      const neighborTile = plateTileEdge2TileMap.get(he.twin);
      if (neighborTile && neighborTile !== bridgeTile && !seeds.includes(neighborTile)) {
        seeds.push(neighborTile);
      }
    } else if (isBorder) {
      inInternalRun = false;
    }
  }

  if (seeds.length < 2) {
    console.warn("Could not find suitable seeds to split the plate at the given tile.");
    return;
  }

  // Remove the current plate from the system
  tectonicSystem.removePlate(currentPlate);

  // Perform flood fill with the first 2 seed tiles (split into 2 plates)
  const newPlates = floodFill(tectonicSystem, seeds.slice(0, 2), plateTileEdge2TileMap);
  newPlates.forEach(plate => tectonicSystem.plates.add(plate));

  tectonicSystem.update();
}

/**
 * Helper for refineBoundaryType: converts segments of certain types if bounded by a specific type.
 * @param orderedEdges Edges in order along the boundary
 * @param convertibleTypes Types that can be converted
 * @param boundingType The type that must be on both sides of a segment
 * @param targetType The type to convert to
 */
function refinePass(
  orderedEdges: BoundaryEdge[],
  convertibleTypes: BoundaryType[],
  boundingType: BoundaryType,
  targetType: BoundaryType
): void {
  const n = orderedEdges.length;

  // Find segments of convertible types
  let i = 0;
  while (i < n) {
    const edge = orderedEdges[i];

    if (!convertibleTypes.includes(edge.refinedType)) {
      i++;
      continue;
    }

    // Found start of a convertible segment
    const segmentStart = i;
    let segmentEnd = i;

    // Find the end of this segment
    while (segmentEnd < n && convertibleTypes.includes(orderedEdges[segmentEnd].refinedType)) {
      segmentEnd++;
    }
    // segmentEnd now points to first edge after segment (or n if segment goes to end)

    // Check what's before and after the segment
    const beforeIdx = segmentStart - 1;
    const afterIdx = segmentEnd;

    const typeBefore = beforeIdx >= 0 ? orderedEdges[beforeIdx].refinedType : null;
    const typeAfter = afterIdx < n ? orderedEdges[afterIdx].refinedType : null;

    // If both sides are the bounding type, convert the segment
    if (typeBefore === boundingType && typeAfter === boundingType) {
      for (let j = segmentStart; j < segmentEnd; j++) {
        orderedEdges[j].refinedType = targetType;
      }
    }

    i = segmentEnd;
  }
}

/**
 * Refines boundary edge types by smoothing out isolated segments.
 *
 * First pass: Convert inactive/transform edges to divergent if between two divergent segments,
 * or to convergent if between two convergent segments.
 *
 * Second pass: Convert convergent edges to inactive if between two inactive segments,
 * or divergent edges to transform if between two transform segments.
 */
function refineBoundaryType(boundary: PlateBoundary): void {
  // Collect edges in order
  const orderedEdges: BoundaryEdge[] = [];
  for (const edge of boundary.iterateEdges()) {
    orderedEdges.push(edge);
  }

  if (orderedEdges.length < 3) {
    return; // Need at least 3 edges to have "between" relationship
  }

  // First pass: expand divergent/convergent into inactive/transform segments
  refinePass(orderedEdges,
    [BoundaryType.INACTIVE, BoundaryType.TRANSFORM], // types to convert
    BoundaryType.DIVERGENT,  // if between these
    BoundaryType.DIVERGENT   // convert to this
  );
  refinePass(orderedEdges,
    [BoundaryType.INACTIVE, BoundaryType.TRANSFORM],
    BoundaryType.CONVERGENT,
    BoundaryType.CONVERGENT
  );

  // Second pass: contract convergent/divergent into inactive/transform segments
  refinePass(orderedEdges,
    [BoundaryType.DIVERGENT, BoundaryType.CONVERGENT],
    BoundaryType.INACTIVE,
    BoundaryType.INACTIVE
  );
  refinePass(orderedEdges,
    [BoundaryType.DIVERGENT, BoundaryType.CONVERGENT],
    BoundaryType.TRANSFORM,
    BoundaryType.TRANSFORM
  );
}

export {
  buildAllTiles,
  floodFill,
  plateAbsorbedByPlate,
  splitPlateFromTile,
  transferTileToPlate,
  refineBoundaryType,
};
