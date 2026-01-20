import * as THREE from 'three';
import { Vertex } from '@core/Vertex';
import { Halfedge } from '@core/Halfedge';
import { HalfedgeGraph } from '@core/HalfedgeGraph';
import { Tile, Plate, BoundaryEdge, TectonicSystem, makePlateBoundary } from '../data/Plate';
import {
  floodFill,
  plateAbsorbedByPlate,
  transferTileToPlate,
  splitPlateFromTile,
} from '../data/PlateOperations';
import { computeTectonicDynamics, caracterizeBoundaryEdge } from '../dynamics/dynamics';

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

function _transferAllSingleEdgeBorderTiles(tectonicSystem: TectonicSystem): void {
  for (const plate of tectonicSystem.plates) {

    if (plate.tiles.size <= 1) {
      continue;
    }

    let secureCount = 0;
    let noTransferDone = false;
    do {

      const borderTilePlateTransferMap: Map<Tile, Plate> = new Map<Tile, Plate>();
      for (const borderTile of plate.iterBorderTiles()) {

        let borderHe: Halfedge | null = null;

        const numNonBorderEdges = borderTile.countEdges() - borderTile.countBorderEdges();
        if (numNonBorderEdges !== 1) {
          // isolated tile, skip
          continue;
        }

        // Count adjacent plates
        let otherPlateCounter = new Map<Plate, number>();
        for (const he of borderTile.loop()) {
          if (!plate.borderEdge2TileMap.has(he)) {
            continue;
          }

          const twinHe = he.twin;
          const otherPlate = tectonicSystem.edge2TileMap.get(twinHe)?.plate;
          if (!otherPlate || otherPlate === plate) {
            console.warn("Could not find other plate for halfedge during tile transfer.");
            continue;
          }

          borderHe = he;

          const plateCount = otherPlateCounter.get(otherPlate) || 0;
          otherPlateCounter.set(otherPlate, plateCount + 1);
        }

        const targetPlate = Array.from(otherPlateCounter.entries()).sort((a, b) => b[1] - a[1])[0][0];
        borderTilePlateTransferMap.set(borderTile, targetPlate);
      }

      for (const [borderTile, targetPlate] of borderTilePlateTransferMap.entries()) {
        transferTileToPlate(borderTile, targetPlate);
      }

      noTransferDone = borderTilePlateTransferMap.size === 0;
      if (noTransferDone) {
        break;
      }

    } while (secureCount < 100000);

    if (secureCount >= 100000) {
      console.warn("Secure count reached during tile transfer for plate", plate.id);
    }
  }
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

function buildTectonicSystem(halfedgeGraph: HalfedgeGraph, numPlates: number): TectonicSystem {
  console.log("Building tectonic system with", numPlates, "plates.");

  // Select numPlates random halfedges as seeds
  const halfedgesArray = Array.from(halfedgeGraph.halfedges.values());
  const shuffled = halfedgesArray.sort(() => 0.5 - Math.random());
  const selectedSet = new Set<Halfedge>();

  const seeds: Halfedge[] = [];

  for (const he of shuffled) {
    if (seeds.length >= numPlates) break;

    if (selectedSet.has(he)) {
      continue;
    }

    seeds.push(he);

    // Mark all halfedges in the loop as selected
    for (const auxHe of he.nextLoop()) {
      selectedSet.add(auxHe);
    }
  }

  const plates = floodFill(seeds, selectedSet);

  const tectonicSystem = new TectonicSystem();
  plates.forEach(plate => tectonicSystem.plates.add(plate));

  tectonicSystem.update();

  // 1) Plates with narrow shape (1 tile large, bridge tile) are split into plates
  _splitPlateAtBridgeTiles(tectonicSystem);

  // 2) Tiles that are only linked to a plate by a single edge are transferred 
  // to the neighboring plate
  _transferAllSingleEdgeBorderTiles(tectonicSystem);

  // 3) Each plate completely surrounded by the same plate gets absorbed
  _absorbEnclavedPlates(tectonicSystem);

  // 4) Each small tile plate gets absorbed by the neighboring plate
  _absorbSmallPlates(tectonicSystem, 5);

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

      console.log("Boundary edge", bEdge.halfedge.id, "type:", bEdge.type);
    }

  }
}

export { buildTectonicSystem, computeTectonicMotion, computePlateBoundaries, caracterizePlateBoundaries };
