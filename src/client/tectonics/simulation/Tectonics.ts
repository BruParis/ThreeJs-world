import * as THREE from 'three';
import { Vertex } from '@core/Vertex';
import { Halfedge } from '@core/Halfedge';
import { HalfedgeGraph } from '@core/HalfedgeGraph';
import { Tile, Plate, PlateCategory, BoundaryEdge, BoundaryType, GeologicalType, GeologicalIntensity, TectonicSystem, makePlateBoundary } from '../data/Plate';
import {
  buildAllTiles,
  floodFill,
  plateAbsorbedByPlate,
  splitPlateFromTile,
  transferTileToPlate,
  refineBoundaryType
} from '../data/PlateOperations';
import { computeNetRotation, computeTectonicDynamics, caracterizeBoundaryEdge, computeConvergentDominance } from '../dynamics/dynamics';
import { assignGeologicalTypes } from './Geology';

function _splitPlateAtBridgeTiles(tectonicSystem: TectonicSystem): void {

  const bridgeTiles: Set<Tile> = new Set<Tile>();
  for (const plate of tectonicSystem.plates) {
    const visitedTiles: Set<Tile> = new Set<Tile>();
    for (const borderTile of plate.borderEdge2TileMap.values()) {
      if (visitedTiles.has(borderTile)) {
        continue;
      }

      visitedTiles.add(borderTile);

      const tileIsABridge = borderTile.isABridge();
      if (tileIsABridge) {
        bridgeTiles.add(borderTile);
      }

      // Just one tile per plate
      break;
    }
  }

  console.log("Number of bridgeTiles =", bridgeTiles.size);
  console.log("Number of plates before:", tectonicSystem.plates.size);

  for (const bridgeTile of bridgeTiles) {
    console.log("Splitting plate at tile:", bridgeTile.id);
    splitPlateFromTile(tectonicSystem, bridgeTile);
  }

  console.log("Number of plates after splitting plates:", tectonicSystem.plates.size);
}

interface TileTransferEligibility {
  isEligible: boolean;
  isBorderTile: boolean;
  internalEdgeCount: number;
  dominantPlate: Plate | null;
  dominantPlateEdgeCount: number;
  adjacentPlateCounts: Map<Plate, number>;
}

function checkTileTransferEligibility(tile: Tile, tectonicSystem: TectonicSystem): TileTransferEligibility {
  const plate = tile.plate;
  const result: TileTransferEligibility = {
    isEligible: false,
    isBorderTile: false,
    internalEdgeCount: 0,
    dominantPlate: null,
    dominantPlateEdgeCount: 0,
    adjacentPlateCounts: new Map<Plate, number>()
  };

  // Check if tile is a border tile
  const borderEdgeCount = tile.countBorderEdges();
  if (borderEdgeCount === 0) {
    return result;
  }
  result.isBorderTile = true;

  // Count internal edges (non-border edges = edges shared with same plate)
  result.internalEdgeCount = tile.countEdges() - borderEdgeCount;

  // Count how many edges this tile shares with each adjacent plate
  for (const he of tile.loop()) {
    if (!plate.borderEdge2TileMap.has(he)) {
      continue;
    }

    const twinHe = he.twin;
    const otherTile = tectonicSystem.edge2TileMap.get(twinHe);
    const otherPlate = otherTile?.plate;
    if (!otherPlate || otherPlate === plate) {
      continue;
    }

    const plateCount = result.adjacentPlateCounts.get(otherPlate) || 0;
    result.adjacentPlateCounts.set(otherPlate, plateCount + 1);
  }

  if (result.adjacentPlateCounts.size === 0) {
    return result;
  }

  // Find the plate with the most shared borders
  const [dominantPlate, dominantEdgeCount] = Array.from(result.adjacentPlateCounts.entries())
    .sort((a, b) => b[1] - a[1])[0];

  result.dominantPlate = dominantPlate;
  result.dominantPlateEdgeCount = dominantEdgeCount;

  // Eligible if dominant plate shares more edges than internal edges
  result.isEligible = dominantEdgeCount > result.internalEdgeCount;

  return result;
}

