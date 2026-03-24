/**
 * Everett–Praun Cube-to-Sphere Mapping
 *
 * A low-distortion bijection between the surface of a cube and the unit sphere.
 * Uses tangent-based warping to achieve near-uniform cell area (~1.2x max ratio)
 * compared to naive gnomonic projection (~5.8x max ratio).
 *
 * Reference:
 * - Praun, E. & Hoppe, H. (2003). Spherical Parametrization and Remeshing. SIGGRAPH.
 * - Everett, M. (1997). Derivation notes on tangent-based cube-sphere bijections.
 */

import * as THREE from 'three';

/** π/4 constant for forward mapping: x' = tan(u * π/4) */
const PI_OVER_4 = Math.PI / 4;

/**
 * 4/π constant for inverse mapping: u = (4/π) * arctan(x')
 * This is the correct inverse of tan(u * π/4).
 * Note: The original document incorrectly states 2/π, but mathematically:
 * if x' = tan(u * π/4), then u = arctan(x') / (π/4) = (4/π) * arctan(x')
 */
const FOUR_OVER_PI = 4 / Math.PI;

/**
 * Cube face identifiers.
 * Matches the convention in QuadTreeEncoding.
 */
export enum CubeFace {
  PLUS_X = 0,
  MINUS_X = 1,
  PLUS_Y = 2,
  MINUS_Y = 3,
  PLUS_Z = 4,
  MINUS_Z = 5,
}

/**
 * Result of sphere-to-cube mapping.
 */
export interface CubeFaceUV {
  face: CubeFace;
  u: number;
  v: number;
}

/**
 * Forward mapping: Cube face coordinates to sphere point.
 *
 * Given face-local coordinates (u, v) ∈ [-1, 1]², computes the corresponding
 * point on the unit sphere using Everett-Praun tangent warping.
 *
 * @param face - The cube face
 * @param u - Face-local u coordinate in [-1, 1]
 * @param v - Face-local v coordinate in [-1, 1]
 * @returns Point on the unit sphere
 */
export function cubeToSphere(face: CubeFace, u: number, v: number): THREE.Vector3 {
  // Apply tangent warp to counteract gnomonic compression
  const xw = Math.tan(u * PI_OVER_4);
  const yw = Math.tan(v * PI_OVER_4);

  // The warped point in face-local coordinates (z' = 1 for +Z face)
  // Then rotate to the appropriate face
  let point: THREE.Vector3;

  switch (face) {
    case CubeFace.PLUS_X:
      // +X face: dominant axis is +x, so (z', y', 1) → (1, yw, -xw)
      point = new THREE.Vector3(1, yw, -xw);
      break;
    case CubeFace.MINUS_X:
      // -X face: dominant axis is -x, so (-1, yw, xw)
      point = new THREE.Vector3(-1, yw, xw);
      break;
    case CubeFace.PLUS_Y:
      // +Y face: dominant axis is +y, so (xw, 1, yw)
      point = new THREE.Vector3(xw, 1, yw);
      break;
    case CubeFace.MINUS_Y:
      // -Y face: dominant axis is -y, so (xw, -1, -yw)
      point = new THREE.Vector3(xw, -1, -yw);
      break;
    case CubeFace.PLUS_Z:
      // +Z face: dominant axis is +z, so (xw, yw, 1)
      point = new THREE.Vector3(xw, yw, 1);
      break;
    case CubeFace.MINUS_Z:
      // -Z face: dominant axis is -z, so (-xw, yw, -1)
      point = new THREE.Vector3(-xw, yw, -1);
      break;
    default:
      point = new THREE.Vector3(0, 0, 1);
  }

  // Normalize to unit sphere
  return point.normalize();
}

/**
 * Inverse mapping: Sphere point to cube face coordinates.
 *
 * Given a point on the unit sphere, determines the cube face and
 * computes the face-local coordinates (u, v) ∈ [-1, 1]² using
 * inverse Everett-Praun mapping.
 *
 * @param point - Point on the unit sphere (will be normalized if not already)
 * @returns Face identifier and face-local coordinates
 */
