import * as THREE from 'three';
import {
  QuadTreeCell,
  CubeFace,
  getGridSize,
} from './QuadTreeEncoding';
import {
  cubeToSphere,
  sphereToCube,
  CubeFace as CoreCubeFace,
} from '@core/geometry/EverettPraunMapping';

/**
 * Computes the center (barycenter) of a cell on the cube surface.
 * Returns a point on the cube face.
 */
export function computeCellCenter(cell: QuadTreeCell): THREE.Vector3 {
  const gridSize = getGridSize(cell.level);

  // Compute normalized coordinates in [-1, 1] for the cell center
  const u = -1 + (2 * (cell.x + 0.5)) / gridSize;
  const v = -1 + (2 * (cell.y + 0.5)) / gridSize;

  return faceUVToPoint(cell.face, u, v);
}

/**
 * Computes the center of a cell projected onto the sphere using Everett-Praun mapping.
 */
export function computeCellCenterOnSphere(cell: QuadTreeCell): THREE.Vector3 {
  const gridSize = getGridSize(cell.level);

  // Compute normalized coordinates in [-1, 1] for the cell center
  const u = -1 + (2 * (cell.x + 0.5)) / gridSize;
  const v = -1 + (2 * (cell.y + 0.5)) / gridSize;

  // Use Everett-Praun mapping for low-distortion projection
  return cubeToSphere(cell.face as CoreCubeFace, u, v);
}

/**
 * Computes the four corner vertices of a cell on the cube surface.
 * Returns vertices in order: bottom-left, bottom-right, top-right, top-left
 */
export function computeCellVertices(cell: QuadTreeCell): THREE.Vector3[] {
  const gridSize = getGridSize(cell.level);

  // Compute the four corners in UV space
  const u0 = -1 + (2 * cell.x) / gridSize;
  const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
  const v0 = -1 + (2 * cell.y) / gridSize;
  const v1 = -1 + (2 * (cell.y + 1)) / gridSize;

  return [
    faceUVToPoint(cell.face, u0, v0), // bottom-left
    faceUVToPoint(cell.face, u1, v0), // bottom-right
    faceUVToPoint(cell.face, u1, v1), // top-right
    faceUVToPoint(cell.face, u0, v1), // top-left
  ];
}

/**
 * Converts UV coordinates on a cube face to a 3D point on the cube surface.
 * UV coordinates are in [-1, 1] range.
 */
export function faceUVToPoint(face: CubeFace, u: number, v: number): THREE.Vector3 {
  switch (face) {
    case CubeFace.PLUS_X:
      return new THREE.Vector3(1, v, -u);  // +X face: Y=v, Z=-u
    case CubeFace.MINUS_X:
      return new THREE.Vector3(-1, v, u);  // -X face: Y=v, Z=u
    case CubeFace.PLUS_Y:
      return new THREE.Vector3(u, 1, v);   // +Y face: X=u, Z=v
    case CubeFace.MINUS_Y:
      return new THREE.Vector3(u, -1, -v); // -Y face: X=u, Z=-v
    case CubeFace.PLUS_Z:
      return new THREE.Vector3(u, v, 1);   // +Z face: X=u, Y=v
    case CubeFace.MINUS_Z:
      return new THREE.Vector3(-u, v, -1); // -Z face: X=-u, Y=v
    default:
      return new THREE.Vector3(0, 0, 0);
  }
}

/**
 * Converts a 3D point on the cube surface to face and UV coordinates.
 * Returns null if the point is not on any face.
 */
export function pointToFaceUV(point: THREE.Vector3): { face: CubeFace; u: number; v: number } | null {
  const ax = Math.abs(point.x);
  const ay = Math.abs(point.y);
  const az = Math.abs(point.z);
  const maxCoord = Math.max(ax, ay, az);

  if (maxCoord === 0) return null;

  // Normalize to cube surface
  const scale = 1 / maxCoord;
  const x = point.x * scale;
  const y = point.y * scale;
  const z = point.z * scale;

  // Determine which face based on the dominant axis
  if (ax >= ay && ax >= az) {
    if (point.x > 0) {
      return { face: CubeFace.PLUS_X, u: -z, v: y };
    } else {
      return { face: CubeFace.MINUS_X, u: z, v: y };
    }
  } else if (ay >= ax && ay >= az) {
    if (point.y > 0) {
      return { face: CubeFace.PLUS_Y, u: x, v: z };
    } else {
      return { face: CubeFace.MINUS_Y, u: x, v: -z };
    }
  } else {
    if (point.z > 0) {
      return { face: CubeFace.PLUS_Z, u: x, v: y };
    } else {
      return { face: CubeFace.MINUS_Z, u: -x, v: y };
    }
  }
}

/**
 * Converts a point on the sphere to the enclosing QuadTree cell at a given level.
 * Uses Everett-Praun inverse mapping for low-distortion UV coordinates.
 */
export function spherePointToCell(point: THREE.Vector3, level: number): QuadTreeCell | null {
  const maxCoord = Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z));
  if (maxCoord === 0) return null;

  // Use Everett-Praun inverse mapping to get face and UV coordinates
  const { face, u, v } = sphereToCube(point);

  // Convert UV in [-1, 1] to grid coordinates [0, gridSize)
  const gridSize = getGridSize(level);

  // UV is in [-1, 1], map to [0, gridSize)
  const x = Math.floor(((u + 1) / 2) * gridSize);
  const y = Math.floor(((v + 1) / 2) * gridSize);

  // Clamp to valid range
  const clampedX = Math.max(0, Math.min(gridSize - 1, x));
  const clampedY = Math.max(0, Math.min(gridSize - 1, y));

  return {
    face: face as CubeFace,
    level,
    x: clampedX,
    y: clampedY,
  };
}

/**
 * Checks if a point (on the cube surface) is inside a cell.
 */
export function isPointInCell(point: THREE.Vector3, cell: QuadTreeCell): boolean {
  const faceUV = pointToFaceUV(point);
  if (!faceUV || faceUV.face !== cell.face) {
    return false;
  }

  const { u, v } = faceUV;
  const gridSize = getGridSize(cell.level);

  // Compute cell bounds in UV space
  const u0 = -1 + (2 * cell.x) / gridSize;
  const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
  const v0 = -1 + (2 * cell.y) / gridSize;
  const v1 = -1 + (2 * (cell.y + 1)) / gridSize;

  return u >= u0 && u <= u1 && v >= v0 && v <= v1;
}
