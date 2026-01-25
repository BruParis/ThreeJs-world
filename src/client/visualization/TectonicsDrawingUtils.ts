import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import { Tile, Plate, PlateBoundary, BoundaryType, TectonicSystem } from '../tectonics/data/Plate';


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

function makeLineSegments2FromBoundary(boundary: PlateBoundary, lines: LineSegments2): void {
  const positions = new Array<number>();
  const colors = new Array<number>();
  const lineWidths = new Array<number>();
  const dashOffsets = new Array<number>();
  const dashScales = new Array<number>();

  const offsetFactor = 0.001;

  console.log("Number of boundaryEdges: ", boundary.boundaryEdges.size);

  for (const bEdge of boundary.boundaryEdges) {
    const vStart = bEdge.halfedge.vertex.position.clone();
    const vEnd = bEdge.halfedge.next.vertex.position.clone();

    vStart.multiplyScalar(1 + offsetFactor);
    vEnd.multiplyScalar(1 + offsetFactor);

    positions.push(vStart.x, vStart.y, vStart.z);
    positions.push(vEnd.x, vEnd.y, vEnd.z);
    console.log("type: ", bEdge.type);

    // Customize appearance based on boundary type
    switch (bEdge.type) {
      case BoundaryType.UNKNOWN:
        colors.push(0, 0, 0); // Black
        colors.push(0, 0, 0);
        dashOffsets.push(0, 0.5);
        dashScales.push(0.5, 0.5);
        break;
      case BoundaryType.INACTIVE:
        colors.push(0.6, 0.3, 0); // Brown
        colors.push(0.6, 0.3, 0);
        dashOffsets.push(0, 0);
        dashScales.push(0, 0);
        break;
      case BoundaryType.DIVERGENT:
        colors.push(1, 0, 0); // Red
        colors.push(1, 0, 0);
        dashOffsets.push(0, 0);
        dashScales.push(0, 0);
        break;
      case BoundaryType.CONVERGENT:
        colors.push(0, 0, 1); // Blue
        colors.push(0, 0, 1);
        dashOffsets.push(0, 0);
        dashScales.push(0, 0);
        break;
      case BoundaryType.TRANSFORM:
        colors.push(0, 1, 0); // Green
        colors.push(0, 1, 0);
        dashOffsets.push(0, 0.2);
        dashScales.push(0.2, 0.2);
        break;
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

export {
  makeLineSegments2FromTile,
  makeLineSegments2FromPlate,
  makeLineSegments2FromBoundary,
  makeLineSegments2ForTileMotionVec
};