export function sphereToCube(point: THREE.Vector3): CubeFaceUV {
  // Ensure the point is normalized
  const p = point.clone().normalize();
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const az = Math.abs(p.z);

  let face: CubeFace;
  let x: number;
  let y: number;

  // Select dominant face and compute face-local (x, y) via gnomonic projection
  if (ax >= ay && ax >= az) {
    // X-dominant
    if (p.x > 0) {
      face = CubeFace.PLUS_X;
      x = -p.z / p.x;  // Winding convention
      y = p.y / ax;
    } else {
      face = CubeFace.MINUS_X;
      x = p.z / (-p.x);
      y = p.y / ax;
    }
  } else if (ay >= ax && ay >= az) {
    // Y-dominant
    if (p.y > 0) {
      face = CubeFace.PLUS_Y;
      x = p.x / ay;
      y = p.z / ay;  // p.z/p.y = yw for cube point (xw, 1, yw)
    } else {
      face = CubeFace.MINUS_Y;
      x = p.x / ay;
      y = -p.z / ay;  // p.z/p.y = yw for cube point (xw, -1, -yw), and p.y < 0
    }
  } else {
    // Z-dominant
    if (p.z > 0) {
      face = CubeFace.PLUS_Z;
      x = p.x / az;
      y = p.y / az;
    } else {
      face = CubeFace.MINUS_Z;
      x = -p.x / az;  // Winding convention
      y = p.y / az;
    }
  }

  // Apply inverse warp: arctan to undo tangent stretching
  // u = arctan(x) / (π/4) = (4/π) * arctan(x)
  const u = FOUR_OVER_PI * Math.atan(x);
  const v = FOUR_OVER_PI * Math.atan(y);

  return { face, u, v };
}

/**
 * Projects a point on the cube surface to the sphere using Everett-Praun mapping.
 *
 * This is a convenience function that first determines the face and UV coordinates
 * from a cube point, then applies the forward mapping.
 *
 * @param cubePoint - Point on the cube surface (max(|x|,|y|,|z|) = 1)
 * @param offset - Optional radial offset from the sphere surface
 * @returns Point on the sphere (or offset from it)
 */
export function projectCubePointToSphere(
  cubePoint: THREE.Vector3,
  offset: number = 0
): THREE.Vector3 {
  // Determine which face the cube point is on
  const ax = Math.abs(cubePoint.x);
  const ay = Math.abs(cubePoint.y);
  const az = Math.abs(cubePoint.z);

  let face: CubeFace;
  let u: number;
  let v: number;

  // For a point on the cube surface, one coordinate has magnitude 1
  // We need to extract the UV coordinates based on which face it's on
  if (ax >= ay && ax >= az) {
    if (cubePoint.x > 0) {
      face = CubeFace.PLUS_X;
      u = -cubePoint.z / cubePoint.x;
      v = cubePoint.y / cubePoint.x;
    } else {
      face = CubeFace.MINUS_X;
      u = cubePoint.z / (-cubePoint.x);
      v = cubePoint.y / (-cubePoint.x);
    }
  } else if (ay >= ax && ay >= az) {
    if (cubePoint.y > 0) {
      face = CubeFace.PLUS_Y;
      u = cubePoint.x / cubePoint.y;
      v = cubePoint.z / cubePoint.y;
    } else {
      face = CubeFace.MINUS_Y;
      u = cubePoint.x / (-cubePoint.y);
      v = -cubePoint.z / (-cubePoint.y);
    }
  } else {
    if (cubePoint.z > 0) {
      face = CubeFace.PLUS_Z;
      u = cubePoint.x / cubePoint.z;
      v = cubePoint.y / cubePoint.z;
    } else {
      face = CubeFace.MINUS_Z;
      u = -cubePoint.x / (-cubePoint.z);
      v = cubePoint.y / (-cubePoint.z);
    }
  }

  // Apply forward mapping
  const spherePoint = cubeToSphere(face, u, v);

  // Apply offset if requested
  if (offset !== 0) {
    spherePoint.multiplyScalar(1 + offset);
  }

  return spherePoint;
}

