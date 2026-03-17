/**
 * Projection module for ISEA3H Octahedron
 *
 * The ISEA3H octahedron has vertices at (±1,0,0), (0,±1,0), (0,0,±1).
 * This module provides functions to convert between octahedron surface
 * coordinates (from ISEA3H a,b,c encoding) and sphere coordinates using:
 *
 * - Snyder equal-area projection (preserves area)
 * - Simple normalization (L1 for sphere→octahedron, L2 for octahedron→sphere)
 * - Interpolation (symmetric slerp-based approach)
 */

import * as THREE from 'three';

// ─── Projection Mode ─────────────────────────────────────────────────────────

export type ProjectionMode = 'snyder' | 'normalization' | 'interpolation';

// Default projection mode
let currentProjectionMode: ProjectionMode = 'snyder';

/**
 * Sets the current projection mode.
 */
export function setProjectionMode(mode: ProjectionMode): void {
  currentProjectionMode = mode;
}

/** Gets the current projection mode. */
export function getProjectionMode(): ProjectionMode {
  return currentProjectionMode;
}
import {
  Vec3,
  snyderForward,
  snyderInverse,
} from '../../core/geometry/SynderOctahedron';

// ─── ISEA3H Octahedron face definitions ──────────────────────────────────────

/**
 * The 8 faces of the ISEA3H octahedron.
 * Each face is defined by three vertices in counter-clockwise order
 * when viewed from outside.
 *
 * The octahedron has vertices at:
 *   V0 = (1,0,0), V1 = (-1,0,0)
 *   V2 = (0,1,0), V3 = (0,-1,0)
 *   V4 = (0,0,1), V5 = (0,0,-1)
 *
 * Face layout by octant (signs of x, y, z):
 */
export const ISEA3H_FACES: Array<{ v0: Vec3; v1: Vec3; v2: Vec3; signs: [number, number, number] }> = [
  // Top hemisphere (z > 0)
  { v0: [0, 0, 1], v1: [1, 0, 0], v2: [0, 1, 0], signs: [1, 1, 1] },    // Face 0: +x, +y, +z
  { v0: [0, 0, 1], v1: [0, 1, 0], v2: [-1, 0, 0], signs: [-1, 1, 1] },  // Face 1: -x, +y, +z
  { v0: [0, 0, 1], v1: [-1, 0, 0], v2: [0, -1, 0], signs: [-1, -1, 1] }, // Face 2: -x, -y, +z
  { v0: [0, 0, 1], v1: [0, -1, 0], v2: [1, 0, 0], signs: [1, -1, 1] },  // Face 3: +x, -y, +z
  // Bottom hemisphere (z < 0)
  { v0: [0, 0, -1], v1: [0, 1, 0], v2: [1, 0, 0], signs: [1, 1, -1] },   // Face 4: +x, +y, -z
  { v0: [0, 0, -1], v1: [-1, 0, 0], v2: [0, 1, 0], signs: [-1, 1, -1] }, // Face 5: -x, +y, -z
  { v0: [0, 0, -1], v1: [0, -1, 0], v2: [-1, 0, 0], signs: [-1, -1, -1] }, // Face 6: -x, -y, -z
  { v0: [0, 0, -1], v1: [1, 0, 0], v2: [0, -1, 0], signs: [1, -1, -1] }, // Face 7: +x, -y, -z
];

// ─── Face lookup ──────────────────────────────────────────────────────────────

/**
 * Find which face of the ISEA3H octahedron a point belongs to.
 * Based on the signs of the coordinates.
 */
export function findISEA3HFace(x: number, y: number, z: number): number {
  const sx = x >= 0 ? 1 : -1;
  const sy = y >= 0 ? 1 : -1;
  const sz = z >= 0 ? 1 : -1;

  for (let i = 0; i < ISEA3H_FACES.length; i++) {
    const [fx, fy, fz] = ISEA3H_FACES[i].signs;
    if (fx === sx && fy === sy && fz === sz) {
      return i;
    }
  }
  return 0; // Fallback
}

// ─── Coordinate conversion ────────────────────────────────────────────────────

