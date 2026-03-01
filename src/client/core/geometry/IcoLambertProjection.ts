/**
 * Icosahedral Lambert Azimuthal Equal-Area Projection
 *
 * Maps points on a unit sphere to/from 2D coordinates on the faces of an
 * inscribed icosahedron, preserving area across the entire sphere.
 *
 * Core idea:
 *   Each icosahedron face defines a local coordinate frame (n, e1, e2) where
 *   n is the face centroid direction (unit normal) and e1/e2 are tangent axes.
 *   A sphere point is expressed as an angular distance z from the face center
 *   and an azimuth theta around it.
 *
 *   The equal-area radial mapping is the Lambert azimuthal formula:
 *       rho = 2 * sin(z/2)
 *   which ensures that equal solid angles on the sphere map to equal areas
 *   on the plane. The azimuth theta is preserved unchanged.
 *
 *   The inverse is fully closed-form:
 *       z = 2 * arcsin(rho/2)
 */

import { Vector3 } from 'three';
import { ICOSAHEDRON_VERTICES, ICOSAHEDRON_FACES } from './Icosahedron';

// ---------------------------------------------------------------------------
// Face descriptor type
// ---------------------------------------------------------------------------

export interface IcoFace {
  /** Unit vector pointing to the face center on the sphere */
  centroid: Vector3;
  /** First orthonormal tangent vector in the face plane */
  e1: Vector3;
  /** Second orthonormal tangent vector in the face plane */
  e2: Vector3;
  /** The three vertex indices of this face */
  vertexIndices: [number, number, number];
}

// ---------------------------------------------------------------------------
// Build face descriptors from existing icosahedron data
// ---------------------------------------------------------------------------

/**
 * Build the 20 face descriptors using the shared icosahedron geometry.
 * Each face has:
 *   centroid  - unit vector pointing to the face center on the sphere
 *   e1, e2    - orthonormal tangent vectors spanning the face plane
 */
function buildIcosahedronFaces(): IcoFace[] {
  return ICOSAHEDRON_FACES.map((indices) => {
    const [a, b, c] = indices;
    const va = ICOSAHEDRON_VERTICES[a];
    const vb = ICOSAHEDRON_VERTICES[b];
    const vc = ICOSAHEDRON_VERTICES[c];

    // Face centroid on the sphere
    const centroid = new Vector3()
      .addVectors(va, vb)
      .add(vc)
      .normalize();

    // Local tangent frame: e1 toward first vertex projected onto face plane
    const e1 = new Vector3()
      .subVectors(va, centroid.clone().multiplyScalar(va.dot(centroid)))
      .normalize();
    const e2 = new Vector3().crossVectors(centroid, e1).normalize();

    return { centroid, e1, e2, vertexIndices: indices };
  });
}

/** The 20 face descriptors of the icosahedron */
export const FACES: IcoFace[] = buildIcosahedronFaces();

// ---------------------------------------------------------------------------
// Projection result type
// ---------------------------------------------------------------------------