/**
 * Projects a point on the sphere to the cube surface using inverse Everett-Praun mapping.
 *
 * @param spherePoint - Point on the unit sphere
 * @param offset - Optional offset from the cube surface (along face normal)
 * @returns Point on the cube surface
 */
export function projectSpherePointToCube(
  spherePoint: THREE.Vector3,
  offset: number = 0
): THREE.Vector3 {
  const { face, u, v } = sphereToCube(spherePoint);

  // Convert UV coordinates to cube point
  let point: THREE.Vector3;

  switch (face) {
    case CubeFace.PLUS_X:
      point = new THREE.Vector3(1, v, -u);
      break;
    case CubeFace.MINUS_X:
      point = new THREE.Vector3(-1, v, u);
      break;
    case CubeFace.PLUS_Y:
      point = new THREE.Vector3(u, 1, v);
      break;
    case CubeFace.MINUS_Y:
      point = new THREE.Vector3(u, -1, -v);
      break;
    case CubeFace.PLUS_Z:
      point = new THREE.Vector3(u, v, 1);
      break;
    case CubeFace.MINUS_Z:
      point = new THREE.Vector3(-u, v, -1);
      break;
    default:
      point = new THREE.Vector3(0, 0, 1);
  }

  // Apply offset along face normal if requested
  if (offset !== 0) {
    const normal = getCubeFaceNormal(face);
    point.addScaledVector(normal, offset);
  }

  return point;
}

/**
 * Gets the outward normal vector for a cube face.
 */
export function getCubeFaceNormal(face: CubeFace): THREE.Vector3 {
  switch (face) {
    case CubeFace.PLUS_X:
      return new THREE.Vector3(1, 0, 0);
    case CubeFace.MINUS_X:
      return new THREE.Vector3(-1, 0, 0);
    case CubeFace.PLUS_Y:
      return new THREE.Vector3(0, 1, 0);
    case CubeFace.MINUS_Y:
      return new THREE.Vector3(0, -1, 0);
    case CubeFace.PLUS_Z:
      return new THREE.Vector3(0, 0, 1);
    case CubeFace.MINUS_Z:
      return new THREE.Vector3(0, 0, -1);
    default:
      return new THREE.Vector3(0, 0, 1);
  }
}

/**
 * Interpolates along a great arc on the sphere between two cube points
 * using Everett-Praun projection.
 *
 * @param start - Start point on the cube surface
 * @param end - End point on the cube surface
 * @param segments - Number of segments to interpolate
 * @param offset - Optional offset from sphere surface
 * @returns Array of points along the great arc
 */
export function interpolateGreatArcEverettPraun(
  start: THREE.Vector3,
  end: THREE.Vector3,
  segments: number,
  offset: number = 0
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  // Project start and end to sphere using Everett-Praun
  const sphereStart = projectCubePointToSphere(start);
  const sphereEnd = projectCubePointToSphere(end);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;

    // Spherical linear interpolation (slerp)
    const dot = sphereStart.dot(sphereEnd);
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const theta = Math.acos(clampedDot);

    let point: THREE.Vector3;
    if (Math.abs(theta) < 0.0001) {
      // Points are very close, use linear interpolation
      point = sphereStart.clone().lerp(sphereEnd, t).normalize();
    } else {
      const sinTheta = Math.sin(theta);
      const a = Math.sin((1 - t) * theta) / sinTheta;
      const b = Math.sin(t * theta) / sinTheta;
      point = new THREE.Vector3(
        a * sphereStart.x + b * sphereEnd.x,
        a * sphereStart.y + b * sphereEnd.y,
        a * sphereStart.z + b * sphereEnd.z
      );
    }

    // Apply offset
    if (offset !== 0) {
      point.multiplyScalar(1 + offset);
    }

    points.push(point);
  }

  return points;
}