function logTileTransferEligibility(tile: Tile, tectonicSystem: TectonicSystem): void {

  const plate = tile.plate;
  let isBorderTile = false;
  for (const borderTile of plate.iterBorderTiles()) {
    if (borderTile === tile) {
      isBorderTile = true;
      break;
    }
  }

  if (!isBorderTile) {
    console.log("Tile", tile.id, "is not a border tile of its plate", plate.id);
    return;
  }

  const result = checkTileTransferEligibility(tile, tectonicSystem);

  console.log("=== Tile Transfer Eligibility Check ===");
  console.log("Tile ID:", tile.id, "| Plate ID:", tile.plate.id);
  console.log("Is border tile:", result.isBorderTile);

  if (!result.isBorderTile) {
    console.log("Not a border tile - not eligible for transfer.");
    return;
  }

  console.log("Internal edges (with same plate):", result.internalEdgeCount);
  console.log("Adjacent plates:");
  for (const [plate, count] of result.adjacentPlateCounts.entries()) {
    console.log("  - Plate", plate.id, ":", count, "edges");
  }

  if (result.dominantPlate) {
    console.log("Dominant adjacent plate:", result.dominantPlate.id, "with", result.dominantPlateEdgeCount, "edges");
  }

  console.log("ELIGIBLE FOR TRANSFER:", result.isEligible);
  if (result.isEligible) {
    console.log("  -> Would transfer to plate", result.dominantPlate?.id);
  } else {
    console.log("  -> Dominant plate edges (", result.dominantPlateEdgeCount, ") <= internal edges (", result.internalEdgeCount, ")");
  }
  console.log("========================================");
}

function _transferBorderTilesToDominantPlate(tectonicSystem: TectonicSystem): Set<number> {
  // Transfer border tiles to adjacent plate only if that plate shares more edges
  // with the tile than the tile has internal edges with its current plate
  const borderTilePlateTransferMap: Map<Tile, Plate> = new Map<Tile, Plate>();

  for (const plate of tectonicSystem.plates) {
    if (plate.tiles.size <= 1) {
      continue;
    }

    for (const borderTile of plate.iterBorderTiles()) {
      const eligibility = checkTileTransferEligibility(borderTile, tectonicSystem);

      if (eligibility.isEligible && eligibility.dominantPlate) {
        borderTilePlateTransferMap.set(borderTile, eligibility.dominantPlate);
      }
    }
  }

  // among all the candidate tiles, remove the one sharing edges with tiles
  // from other plates that are also being transferre to the tile's original plate
  const tilesToRemoveFromTransfer: Set<Tile> = new Set<Tile>();
  for (const [borderTile, targetPlate] of borderTilePlateTransferMap.entries()) {
    for (const he of borderTile.loop()) {
      if (!borderTile.plate.borderEdge2TileMap.has(he)) {
        continue;
      }

      const twinHe = he.twin;
      const otherTile = tectonicSystem.edge2TileMap.get(twinHe);
      const otherPlate = otherTile?.plate;
      if (!otherPlate || otherPlate === borderTile.plate) {
        continue;
      }

      // if other tile has been marked for removal, skip
      if (tilesToRemoveFromTransfer.has(otherTile!)) {
        continue;
      }

      // Check if the other tile is also being transferred to the border tile's plate
      const otherTileTargetPlate = borderTilePlateTransferMap.get(otherTile!);
      if (otherTileTargetPlate === borderTile.plate) {
        tilesToRemoveFromTransfer.add(borderTile);
        break;
      }
    }
  }

  // remove the tiles marked for removal
  for (const tileToRemove of tilesToRemoveFromTransfer) {
    borderTilePlateTransferMap.delete(tileToRemove);
  }

  // Transfer all tiles
  const transferredTilesIds: Set<number> = new Set<number>();
  for (const [borderTile, targetPlate] of borderTilePlateTransferMap.entries()) {

    transferTileToPlate(borderTile, targetPlate);

    transferredTilesIds.add(borderTile.id);
  }

  return transferredTilesIds;
}

function _absorbEnclavedPlates(tectonicSystem: TectonicSystem): void {
  const plateTransferMap: Map<Plate, Plate> = new Map<Plate, Plate>();
  // by construction by the following algorithm, the plateTransferMap
  // keys and values should be disjoint sets of plates
  for (const plate of tectonicSystem.plates) {
    let surroundingPlate: Plate | null = null;
    let isSurrounded = true;

    for (const borderTile of plate.iterBorderTiles()) {
      for (const he of borderTile.loop()) {
        if (!plate.borderEdge2TileMap.has(he)) {
          continue;
        }

        const twinHe = he.twin;
        const otherPlate = tectonicSystem.edge2TileMap.get(twinHe)?.plate;
        if (!otherPlate || otherPlate === plate) {
          console.warn("Could not find other plate for halfedge during plate absorption.");
          continue;
        }

        if (!surroundingPlate) {
          surroundingPlate = otherPlate;
        } else if (surroundingPlate !== otherPlate) {
          isSurrounded = false;
          break;
        }
      }

      if (!isSurrounded) {
        break;
      }
    }

    if (isSurrounded && surroundingPlate) {
      plateTransferMap.set(plate, surroundingPlate);
    }
  }
  console.log("Number of plates to be absorbed:", plateTransferMap.size);

  for (const [plateToAbsorb, targetPlate] of plateTransferMap.entries()) {
    console.log("Absorbing plate", plateToAbsorb.id, "into plate", targetPlate.id);
    plateAbsorbedByPlate(plateToAbsorb, targetPlate);
  }
}