/**
 * Converts a point on the ISEA3H octahedron surface to a point on the unit sphere
 * using the Snyder equal-area projection.
 *
 * @param octPoint - Point on the octahedron surface (x, y, z with |x|+|y|+|z| = 1)
 * @returns Point on the unit sphere
 */
export function octahedronToSphere(octPoint: THREE.Vector3): THREE.Vector3 {
  const x = octPoint.x;
  const y = octPoint.y;
  const z = octPoint.z;

  // Find which face this point belongs to
  const faceIndex = findISEA3HFace(x, y, z);
  const face = ISEA3H_FACES[faceIndex];

  // Normalize the point to ensure it's on the octahedron surface
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (sum < 1e-10) {
    return new THREE.Vector3(0, 0, 1); // Degenerate case
  }

  // The point on the octahedron surface
  const octVec: Vec3 = [x / sum, y / sum, z / sum];

  // Convert octahedron point to barycentric coordinates relative to the face
  // The octahedron point is a linear combination of the face vertices
  const bary = octahedronPointToBarycentric(octVec, face);

  // Use Snyder inverse projection to get sphere point
  const sphereVec = snyderInverse(bary[0], bary[1], bary[2], face.v0, face.v1, face.v2);

  return new THREE.Vector3(sphereVec[0], sphereVec[1], sphereVec[2]);
}

/**
 * Converts a point on the unit sphere to a point on the ISEA3H octahedron surface
 * using the Snyder equal-area projection.
 *
 * @param spherePoint - Point on the unit sphere
 * @returns Point on the octahedron surface (with |x|+|y|+|z| = 1)
 */
export function sphereToOctahedron(spherePoint: THREE.Vector3): THREE.Vector3 {
  const v: Vec3 = [spherePoint.x, spherePoint.y, spherePoint.z];

  // Find which face this sphere point belongs to (same octant logic)
  const faceIndex = findISEA3HFace(v[0], v[1], v[2]);
  const face = ISEA3H_FACES[faceIndex];

  // Use Snyder forward projection to get barycentric coordinates
  const bary = snyderForward(v, face.v0, face.v1, face.v2);

  // Convert barycentric to octahedron point
  const octVec = barycentricToOctahedronPoint(bary, face);

  return new THREE.Vector3(octVec[0], octVec[1], octVec[2]);
}

/**
 * Convert octahedron point to barycentric coordinates relative to face vertices.
 */
function octahedronPointToBarycentric(
  p: Vec3,
  face: { v0: Vec3; v1: Vec3; v2: Vec3 }
): [number, number, number] {
  // For the ISEA3H octahedron, the face vertices are axis-aligned unit vectors.
  // The barycentric coordinates can be computed using the absolute values.
  //
  // For a face with vertices v0, v1, v2 (each being a unit axis vector),
  // a point p = β0*v0 + β1*v1 + β2*v2 where β0 + β1 + β2 = 1
  //
  // Since each vertex has only one non-zero component:
  // - v0's component gives β0
  // - v1's component gives β1
  // - v2's component gives β2

  // Find which component each vertex contributes
  const beta0 = p[0]*face.v0[0] + p[1]*face.v0[1] + p[2]*face.v0[2];
  const beta1 = p[0]*face.v1[0] + p[1]*face.v1[1] + p[2]*face.v1[2];
  const beta2 = p[0]*face.v2[0] + p[1]*face.v2[1] + p[2]*face.v2[2];

  return [beta0, beta1, beta2];
}

/**
 * Convert barycentric coordinates to octahedron point.
 */
function barycentricToOctahedronPoint(
  bary: [number, number, number],
  face: { v0: Vec3; v1: Vec3; v2: Vec3 }
): Vec3 {
  const { v0, v1, v2 } = face;
  const [b0, b1, b2] = bary;

  return [
    b0 * v0[0] + b1 * v1[0] + b2 * v2[0],
    b0 * v0[1] + b1 * v1[1] + b2 * v2[1],
    b0 * v0[2] + b1 * v1[2] + b2 * v2[2],
  ];
}

/**
 * Projects a point onto the sphere using Snyder projection, with optional offset.
 * This is the main function to use for ISEA3H visualization.
 */
