import { Halfedge } from '@core/halfedge/Halfedge';
import { HalfedgeGraph } from '@core/halfedge/HalfedgeGraph';
import { Tile, Plate, TectonicSystem, PlateBoundary, BoundaryEdge, BoundaryType } from './Plate';
import { kmToDistance } from '../../../../shared/world/World';

/**
 * Smoothing window half-width in kilometers for boundary type refinement.
 * This determines how far along the boundary we look when computing the
 * majority boundary type.
 */
const SMOOTHING_WINDOW_HALF_KM = 700;

// Helper class for managing a set of items with O(1) add, delete, and random access.
class RandomSet<T> {
  private items: T[] = [];
  private indices: Map<T, number> = new Map();

  add(item: T): boolean {
    if (this.indices.has(item)) {
      return false; // Already exists
    }
    this.indices.set(item, this.items.length);
    this.items.push(item);
    return true;
  }

  delete(item: T): boolean {
    const index = this.indices.get(item);
    if (index === undefined) {
      return false; // Doesn't exist
    }

    // Swap with last element
    const lastItem = this.items[this.items.length - 1];
    this.items[index] = lastItem;
    this.indices.set(lastItem, index);

    // Remove last element
    this.items.pop();
    this.indices.delete(item);
    return true;
  }

  has(item: T): boolean {
    return this.indices.has(item);
  }

  random(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    const randomIndex = Math.floor(Math.random() * this.items.length);
    return this.items[randomIndex];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.indices.clear();
  }