function _absorbSmallPlates(tectonicSystem: TectonicSystem, sizeThreshold: number): void {
  const smallThreshold = 1;
  const smallTilePlateTransferMap: Map<Plate, Plate> = new Map<Plate, Plate>();
  for (const plate of tectonicSystem.plates) {
    if (plate.tiles.size !== smallThreshold) {
      continue;
    }

    const smallTile = plate.tiles.values().next().value as Tile;

    let otherPlateCounter = new Map<Plate, number>();
    for (const he of smallTile.loop()) {
      const twinHe = he.twin;
      const otherPlate = tectonicSystem.edge2TileMap.get(twinHe)?.plate;
      if (!otherPlate || otherPlate === plate) {
        console.warn("Could not find other plate for halfedge during small tile plate absorption.");
        continue;
      }

      const plateCount = otherPlateCounter.get(otherPlate) || 0;
      otherPlateCounter.set(otherPlate, plateCount + 1);
    }

    // Transfer to the most frequent neighboring plate
    const targetPlate = Array.from(otherPlateCounter.entries()).sort((a, b) => b[1] - a[1])[0][0];
    smallTilePlateTransferMap.set(plate, targetPlate);
  }

  console.log("Number of small-tile plates to be absorbed:", smallTilePlateTransferMap.size);
  for (const [plateToAbsorb, targetPlate] of smallTilePlateTransferMap.entries()) {
    console.log("Absorbing small-tile plate", plateToAbsorb.id, "into plate", targetPlate.id);
    plateAbsorbedByPlate(plateToAbsorb, targetPlate);
  }
}

function _transferBorderTilesToDominantPlateLoop(tectonicSystem: TectonicSystem, iterations: number): void {
  const setsAreEqual = (a: Set<number>, b: Set<number>): boolean =>
    a.size === b.size && [...a].every(id => b.has(id));

  const start_time = performance.now();
  const history: Set<number>[] = [];

  for (let i = 0; i < iterations; i++) {
    const tilesTransferredIds = _transferBorderTilesToDominantPlate(tectonicSystem);

    // Stop if no transfers or alternating state detected (matches 2 iterations ago)
    if (tilesTransferredIds.size === 0 ||
      (history.length >= 2 && setsAreEqual(tilesTransferredIds, history[history.length - 2]))) {
      break;
    }

    history.push(tilesTransferredIds);
  }

  const end_time = performance.now();
  console.log("Time taken for border tile transfers:", (end_time - start_time), "ms - iterations:", history.length);

}

function buildTectonicSystem(halfedgeGraph: HalfedgeGraph, numPlates: number): TectonicSystem {
  console.log("Building tectonic system with", numPlates, "plates.");

  // 1) Create the tectonic system first
  const tectonicSystem = new TectonicSystem();

  // 2) Build all tiles from the halfedge graph
  const edge2TileMap = buildAllTiles(halfedgeGraph);
  const allTiles = Array.from(new Set(edge2TileMap.values()));
  console.log(`Total tiles created: ${allTiles.length}`);

  // 3) Select seeds: first 2 at poles, rest random
  const seeds: Tile[] = [];

  if (numPlates >= 2) {
    // Find tile closest to north pole (highest Y centroid)
    const northPoleTile = allTiles.reduce((best, tile) =>
      tile.centroid.y > best.centroid.y ? tile : best
    );
    seeds.push(northPoleTile);

    // Find tile closest to south pole (lowest Y centroid)
    const southPoleTile = allTiles.reduce((best, tile) =>
      tile.centroid.y < best.centroid.y ? tile : best
    );
    seeds.push(southPoleTile);

    // Fill remaining seeds with random tiles (excluding pole tiles)
    const remainingTiles = allTiles.filter(t => t !== northPoleTile && t !== southPoleTile);
    const shuffled = remainingTiles.sort(() => 0.5 - Math.random());
    seeds.push(...shuffled.slice(0, numPlates - 2));
  } else if (numPlates === 1) {
    // Single plate: just pick any tile
    seeds.push(allTiles[0]);
  }

  // 4) Perform flood fill to assign tiles to plates
  const plates = floodFill(tectonicSystem, seeds, edge2TileMap);

  plates.forEach(plate => tectonicSystem.plates.add(plate));

  tectonicSystem.update();

  // 4) Tiles that are only linked to a plate by a single edge are transferred
  // to the neighboring plate
  _transferBorderTilesToDominantPlateLoop(tectonicSystem, 50);

  // 5) Plates with narrow shape (1 tile large, bridge tile) are split into plates
  _splitPlateAtBridgeTiles(tectonicSystem);

  // 6) Each plate completely surrounded by the same plate gets absorbed
  _absorbEnclavedPlates(tectonicSystem);

  // 7) Each small tile plate gets absorbed by the neighboring plate
  _absorbSmallPlates(tectonicSystem, 5);

  // 8) Update edge2TileMap after all tile modifications
  tectonicSystem.update();

  // 9) Compute plate areas now that all modifications are complete
  for (const plate of tectonicSystem.plates) {
    plate.computeArea();
  }

  // 10) Compute plate area statistics
  tectonicSystem.computePlateAreaStatistics();

  return tectonicSystem;
}