export function projectToSphereSnyder(
  octPoint: THREE.Vector3,
  offset: number = 0
): THREE.Vector3 {
  const spherePoint = octahedronToSphere(octPoint);

  if (offset !== 0) {
    // Apply offset by scaling the normalized point
    spherePoint.normalize().multiplyScalar(1 + offset);
  }

  return spherePoint;
}

/**
 * Interpolates along a great arc between two points on the sphere.
 * Both input points should be on the octahedron surface and will be
 * projected to the sphere first.
 */
export function interpolateGreatArcSnyder(
  startOct: THREE.Vector3,
  endOct: THREE.Vector3,
  segments: number,
  offset: number = 0
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  const startSphere = octahedronToSphere(startOct);
  const endSphere = octahedronToSphere(endOct);

  // Normalize to ensure unit vectors
  startSphere.normalize();
  endSphere.normalize();

  // Calculate angle between vectors
  const dot = Math.max(-1, Math.min(1, startSphere.dot(endSphere)));
  const angle = Math.acos(dot);

  // If points are very close, just return start and end
  if (angle < 0.0001) {
    const p1 = startSphere.clone().multiplyScalar(1 + offset);
    const p2 = endSphere.clone().multiplyScalar(1 + offset);
    return [p1, p2];
  }

  // Spherical linear interpolation (slerp)
  const sinAngle = Math.sin(angle);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.sin((1 - t) * angle) / sinAngle;
    const b = Math.sin(t * angle) / sinAngle;

    const point = new THREE.Vector3(
      a * startSphere.x + b * endSphere.x,
      a * startSphere.y + b * endSphere.y,
      a * startSphere.z + b * endSphere.z
    );

    // Apply offset
    point.normalize().multiplyScalar(1 + offset);
    points.push(point);
  }

  return points;
}

// ─── Normalization Projection ────────────────────────────────────────────────

/**
 * Converts a point on the ISEA3H octahedron surface to a point on the unit sphere
 * using simple L2 normalization.
 *
 * @param octPoint - Point on the octahedron surface (x, y, z with |x|+|y|+|z| = 1)
 * @returns Point on the unit sphere (x² + y² + z² = 1)
 */
export function octahedronToSphereNormalization(octPoint: THREE.Vector3): THREE.Vector3 {
  // Simply normalize using L2 norm
  const result = octPoint.clone();
  result.normalize();
  return result;
}

/**
 * Converts a point on the unit sphere to a point on the ISEA3H octahedron surface
 * using L1 normalization.
 *
 * @param spherePoint - Point on the unit sphere (x² + y² + z² = 1)
 * @returns Point on the octahedron surface (|x| + |y| + |z| = 1)
 */
export function sphereToOctahedronNormalization(spherePoint: THREE.Vector3): THREE.Vector3 {
  const x = spherePoint.x;
  const y = spherePoint.y;
  const z = spherePoint.z;

  // L1 normalization: divide by |x| + |y| + |z|
  const l1Norm = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (l1Norm < 1e-10) {
    return new THREE.Vector3(1, 0, 0); // Degenerate case
  }

  return new THREE.Vector3(x / l1Norm, y / l1Norm, z / l1Norm);
}

/**
 * Projects a point onto the sphere using simple L2 normalization, with optional offset.
 */
export function projectToSphereNormalization(
  octPoint: THREE.Vector3,
  offset: number = 0
): THREE.Vector3 {
  const spherePoint = octahedronToSphereNormalization(octPoint);

  if (offset !== 0) {
    spherePoint.multiplyScalar(1 + offset);
  }

  return spherePoint;
}

/**
 * Interpolates along a great arc between two points on the sphere.
 * Uses L2 normalization for projection.
 */
export function interpolateGreatArcNormalization(
  startOct: THREE.Vector3,
  endOct: THREE.Vector3,
  segments: number,
  offset: number = 0
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  const startSphere = octahedronToSphereNormalization(startOct);
  const endSphere = octahedronToSphereNormalization(endOct);

  // Calculate angle between vectors
  const dot = Math.max(-1, Math.min(1, startSphere.dot(endSphere)));
  const angle = Math.acos(dot);

  // If points are very close, just return start and end
  if (angle < 0.0001) {
    const p1 = startSphere.clone().multiplyScalar(1 + offset);
    const p2 = endSphere.clone().multiplyScalar(1 + offset);
    return [p1, p2];
  }

  // Spherical linear interpolation (slerp)
  const sinAngle = Math.sin(angle);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.sin((1 - t) * angle) / sinAngle;
    const b = Math.sin(t * angle) / sinAngle;

    const point = new THREE.Vector3(
      a * startSphere.x + b * endSphere.x,
      a * startSphere.y + b * endSphere.y,
      a * startSphere.z + b * endSphere.z
    );

    // Apply offset
    point.normalize().multiplyScalar(1 + offset);
    points.push(point);
  }

  return points;
}

