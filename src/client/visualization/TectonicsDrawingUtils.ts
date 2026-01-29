import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import { Tile, Plate, PlateBoundary, BoundaryType, BoundaryEdge, TectonicSystem } from '../tectonics/data/Plate';
import { BOUNDARY_COLORS } from './BoundaryColors';


function makeLineSegments2FromTile(tile: Tile, lines: LineSegments2): void {

  const positions = new Array<number>();
  const colors = new Array<number>();

  const borderColor = [1, 0, 0];
  const innerColor = [1, 1, 1];

  for (const he of tile.loop()) {
    const vStart = he.vertex.position.clone();
    const vEnd = he.next.vertex.position.clone();

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    colors.push(innerColor[0], innerColor[1], innerColor[2]);
    colors.push(innerColor[0], innerColor[1], innerColor[2]);
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

function makeLineSegments2FromPlate(plate: Plate, lines: LineSegments2): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const borderColor = [0.5, 0.5, 0.5];
  for (const he of plate.borderEdge2TileMap.keys()) {
    const vStart = he.vertex.position.clone();
    const vEnd = he.next.vertex.position.clone();

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    colors.push(borderColor[0], borderColor[1], borderColor[2]);
    colors.push(borderColor[0], borderColor[1], borderColor[2]);
  }

  console.log("Num border lines for plate", plate.id, ":", positions.length / 6);

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

function makeLineSegments2FromBoundary(boundary: PlateBoundary, lines: LineSegments2, useRawType: boolean = false): void {
  const positions = new Array<number>();
  const colors = new Array<number>();
  const lineWidths = new Array<number>();
  const dashOffsets = new Array<number>();
  const dashScales = new Array<number>();

  // Higher offset than allBoundaries (0.001) to render above them
  const offsetFactor = 0.003;

  console.log("Number of boundaryEdges: ", boundary.boundaryEdges.size);

  for (const bEdge of boundary.boundaryEdges) {
    const vStart = bEdge.halfedge.vertex.position.clone();
    const vEnd = bEdge.halfedge.next.vertex.position.clone();

    vStart.multiplyScalar(1 + offsetFactor);
    vEnd.multiplyScalar(1 + offsetFactor);

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    const edgeType = useRawType ? bEdge.rawType : bEdge.refinedType;
    console.log("type: ", edgeType, useRawType ? "(raw)" : "(refined)");

    // Customize appearance based on boundary type
    const color = BOUNDARY_COLORS[edgeType];
    colors.push(color[0], color[1], color[2]);
    colors.push(color[0], color[1], color[2]);

    // Set dash parameters based on type
    if (edgeType === BoundaryType.UNKNOWN) {
      dashOffsets.push(0, 0.5);
      dashScales.push(0.5, 0.5);
    } else if (edgeType === BoundaryType.TRANSFORM) {
      dashOffsets.push(0, 0.2);
      dashScales.push(0.2, 0.2);
    } else {
      dashOffsets.push(0, 0);
      dashScales.push(0, 0);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);

  // Apply line widths and dashing
  // const material = lines.material as LineMaterial;
  // material.dashed = true;
  // material.dashOffset = 0;
  // material.dashScale = 0.5; // Adjust for dashing effect

  // lines.geometry.setAttributes({
  //   lineWidths: new Float32BufferAttribute(lineWidths, 1),
  //   dashOffset: new Float32BufferAttribute(dashOffsets, 1),
  //   dashScale: new Float32BufferAttribute(dashScales, 1),
  // });

  lines.computeLineDistances();
}

function makeLineSegments2ForTileMotionVec(tectonicSystem: TectonicSystem, lines: LineSegments2): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const moveColor = [1.0, 0.1, 0.1];

  const scaleFactor = 0.1;
  const arrowHeadSize = 0.005;

  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      const tileCentroid = tile.centroid;
      const originPos = tileCentroid.clone();

      const moveVector = tile.motionVec.clone().multiplyScalar(scaleFactor);

      const vStart = originPos.clone();
      const vEnd = originPos.clone().add(moveVector);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      // Make a small arrow head
      const moveDir = moveVector.clone().normalize();
      const arrowBase = vEnd.clone().sub(moveDir.clone().multiplyScalar(arrowHeadSize));
      const orthogonalVec1 = new THREE.Vector3().crossVectors(moveDir, new THREE.Vector3(0, 1, 0));
      if (orthogonalVec1.length() < 0.001) {
        orthogonalVec1.crossVectors(moveDir, new THREE.Vector3(1, 0, 0));
      }
      orthogonalVec1.normalize().multiplyScalar(arrowHeadSize * 0.5);
      const orthogonalVec2 = new THREE.Vector3().crossVectors(moveDir, orthogonalVec1).normalize().multiplyScalar(arrowHeadSize * 0.5);
      const arrowPoint1 = arrowBase.clone().add(orthogonalVec1);
      const arrowPoint2 = arrowBase.clone().sub(orthogonalVec1);
      const arrowPoint3 = arrowBase.clone().add(orthogonalVec2);
      positions.push(vEnd.x, vEnd.y, vEnd.z);
      positions.push(arrowPoint1.x, arrowPoint1.y, arrowPoint1.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);
      positions.push(arrowPoint2.x, arrowPoint2.y, arrowPoint2.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);
      positions.push(arrowPoint3.x, arrowPoint3.y, arrowPoint3.z);

      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
      colors.push(moveColor[0], moveColor[1], moveColor[2]);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Creates line segments for a boundary with gradient coloring from one limit to another.
 * @param boundary The plate boundary to visualize
 * @param lines The LineSegments2 object to populate
 * @param startLimit Optional: which limit edge to start from. If not provided, uses first limit.
 * @returns true if successful, false if boundary has no limits (closed loop)
 */
function makeLineSegments2FromBoundaryGradient(
  boundary: PlateBoundary,
  lines: LineSegments2,
  startLimit?: BoundaryEdge
): boolean {
  const positions = new Array<number>();
  const colors = new Array<number>();

  // Higher offset than allBoundaries (0.001) to render above them
  const offsetFactor = 0.003;

  // Check if boundary has limit edges
  if (!boundary.limitEdges) {
    console.warn(`PlateBoundary ${boundary.id}: no limit edges (closed loop), cannot create gradient`);
    return false;
  }

  // Collect edges in order
  const orderedEdges: BoundaryEdge[] = [];
  for (const edge of boundary.iterateEdges(startLimit)) {
    orderedEdges.push(edge);
  }

  const totalEdges = orderedEdges.length;
  if (totalEdges === 0) {
    return false;
  }

  // Gradient colors: start (cyan) to end (magenta)
  const startColor = [0, 1, 1]; // Cyan
  const endColor = [1, 0, 1];   // Magenta

  for (let i = 0; i < orderedEdges.length; i++) {
    const bEdge = orderedEdges[i];
    const t = totalEdges > 1 ? i / (totalEdges - 1) : 0;

    const vStart = bEdge.halfedge.vertex.position.clone();
    const vEnd = bEdge.halfedge.next.vertex.position.clone();

    vStart.multiplyScalar(1 + offsetFactor);
    vEnd.multiplyScalar(1 + offsetFactor);

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);

    // Interpolate color
    const r = startColor[0] + t * (endColor[0] - startColor[0]);
    const g = startColor[1] + t * (endColor[1] - startColor[1]);
    const b = startColor[2] + t * (endColor[2] - startColor[2]);

    colors.push(r, g, b);
    colors.push(r, g, b);
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();

  return true;
}

/**
 * Creates line segments for all boundaries in the tectonic system with a uniform color.
 * @param tectonicSystem The tectonic system containing all boundaries
 * @param lines The LineSegments2 object to populate
 * @param color RGB color array [r, g, b] with values in range [0, 1], defaults to light gray
 */
function makeLineSegments2ForAllBoundaries(
  tectonicSystem: TectonicSystem,
  lines: LineSegments2,
  color: [number, number, number] = [0.7, 0.7, 0.7]
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const offsetFactor = 0.001;

  for (const boundary of tectonicSystem.boundaries) {
    for (const bEdge of boundary.boundaryEdges) {
      const vStart = bEdge.halfedge.vertex.position.clone();
      const vEnd = bEdge.halfedge.next.vertex.position.clone();

      vStart.multiplyScalar(1 + offsetFactor);
      vEnd.multiplyScalar(1 + offsetFactor);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

/**
 * Creates line segments for neighbor tiles on the same plate.
 * Each neighbor tile's edges are displayed in a distinct color.
 * @param tile The source tile
 * @param tectonicSystem The tectonic system to find neighbors
 * @param lines The LineSegments2 object to populate
 */
function makeLineSegments2ForNeighborTilesInPlate(
  tile: Tile,
  tectonicSystem: TectonicSystem,
  lines: LineSegments2
): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const plate = tile.plate;

  // Distinct colors for each neighbor
  const neighborColors = [
    [0, 1, 0],    // Green
    [0, 0, 1],    // Blue
    [1, 1, 0],    // Yellow
    [1, 0, 1],    // Magenta
    [0, 1, 1],    // Cyan
    [1, 0.5, 0],  // Orange
    [0.5, 0, 1],  // Purple
    [0, 0.5, 1],  // Light blue
  ];

  // Offset factor to render slightly above the mesh
  const offsetFactor = 0.002;

  let neighborIndex = 0;
  const visitedNeighbors = new Set<Tile>();

  console.log(`[DEBUG] Finding neighbors for tile ${tile.id} in plate ${plate.id}`);

  for (const he of tile.loop()) {
    const twinTile = tectonicSystem.edge2TileMap.get(he.twin);

    if (!twinTile) {
      console.log(`[DEBUG] Edge ${he.id}: no twin tile found`);
      continue;
    }

    if (twinTile === tile) {
      console.log(`[DEBUG] Edge ${he.id}: twin tile is same as source tile`);
      continue;
    }

    if (visitedNeighbors.has(twinTile)) {
      continue;
    }

    const isSamePlate = twinTile.plate === plate;
    console.log(`[DEBUG] Edge ${he.id}: twin tile ${twinTile.id} in plate ${twinTile.plate.id}, same plate: ${isSamePlate}`);

    if (!isSamePlate) {
      continue;
    }

    visitedNeighbors.add(twinTile);

    const color = neighborColors[neighborIndex % neighborColors.length];
    neighborIndex++;

    console.log(`[DEBUG] Neighbor tile ${twinTile.id} (color index ${neighborIndex - 1})`);

    // Draw all edges of this neighbor tile
    for (const neighborHe of twinTile.loop()) {
      const vStart = neighborHe.vertex.position.clone();
      const vEnd = neighborHe.next.vertex.position.clone();

      // Offset slightly outward
      vStart.multiplyScalar(1 + offsetFactor);
      vEnd.multiplyScalar(1 + offsetFactor);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      colors.push(color[0], color[1], color[2]);
      colors.push(color[0], color[1], color[2]);
    }
  }

  console.log(`[DEBUG] Total neighbors found on same plate: ${visitedNeighbors.size}`);

  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry();
  lines.geometry.setPositions(positions);
  lines.geometry.setColors(colors);
  lines.computeLineDistances();
}

export {
  makeLineSegments2FromTile,
  makeLineSegments2FromPlate,
  makeLineSegments2FromBoundary,
  makeLineSegments2ForTileMotionVec,
  makeLineSegments2FromBoundaryGradient,
  makeLineSegments2ForAllBoundaries,
  makeLineSegments2ForNeighborTilesInPlate
};