  *[Symbol.iterator]() {
    yield* this.items;
  }
}

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
  const plateUnclaimedBorderTilesMap = new Map<number, RandomSet<Tile>>();
  for (const plate of plates) {
    const unclaimedBorderTiles = new RandomSet<Tile>();

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
      const targetTile = unclaimedBorderTiles.random();
      if (!targetTile) {
        console.error("Unexpected empty unclaimed border tiles set for plate", plate.id);
        continue;
      }

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
    // console.warn("Tile cannot be transferred to target plate: it is a bridge tile.");
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
 * Computes the length of a boundary edge on the unit sphere.
 * Returns the chord length between the two vertices.
 */
function getEdgeLength(edge: BoundaryEdge): number {
  const he = edge.halfedge;
  return he.vertex.position.distanceTo(he.twin.vertex.position);
}

/**
 * Computes the majority boundary type within a distance-based window.
 * Considers CONVERGENT, DIVERGENT, and TRANSFORM as active types for voting.
 * INACTIVE is treated as neutral and doesn't contribute to the vote.
 *
 * @param orderedEdges Edges in order along the boundary
 * @param edgeLengths Pre-computed lengths for each edge
 * @param centerIdx Index of the edge being evaluated
 * @param halfWindowDist Distance to consider on each side (in unit sphere units)
 * @param globalMajority The majority type along the whole boundary (used as tiebreaker)
 * @returns The majority active type, or null if no clear majority
 */
function getMajorityType(
  orderedEdges: BoundaryEdge[],
  edgeLengths: number[],
  centerIdx: number,
  halfWindowDist: number,
  globalMajority: BoundaryType | null
): BoundaryType | null {
  const n = orderedEdges.length;
  let convergentCount = 0;
  let divergentCount = 0;
  let transformCount = 0;

  // Helper to count a boundary type
  const countType = (type: BoundaryType) => {
    if (type === BoundaryType.CONVERGENT) {
      convergentCount++;
    } else if (type === BoundaryType.DIVERGENT) {
      divergentCount++;
    } else if (type === BoundaryType.TRANSFORM) {
      transformCount++;
    }
  };

  // Count the center edge
  countType(orderedEdges[centerIdx].rawType);

  // Expand backwards from center until we exceed the distance threshold
  let accumulatedDist = edgeLengths[centerIdx] / 2; // Start from center of current edge
  for (let i = centerIdx - 1; i >= 0 && accumulatedDist < halfWindowDist; i--) {
    accumulatedDist += edgeLengths[i];
    countType(orderedEdges[i].rawType);
  }

  // Expand forwards from center until we exceed the distance threshold
  accumulatedDist = edgeLengths[centerIdx] / 2;
  for (let i = centerIdx + 1; i < n && accumulatedDist < halfWindowDist; i++) {
    accumulatedDist += edgeLengths[i];
    countType(orderedEdges[i].rawType);
  }

  // Determine majority among active types
  const totalActive = convergentCount + divergentCount + transformCount;
  if (totalActive === 0) {
    return null; // No active types in window
  }

  // Find the maximum count
  const maxCount = Math.max(convergentCount, divergentCount, transformCount);

  // If clear majority (more than half), return that type
  if (maxCount > totalActive / 2) {
    if (convergentCount === maxCount) {
      return BoundaryType.CONVERGENT;
    } else if (divergentCount === maxCount) {
      return BoundaryType.DIVERGENT;
    } else {
      return BoundaryType.TRANSFORM;
    }
  }

  // No clear majority - use precedence rules:
  // CONVERGENT and DIVERGENT take precedence over TRANSFORM
  // Between CONVERGENT and DIVERGENT: if tied, use global majority as tiebreaker
  if (convergentCount > divergentCount && convergentCount > 0) {
    return BoundaryType.CONVERGENT;
  } else if (divergentCount > convergentCount && divergentCount > 0) {
    return BoundaryType.DIVERGENT;
  } else if (convergentCount === divergentCount && convergentCount > 0) {
    // Tied between CONVERGENT and DIVERGENT - use global majority
    if (globalMajority === BoundaryType.CONVERGENT || globalMajority === BoundaryType.DIVERGENT) {
      return globalMajority;
    }
    // Global majority is TRANSFORM or null - default to CONVERGENT
    return BoundaryType.CONVERGENT;
  } else if (transformCount > 0) {
    return BoundaryType.TRANSFORM;
  }

  return null;
}

/**
 * Refines boundary edge types by smoothing out geometric artifacts from hexagonal tiles.
 *
 * Problem: Hexagonal tile edges have varying orientations, causing the raw boundary
 * type classification to alternate (e.g., DIVERGENT-CONVERGENT-DIVERGENT) even when
 * the overall plate motion clearly indicates a single boundary type.
 *
 * Solution: Use majority voting over a distance-based sliding window to determine
 * the dominant boundary type for each edge. The window size is defined in real-world
 * units (km) via SMOOTHING_WINDOW_HALF_KM, making the smoothing consistent regardless
 * of tile resolution.
 *
 * The algorithm:
 * 1. For each edge, examine neighboring edges within SMOOTHING_WINDOW_HALF_KM distance
 * 2. Count CONVERGENT, DIVERGENT, and TRANSFORM votes (INACTIVE is ignored)
 * 3. Assign the majority type if there's a clear winner (>50% of votes)
 * 4. Preserve INACTIVE only if no active type dominates nearby
 */
function refineBoundaryType(boundary: PlateBoundary): void {
  // Collect edges in order
  const orderedEdges: BoundaryEdge[] = [];
  for (const edge of boundary.iterateEdges()) {
    orderedEdges.push(edge);
  }

  const n = orderedEdges.length;
  if (n < 3) {
    return;
  }

  // Pre-compute edge lengths
  const edgeLengths = orderedEdges.map(getEdgeLength);

  // Compute global raw type counts for the entire boundary
  let globalConvergent = 0;
  let globalDiverging = 0;
  for (const edge of orderedEdges) {
    if (edge.rawType === BoundaryType.CONVERGENT) {
      globalConvergent++;
    } else if (edge.rawType === BoundaryType.DIVERGENT) {
      globalDiverging++;
    }
  }

  // Determine global majority (only between CONVERGENT and DIVERGENT)
  let globalMajority: BoundaryType | null = null;
  if (globalConvergent > globalDiverging) {
    globalMajority = BoundaryType.CONVERGENT;
  } else if (globalDiverging > globalConvergent) {
    globalMajority = BoundaryType.DIVERGENT;
  }
  // If tied globally, globalMajority stays null (will fall back to CONVERGENT in getMajorityType)

  // Convert km threshold to unit sphere distance
  const halfWindowDist = kmToDistance(SMOOTHING_WINDOW_HALF_KM);

  // Compute refined types based on majority voting
  // Store in temporary array to avoid affecting neighbor calculations
  const refinedTypes: BoundaryType[] = [];

  for (let i = 0; i < n; i++) {
    const rawType = orderedEdges[i].rawType;
    const majorityType = getMajorityType(orderedEdges, edgeLengths, i, halfWindowDist, globalMajority);

    if (majorityType !== null) {
      // Clear majority exists - use it
      refinedTypes.push(majorityType);
    } else if (rawType === BoundaryType.INACTIVE || rawType === BoundaryType.TRANSFORM) {
      // No active majority and raw type is already weak - keep it
      refinedTypes.push(rawType);
    } else {
      // No majority but raw type is active - keep raw type
      refinedTypes.push(rawType);
    }
  }

  // Apply refined types
  for (let i = 0; i < n; i++) {
    orderedEdges[i].refinedType = refinedTypes[i];
  }
}

export {
  buildAllTiles,
  floodFill,
  plateAbsorbedByPlate,
  splitPlateFromTile,
  transferTileToPlate,
  refineBoundaryType,
};