// ─── Interpolation Projection ────────────────────────────────────────────────

/**
 * Spherical linear interpolation between two unit vectors.
 */
function slerp(v1: THREE.Vector3, v2: THREE.Vector3, t: number): THREE.Vector3 {
  // Ensure unit vectors
  const a = v1.clone().normalize();
  const b = v2.clone().normalize();

  // Calculate angle between vectors
  let dot = Math.max(-1, Math.min(1, a.dot(b)));

  // If vectors are nearly identical or opposite, use linear interpolation
  if (Math.abs(dot) > 0.9999) {
    const result = a.clone().lerp(b, t);
    return result.normalize();
  }

  const angle = Math.acos(dot);
  const sinAngle = Math.sin(angle);

  const ratioA = Math.sin((1 - t) * angle) / sinAngle;
  const ratioB = Math.sin(t * angle) / sinAngle;

  return new THREE.Vector3(
    ratioA * a.x + ratioB * b.x,
    ratioA * a.y + ratioB * b.y,
    ratioA * a.z + ratioB * b.z
  );
}

/**
 * Converts a point on the ISEA3H octahedron surface to a point on the unit sphere
 * using symmetric slerp interpolation.
 *
 * Algorithm:
 * 1. Compute edge interpolation points using slerp at barycentric ratios
 * 2. From each edge point, slerp toward the opposite vertex
 * 3. Average and normalize the results
 *
 * @param octPoint - Point on the octahedron surface (x, y, z with |x|+|y|+|z| = 1)
 * @returns Point on the unit sphere
 */
export function octahedronToSphereInterpolation(octPoint: THREE.Vector3): THREE.Vector3 {
  const x = octPoint.x;
  const y = octPoint.y;
  const z = octPoint.z;

  // Find which face this point belongs to
  const faceIndex = findISEA3HFace(x, y, z);
  const face = ISEA3H_FACES[faceIndex];

  // Normalize the point to ensure it's on the octahedron surface
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (sum < 1e-10) {
    return new THREE.Vector3(0, 0, 1); // Degenerate case
  }

  // The point on the octahedron surface
  const octVec: Vec3 = [x / sum, y / sum, z / sum];

  // Get barycentric coordinates (u, v, w) relative to face vertices
  const bary = octahedronPointToBarycentric(octVec, face);
  const [u, v, w] = bary;

  // Convert face vertices to THREE.Vector3 (already normalized on unit sphere)
  const A = new THREE.Vector3(face.v0[0], face.v0[1], face.v0[2]);
  const B = new THREE.Vector3(face.v1[0], face.v1[1], face.v1[2]);
  const C = new THREE.Vector3(face.v2[0], face.v2[1], face.v2[2]);

  // Handle edge cases where barycentric coordinates sum to zero in denominator
  const eps = 1e-10;

  // Step 1: Compute edge interpolation points
  // D_BC -- point on edge BC
  const vw = v + w;
  const D_BC = vw > eps ? slerp(B, C, w / vw) : A.clone();

  // D_AC -- point on edge AC
  const uw = u + w;
  const D_CA = uw > eps ? slerp(C, A, u / uw) : B.clone();

  // D_AB -- point on edge AB
  const uv = u + v;
  const D_AB = uv > eps ? slerp(A, B, v / uv) : C.clone();

  // Step 2: From each edge point, slerp toward opposite vertex
  const P_A = slerp(D_BC, A, u);
  const P_B = slerp(D_CA, B, v);
  const P_C = slerp(D_AB, C, w);

  // Step 3: Average and normalize
  const result = new THREE.Vector3(
    P_A.x + P_B.x + P_C.x,
    P_A.y + P_B.y + P_C.y,
    P_A.z + P_B.z + P_C.z
  );

  return result.normalize();
}