function computeTectonicMotion(tectonicSystem: TectonicSystem): void {
  computeTectonicDynamics(tectonicSystem);
}

function computePlateBoundaries(tectonicSystem: TectonicSystem): void {

  tectonicSystem.clearBoundaries();

  const borderHeVisitedSet: Set<Halfedge> = new Set<Halfedge>();
  for (const plateA of tectonicSystem.plates) {

    // Collect all border edges
    const startVertext2BorderEdgeMap = new Map<Vertex, Halfedge>();
    const endVertex2BorderEdgeMap = new Map<Vertex, Halfedge>();
    for (const borderHe of plateA.borderEdge2TileMap.keys()) {
      startVertext2BorderEdgeMap.set(borderHe.vertex, borderHe);
      // Do not take 'next', as the next halfedge might not be a border edge
      // -> take the twin vertex instead
      endVertex2BorderEdgeMap.set(borderHe.twin.vertex, borderHe);
    }

    for (const borderHe of plateA.borderEdge2TileMap.keys()) {
      if (borderHeVisitedSet.has(borderHe)) {
        continue;
      }

      borderHeVisitedSet.add(borderHe);

      const borderTwinHe = borderHe.twin;
      const plateB = tectonicSystem.edge2TileMap.get(borderTwinHe)?.plate;
      if (!plateB || plateB === plateA) {
        continue;
      }

      const newBoundaryEdges = new Set<Halfedge>();

      let auxHe = borderHe;
      let auxHeValid = auxHe !== undefined;
      let twinInPlateB = tectonicSystem.edge2TileMap.get(auxHe.twin)?.plate === plateB;
      let auxHeNotVisited = !borderHeVisitedSet.has(auxHe);

      // Traverse the boundary in one direction (going from 
      // as long as the twin tile belongs to the same plate)
      do {
        borderHeVisitedSet.add(auxHe);
        newBoundaryEdges.add(auxHe);

        auxHe = startVertext2BorderEdgeMap.get(auxHe.next.vertex)!;

        auxHeValid = auxHe !== undefined;
        twinInPlateB = tectonicSystem.edge2TileMap.get(auxHe.twin)?.plate === plateB;
        auxHeNotVisited = !borderHeVisitedSet.has(auxHe);

      } while (auxHeValid && twinInPlateB && auxHeNotVisited);

      // Now traverse in the other direction
      let auxHeReverse = borderHe;
      let auxHeReverseValid = auxHeReverse !== undefined;
      twinInPlateB = tectonicSystem.edge2TileMap.get(auxHeReverse.twin)?.plate === plateB;
      let auxHeReverseNotVisited = !borderHeVisitedSet.has(auxHeReverse);

      do {

        borderHeVisitedSet.add(auxHeReverse);
        newBoundaryEdges.add(auxHeReverse);

        auxHeReverse = endVertex2BorderEdgeMap.get(auxHeReverse.vertex)!;

        auxHeReverseValid = auxHeReverse !== undefined;
        twinInPlateB = tectonicSystem.edge2TileMap.get(auxHeReverse.twin)?.plate === plateB;
        auxHeReverseNotVisited = !borderHeVisitedSet.has(auxHeReverse);
      } while (auxHeReverseValid && twinInPlateB && auxHeReverseNotVisited);

      // Create plate boundary
      const plateBoundary = makePlateBoundary(tectonicSystem, newBoundaryEdges);
      tectonicSystem.addBoundary(plateBoundary);

    }
  }

  console.log("Number of plate boundaries computed:", tectonicSystem.boundaries.size);
  console.log("Number of boundary edges computed:", tectonicSystem.edge2BoundaryMap.size);
}

