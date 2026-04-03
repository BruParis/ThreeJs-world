/**
 * Geometric operations on QuadTree cells.
 *
 * Converts cell coordinates to 3D positions on the cube or sphere surface.
 * Depends on Three.js for vector math and on SphereProjection for cube→sphere mapping.
 */

import * as THREE from 'three';
import { QuadTreeCell, CubeFace, getGridSize } from './QuadTreeEncoding';
import {
  ProjectionManager,
  CubeFace as CoreCubeFace,
} from '@core/geometry/SphereProjection';

/**
 * Computes the center (barycenter) of a cell on the cube surface.
 */
export function computeCellCenter(cell: QuadTreeCell): THREE.Vector3 {
  const gridSize = getGridSize(cell.level);
  const u = -1 + (2 * (cell.x + 0.5)) / gridSize;
  const v = -1 + (2 * (cell.y + 0.5)) / gridSize;
  return faceUVToPoint(cell.face, u, v);
}

/**
 * Computes the center of a cell projected onto the sphere using the current projection.
 */
export function computeCellCenterOnSphere(cell: QuadTreeCell): THREE.Vector3 {
  const gridSize = getGridSize(cell.level);
  const u = -1 + (2 * (cell.x + 0.5)) / gridSize;
  const v = -1 + (2 * (cell.y + 0.5)) / gridSize;
  return ProjectionManager.cubeToSphere(cell.face as CoreCubeFace, u, v);
}

/**
 * Computes the four corner vertices of a cell on the cube surface.
 * Order: bottom-left, bottom-right, top-right, top-left.
 */
export function computeCellVertices(cell: QuadTreeCell): THREE.Vector3[] {
  const gridSize = getGridSize(cell.level);
  const u0 = -1 + (2 * cell.x) / gridSize;
  const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
  const v0 = -1 + (2 * cell.y) / gridSize;
  const v1 = -1 + (2 * (cell.y + 1)) / gridSize;

  return [
    faceUVToPoint(cell.face, u0, v0),
    faceUVToPoint(cell.face, u1, v0),
    faceUVToPoint(cell.face, u1, v1),
    faceUVToPoint(cell.face, u0, v1),
  ];
}

/**
 * Computes the four corner vertices of a cell projected onto the sphere.
 * Order: bottom-left, bottom-right, top-right, top-left.
 */
export function computeCellVerticesOnSphere(cell: QuadTreeCell): THREE.Vector3[] {
  const gridSize = getGridSize(cell.level);
  const u0 = -1 + (2 * cell.x) / gridSize;
  const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
  const v0 = -1 + (2 * cell.y) / gridSize;
  const v1 = -1 + (2 * (cell.y + 1)) / gridSize;

  return [
    ProjectionManager.cubeToSphere(cell.face as CoreCubeFace, u0, v0),
    ProjectionManager.cubeToSphere(cell.face as CoreCubeFace, u1, v0),
    ProjectionManager.cubeToSphere(cell.face as CoreCubeFace, u1, v1),
    ProjectionManager.cubeToSphere(cell.face as CoreCubeFace, u0, v1),
  ];
}

/**
 * Converts UV coordinates on a cube face to a 3D point on the cube surface.
 * UV coordinates are in [-1, 1] range.
 */
export function faceUVToPoint(face: CubeFace, u: number, v: number): THREE.Vector3 {
  switch (face) {
    case CubeFace.PLUS_X:  return new THREE.Vector3(1,  v, -u);
    case CubeFace.MINUS_X: return new THREE.Vector3(-1, v,  u);
    case CubeFace.PLUS_Y:  return new THREE.Vector3(u,  1,  v);
    case CubeFace.MINUS_Y: return new THREE.Vector3(u, -1, -v);
    case CubeFace.PLUS_Z:  return new THREE.Vector3(u,  v,  1);
    case CubeFace.MINUS_Z: return new THREE.Vector3(-u, v, -1);
    default:               return new THREE.Vector3(0,  0,  0);
  }
}

/**
 * Converts a 3D point on the cube surface to face and UV coordinates.
 * Returns null if the point is at the origin.
 */
export function pointToFaceUV(point: THREE.Vector3): { face: CubeFace; u: number; v: number } | null {
  const ax = Math.abs(point.x);
  const ay = Math.abs(point.y);
  const az = Math.abs(point.z);
  const maxCoord = Math.max(ax, ay, az);

  if (maxCoord === 0) return null;

  const scale = 1 / maxCoord;
  const x = point.x * scale;
  const y = point.y * scale;
  const z = point.z * scale;

  if (ax >= ay && ax >= az) {
    return point.x > 0
      ? { face: CubeFace.PLUS_X,  u: -z, v: y }
      : { face: CubeFace.MINUS_X, u:  z, v: y };
  } else if (ay >= ax && ay >= az) {
    return point.y > 0
      ? { face: CubeFace.PLUS_Y,  u: x, v:  z }
      : { face: CubeFace.MINUS_Y, u: x, v: -z };
  } else {
    return point.z > 0
      ? { face: CubeFace.PLUS_Z,  u:  x, v: y }
      : { face: CubeFace.MINUS_Z, u: -x, v: y };
  }
}

/**
 * Converts a point on the sphere to the enclosing QuadTree cell at a given level.
 * Uses the current projection's inverse mapping for UV coordinates.
 */
export function spherePointToCell(point: THREE.Vector3, level: number): QuadTreeCell | null {
  const maxCoord = Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z));
  if (maxCoord === 0) return null;

  const { face, u, v } = ProjectionManager.sphereToCube(point);

  const gridSize = getGridSize(level);
  const x = Math.floor(((u + 1) / 2) * gridSize);
  const y = Math.floor(((v + 1) / 2) * gridSize);

  return {
    face: face as CubeFace,
    level,
    x: Math.max(0, Math.min(gridSize - 1, x)),
    y: Math.max(0, Math.min(gridSize - 1, y)),
  };
}

/**
 * Checks if a point (on the cube surface) is inside a cell.
 */
export function isPointInCell(point: THREE.Vector3, cell: QuadTreeCell): boolean {
  const faceUV = pointToFaceUV(point);
  if (!faceUV || faceUV.face !== cell.face) return false;

  const { u, v } = faceUV;
  const gridSize = getGridSize(cell.level);
  const u0 = -1 + (2 * cell.x) / gridSize;
  const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
  const v0 = -1 + (2 * cell.y) / gridSize;
  const v1 = -1 + (2 * (cell.y + 1)) / gridSize;

  return u >= u0 && u <= u1 && v >= v0 && v <= v1;
}