/**
 * Converts a point on the unit sphere to a point on the ISEA3H octahedron surface
 * using inverse interpolation (approximation via L1 normalization).
 *
 * Note: The exact inverse of the interpolation projection is complex.
 * We use L1 normalization as a reasonable approximation.
 *
 * @param spherePoint - Point on the unit sphere
 * @returns Point on the octahedron surface (|x| + |y| + |z| = 1)
 */
export function sphereToOctahedronInterpolation(spherePoint: THREE.Vector3): THREE.Vector3 {
  // Use L1 normalization as approximation for inverse
  return sphereToOctahedronNormalization(spherePoint);
}

/**
 * Projects a point onto the sphere using interpolation, with optional offset.
 */
export function projectToSphereInterpolation(
  octPoint: THREE.Vector3,
  offset: number = 0
): THREE.Vector3 {
  const spherePoint = octahedronToSphereInterpolation(octPoint);

  if (offset !== 0) {
    spherePoint.multiplyScalar(1 + offset);
  }

  return spherePoint;
}

/**
 * Interpolates along a great arc between two points on the sphere.
 * Uses interpolation projection for octahedron-to-sphere conversion.
 */
export function interpolateGreatArcInterpolation(
  startOct: THREE.Vector3,
  endOct: THREE.Vector3,
  segments: number,
  offset: number = 0
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  const startSphere = octahedronToSphereInterpolation(startOct);
  const endSphere = octahedronToSphereInterpolation(endOct);

  // Calculate angle between vectors
  const dot = Math.max(-1, Math.min(1, startSphere.dot(endSphere)));
  const angle = Math.acos(dot);

  // If points are very close, just return start and end
  if (angle < 0.0001) {
    const p1 = startSphere.clone().multiplyScalar(1 + offset);
    const p2 = endSphere.clone().multiplyScalar(1 + offset);
    return [p1, p2];
  }

  // Spherical linear interpolation
  const sinAngle = Math.sin(angle);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.sin((1 - t) * angle) / sinAngle;
    const b = Math.sin(t * angle) / sinAngle;

    const point = new THREE.Vector3(
      a * startSphere.x + b * endSphere.x,
      a * startSphere.y + b * endSphere.y,
      a * startSphere.z + b * endSphere.z
    );

    // Apply offset
    point.normalize().multiplyScalar(1 + offset);
    points.push(point);
  }

  return points;
}

// ─── Unified API (uses current projection mode) ──────────────────────────────

/**
 * Projects a point from octahedron to sphere using the current projection mode.
 */
export function projectToSphere(
  octPoint: THREE.Vector3,
  offset: number = 0
): THREE.Vector3 {
  switch (currentProjectionMode) {
    case 'normalization':
      return projectToSphereNormalization(octPoint, offset);
    case 'interpolation':
      return projectToSphereInterpolation(octPoint, offset);
    case 'snyder':
    default:
      return projectToSphereSnyder(octPoint, offset);
  }
}

/**
 * Projects a point from sphere to octahedron using the current projection mode.
 */
export function projectToOctahedron(spherePoint: THREE.Vector3): THREE.Vector3 {
  switch (currentProjectionMode) {
    case 'normalization':
      return sphereToOctahedronNormalization(spherePoint);
    case 'interpolation':
      return sphereToOctahedronInterpolation(spherePoint);
    case 'snyder':
    default:
      return sphereToOctahedron(spherePoint);
  }
}

/**
 * Interpolates along a great arc using the current projection mode.
 */
export function interpolateGreatArc(
  startOct: THREE.Vector3,
  endOct: THREE.Vector3,
  segments: number,
  offset: number = 0
): THREE.Vector3[] {
  switch (currentProjectionMode) {
    case 'normalization':
      return interpolateGreatArcNormalization(startOct, endOct, segments, offset);
    case 'interpolation':
      return interpolateGreatArcInterpolation(startOct, endOct, segments, offset);
    case 'snyder':
    default:
      return interpolateGreatArcSnyder(startOct, endOct, segments, offset);
  }
}