export interface ProjectionResult {
  /** Which of the 20 faces was used (0-19) */
  faceIndex: number;
  /** Local u coordinate in the face's tangent frame */
  u: number;
  /** Local v coordinate in the face's tangent frame */
  v: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the index of the face whose centroid is closest to p (unit vector).
 */
export function nearestFaceIndex(p: Vector3): number {
  let best = -1;
  let bestDot = -Infinity;
  for (let i = 0; i < FACES.length; i++) {
    const d = FACES[i].centroid.dot(p);
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Forward: unit-sphere point -> (faceIndex, u, v)
// ---------------------------------------------------------------------------

/**
 * Project a point on the unit sphere to 2D coordinates on its nearest
 * icosahedron face using the Lambert azimuthal equal-area mapping.
 *
 * @param p - unit vector on the sphere
 * @returns faceIndex (0-19), u, v coordinates in the face's local tangent frame
 *          (same units as the sphere radius, i.e. <= 2 for a unit sphere)
 */
export function sphereToFace(p: Vector3): ProjectionResult {
  const faceIndex = nearestFaceIndex(p);
  const { centroid, e1, e2 } = FACES[faceIndex];

  // Angular distance from face centroid (clamped for numerical safety)
  const cosZ = Math.min(1, Math.max(-1, centroid.dot(p)));
  const z = Math.acos(cosZ);

  // Azimuth in the local tangent plane
  const px = p.dot(e1);
  const py = p.dot(e2);
  const theta = Math.atan2(py, px);

  // Lambert azimuthal equal-area radial mapping: rho = 2 * sin(z/2)
  const rho = 2 * Math.sin(z / 2);

  return {
    faceIndex,
    u: rho * Math.cos(theta),
    v: rho * Math.sin(theta),
  };
}

// ---------------------------------------------------------------------------
// Inverse: (faceIndex, u, v) -> unit-sphere point
// ---------------------------------------------------------------------------

/**
 * Unproject 2D face coordinates back to a point on the unit sphere.
 * Exact closed-form inverse of sphereToFace.
 *
 * @param faceIndex - face index (0-19)
 * @param u - local u coordinate
 * @param v - local v coordinate
 * @returns unit vector on the sphere
 */
export function faceToSphere(faceIndex: number, u: number, v: number): Vector3 {
  const { centroid, e1, e2 } = FACES[faceIndex];

  const rho = Math.sqrt(u * u + v * v);
  const theta = Math.atan2(v, u);

  // Inverse Lambert: z = 2 * arcsin(rho/2)
  // rho is at most 2 (antipode of face center), so rho/2 in [0,1] is always valid.
  const z = 2 * Math.asin(Math.min(1, rho / 2));

  // Reconstruct the 3D unit vector from (z, theta) in the face's local frame
  const sinZ = Math.sin(z);
  const cosZ = Math.cos(z);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return new Vector3(
    sinZ * cosTheta * e1.x + sinZ * sinTheta * e2.x + cosZ * centroid.x,
    sinZ * cosTheta * e1.y + sinZ * sinTheta * e2.y + cosZ * centroid.y,
    sinZ * cosTheta * e1.z + sinZ * sinTheta * e2.z + cosZ * centroid.z
  ).normalize(); // normalize to absorb any floating-point drift
}

// ---------------------------------------------------------------------------
// Global 2D layout helpers
// ---------------------------------------------------------------------------

/**
 * Face layout positions for unfolding the icosahedron into a 2D plane.
 * Each face gets a position offset so all 20 faces tile nicely.
 *
 * The layout follows a standard icosahedral net pattern.
 */
const FACE_LAYOUT: { x: number; z: number; rotation: number }[] = (() => {
  const layout: { x: number; z: number; rotation: number }[] = [];

  // Approximate dimensions for triangular face layout
  // Face "radius" in projection space (max distance from centroid)
  const faceRadius = 0.8;
  const rowHeight = faceRadius * 1.5;
  const colWidth = faceRadius * 1.732; // sqrt(3) for equilateral triangle spacing

  // Row 0: Top cap (5 faces around vertex 0)
  for (let i = 0; i < 5; i++) {
    layout.push({
      x: (i - 2) * colWidth,
      z: -rowHeight * 2,
      rotation: 0,
    });
  }

  // Row 1: Upper middle ring (5 faces)
  for (let i = 0; i < 5; i++) {
    layout.push({
      x: (i - 2) * colWidth + colWidth * 0.5,
      z: -rowHeight,
      rotation: Math.PI,
    });
  }

  // Row 2: Lower middle ring (5 faces)
  for (let i = 0; i < 5; i++) {
    layout.push({
      x: (i - 2) * colWidth,
      z: 0,
      rotation: 0,
    });
  }

  // Row 3: Connecting faces (5 faces)
  for (let i = 0; i < 5; i++) {
    layout.push({
      x: (i - 2) * colWidth + colWidth * 0.5,
      z: rowHeight,
      rotation: Math.PI,
    });
  }

  return layout;
})();

/**
 * Convert a sphere point to global 2D coordinates on the unfolded icosahedron map.
 *
 * @param p - unit vector on the sphere
 * @returns { x, z } coordinates on the 2D plane
 */
export function sphereToGlobal2D(p: Vector3): { x: number; z: number; faceIndex: number } {
  const { faceIndex, u, v } = sphereToFace(p);
  const layout = FACE_LAYOUT[faceIndex];

  // Rotate local coordinates according to face orientation
  const cos = Math.cos(layout.rotation);
  const sin = Math.sin(layout.rotation);
  const rotU = u * cos - v * sin;
  const rotV = u * sin + v * cos;

  return {
    x: layout.x + rotU,
    z: layout.z + rotV,
    faceIndex,
  };
}

/**
 * Get the layout information for a specific face.
 */
export function getFaceLayout(faceIndex: number): { x: number; z: number; rotation: number } {
  return FACE_LAYOUT[faceIndex];
}

/**
 * Convert global 2D coordinates back to a sphere point.
 * Finds the nearest face center and inverts the projection.
 *
 * @param x - global x coordinate on the 2D plane
 * @param z - global z coordinate on the 2D plane
 * @returns unit vector on the sphere, or null if point is too far from any face
 */
export function global2DToSphere(x: number, z: number): Vector3 | null {
  // Find the nearest face by checking distance to each face center in 2D
  let bestFace = -1;
  let bestDist = Infinity;

  for (let i = 0; i < FACE_LAYOUT.length; i++) {
    const layout = FACE_LAYOUT[i];
    const dx = x - layout.x;
    const dz = z - layout.z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      bestFace = i;
    }
  }

  if (bestFace < 0) return null;

  const layout = FACE_LAYOUT[bestFace];

  // Convert global coords to local face coords
  const localX = x - layout.x;
  const localZ = z - layout.z;

  // Inverse rotation
  const cos = Math.cos(-layout.rotation);
  const sin = Math.sin(-layout.rotation);
  const u = localX * cos - localZ * sin;
  const v = localX * sin + localZ * cos;

  // Check if we're within valid projection range (rho <= 2)
  const rho = Math.sqrt(u * u + v * v);
  if (rho > 2) return null;

  return faceToSphere(bestFace, u, v);
}

// ---------------------------------------------------------------------------
// Convenience: round-trip directly from sphere point
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper: project to the nearest face and immediately invert,
 * useful for round-trip accuracy tests.
 */
export function roundTrip(p: Vector3): Vector3 {
  const { faceIndex, u, v } = sphereToFace(p);
  return faceToSphere(faceIndex, u, v);
}
