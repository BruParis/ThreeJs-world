import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
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

function makeLineSegments2ForTileMotionSpeed(tectonicSystem: TectonicSystem, lines: LineSegments2): void {
  const positions = new Array<number>();
  const colors = new Array<number>();

  const moveColor = [1.0, 0.1, 0.1];
  console.log("Making line segments for tile move speeds.");

  const scaleFactor = 0.1;
  const arrowHeadSize = 0.005;

  for (const plate of tectonicSystem.plates) {
    for (const tile of plate.tiles) {
      const tileCentroid = tile.centroid;
      const originPos = tileCentroid.clone();

      const moveVector = tile.motionSpeed;
      moveVector.multiplyScalar(scaleFactor);

      const vStart = originPos.clone();
      const vEnd = originPos.clone().add(moveVector);

      positions.push(vStart.x, vStart.y, vStart.z);
      positions.push(vEnd.x, vEnd.y, vEnd.z);

      // console.log("start: (", vStart.x.toFixed(3), ",", vStart.y.toFixed(3), ",", vStart.z.toFixed(3), ") ");
      // console.log("end:   (", vEnd.x.toFixed(3), ",", vEnd.y.toFixed(3), ",", vEnd.z.toFixed(3), ") ");

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

  console.log("Num lines for tile move speeds:", positions.length / 6);

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
  const arrowOffsetFactor = 0.01;
  const arrowHeadSize = 0.02;

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
        colors.push(0.6, 0.3, 0);
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
      case BoundaryType.OBLIQUE_DIVERGENT:
        colors.push(1, 0.5, 0); // Orange
        colors.push(1, 0.5, 0);
        dashOffsets.push(0, 0);
        dashScales.push(0, 0);
        break;
      case BoundaryType.OBLIQUE_CONVERGENT:
        colors.push(0, 1, 1); // Cyan
        colors.push(0, 1, 1);
        dashOffsets.push(0, 0);
        dashScales.push(0, 0);
        break;
    }

    const relativeMotionSpeed = bEdge.relativeMotionSpeed;
    // Draw an arrow indicating relative motion
    // The center of the arrow is at the midpoint of the boundary edge
    const originPos = vStart.clone().add(vEnd).multiplyScalar(0.5);
    const moveVector = relativeMotionSpeed.clone().multiplyScalar(0.1);

    const arrowEnd = originPos.clone().add(moveVector);
    const arrowStart = originPos.clone();
    arrowStart.add(moveVector.clone().multiplyScalar(-0.5));

    const moveDir = moveVector.clone().normalize();
    const arrowBase = arrowEnd.clone().sub(moveDir.clone().multiplyScalar(arrowHeadSize));
    const orthogonalVec1 = new THREE.Vector3().crossVectors(moveDir, new THREE.Vector3(0, 1, 0));
    if (orthogonalVec1.length() < 0.001) {
      orthogonalVec1.crossVectors(moveDir, new THREE.Vector3(1, 0, 0));
    }
    orthogonalVec1.normalize().multiplyScalar(arrowHeadSize * 0.5);
    const arrowPoint1 = arrowBase.clone().add(orthogonalVec1);
    const arrowPoint2 = arrowBase.clone().sub(orthogonalVec1);

    arrowStart.multiplyScalar(1 + arrowOffsetFactor);
    arrowEnd.multiplyScalar(1 + arrowOffsetFactor);
    arrowPoint1.multiplyScalar(1 + arrowOffsetFactor);
    arrowPoint2.multiplyScalar(1 + arrowOffsetFactor);

    positions.push(arrowStart.x, arrowStart.y, arrowStart.z);
    positions.push(arrowEnd.x, arrowEnd.y, arrowEnd.z);
    positions.push(arrowEnd.x, arrowEnd.y, arrowEnd.z);
    positions.push(arrowPoint1.x, arrowPoint1.y, arrowPoint1.z);
    positions.push(arrowEnd.x, arrowEnd.y, arrowEnd.z);
    positions.push(arrowPoint2.x, arrowPoint2.y, arrowPoint2.z);

    colors.push(1, 1, 0); // Yellow for motion arrows
    colors.push(1, 1, 0);
    colors.push(1, 1, 0);
    colors.push(1, 1, 0);
    colors.push(1, 1, 0);
    colors.push(1, 1, 0);

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

export {
  makeLineSegments2FromTile,
  makeLineSegments2FromPlate,
  makeLineSegments2ForTileMotionSpeed,
  makeLineSegments2FromBoundary
};