function caracterizePlateBoundaries(tectonicSystem: TectonicSystem): void {
  const processBoundaryEdge = new Set<BoundaryEdge>();
  for (const boundary of tectonicSystem.boundaries) {

    for (const bEdge of boundary.boundaryEdges) {
      if (processBoundaryEdge.has(bEdge)) {
        continue;
      }

      processBoundaryEdge.add(bEdge);
      caracterizeBoundaryEdge(tectonicSystem, bEdge);
    }

  }

  // for all boundaries: call the refineBoundaryType from plate operations
  for (const boundary of tectonicSystem.boundaries) {
    refineBoundaryType(boundary);
  }
}

/**
 * Computes convergent dominance for all boundary edges.
 * This determines which plate is the overriding plate at convergent boundaries.
 * Must be called after boundary types are refined and plate categories are assigned.
 */
function computeBoundaryDominance(tectonicSystem: TectonicSystem): void {
  for (const boundary of tectonicSystem.boundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      computeConvergentDominance(tectonicSystem, bEdge);
    }
  }
}

/**
 * Computes the divergent edge ratio for a plate, weighted by plate area.
 * Returns the ratio of divergent boundary edges to total boundary edges,
 * multiplied by the plate's area for area-weighted sorting.
 */
function computePlateDivergentRatio(plate: Plate, tectonicSystem: TectonicSystem): number {
  let divergentCount = 0;
  let totalCount = 0;

  for (const boundary of tectonicSystem.boundaries) {
    if (boundary.plateA !== plate && boundary.plateB !== plate) {
      continue;
    }

    for (const bEdge of boundary.boundaryEdges) {
      totalCount++;
      if (bEdge.refinedType === BoundaryType.DIVERGENT) {
        divergentCount++;
      }
    }
  }

  const ratio = totalCount > 0 ? divergentCount / totalCount : 0;
  return ratio * plate.area;
}

/**
 * Assigns categories (continental or oceanic) to plates based on area ratio.
 * Uses a greedy approximation algorithm to achieve the target area distribution.
 * Plates with more divergent boundaries are biased toward oceanic.
 * @param tectonicSystem The tectonic system to categorize
 * @param continentalRatio Target ratio of continental area (default 0.3 = 30%)
 */
function categorizePlates(tectonicSystem: TectonicSystem, continentalRatio: number = 0.4): void {
  // Compute total area
  let totalArea = 0;
  for (const plate of tectonicSystem.plates) {
    totalArea += plate.area;
  }

  const targetContinentalArea = totalArea * continentalRatio;

  // Compute divergent ratio for each plate and sort ascending
  // Plates with fewer divergent edges are processed first (more likely continental)
  const platesWithRatio = Array.from(tectonicSystem.plates).map(plate => ({
    plate,
    divergentRatio: computePlateDivergentRatio(plate, tectonicSystem)
  }));

  // Sort by divergent ratio ascending, with random tiebreaker for variety
  platesWithRatio.sort((a, b) => {
    const diff = a.divergentRatio - b.divergentRatio;
    if (Math.abs(diff) < 0.001) {
      return Math.random() - 0.5; // Random tiebreaker
    }
    return diff;
  });

  // Greedy assignment: for each plate, check if adding it to continental
  // brings us closer to the target area ratio
  let continentalArea = 0;
  for (const { plate } of platesWithRatio) {
    const distanceWithout = Math.abs(targetContinentalArea - continentalArea);
    const distanceWith = Math.abs(targetContinentalArea - (continentalArea + plate.area));

    if (distanceWith <= distanceWithout) {
      plate.category = PlateCategory.CONTINENTAL;
      continentalArea += plate.area;
    } else {
      plate.category = PlateCategory.OCEANIC;
    }
  }

  const actualRatio = continentalArea / totalArea;
  console.log(`Plate categorization: target=${(continentalRatio * 100).toFixed(1)}%, actual=${(actualRatio * 100).toFixed(1)}%`);
}

export { buildTectonicSystem, computeTectonicMotion, computeNetRotation, computePlateBoundaries, caracterizePlateBoundaries, computeBoundaryDominance, logTileTransferEligibility, categorizePlates, assignGeologicalTypes };
