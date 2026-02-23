import { Vector3 } from 'three';

/**
 * Shared icosahedron geometry data.
 * Vertices and faces are oriented so that face normals point outward.
 */

const phi = (1.0 + Math.sqrt(5.0)) / 2.0;
const du = 1.0 / Math.sqrt(phi * phi + 1.0);
const dv = phi * du;

/**
 * The 12 vertices of an icosahedron on the unit sphere.
 */
export const ICOSAHEDRON_VERTICES: Vector3[] = [
  new Vector3(0, +dv, +du).normalize(),
  new Vector3(0, +dv, -du).normalize(),
  new Vector3(0, -dv, +du).normalize(),
  new Vector3(0, -dv, -du).normalize(),
  new Vector3(+du, 0, +dv).normalize(),
  new Vector3(-du, 0, +dv).normalize(),
  new Vector3(+du, 0, -dv).normalize(),
  new Vector3(-du, 0, -dv).normalize(),
  new Vector3(+dv, +du, 0).normalize(),
  new Vector3(+dv, -du, 0).normalize(),
  new Vector3(-dv, +du, 0).normalize(),
  new Vector3(-dv, -du, 0).normalize(),
];

/**
 * The 20 faces of the icosahedron as vertex index triplets.
 * Winding order is set so that normals point outward from the sphere center.
 * (clockwise when viewed from outside)
 */
export const ICOSAHEDRON_FACES: [number, number, number][] = [
  // Top cap (around vertex 0)
  [0, 8, 1], [0, 4, 8], [0, 5, 4], [0, 10, 5], [0, 1, 10],
  // Upper middle ring
  [1, 8, 6], [8, 4, 9], [4, 5, 2], [5, 10, 11], [10, 1, 7],
  // Lower middle ring
  [3, 9, 6], [3, 2, 9], [3, 11, 2], [3, 7, 11], [3, 6, 7],
  // Connecting faces
  [6, 8, 9], [9, 4, 2], [2, 5, 11], [11, 10, 7], [7, 1, 6],
];

/**
 * Creates a fresh copy of the icosahedron vertices.
 */
export function createIcosahedronVertices(): Vector3[] {
  return ICOSAHEDRON_VERTICES.map(v => v.clone());
}

/**
 * Computes the center of each icosahedron face (normalized to unit sphere).
 */
export function computeFaceCenters(vertices: Vector3[] = ICOSAHEDRON_VERTICES): Vector3[] {
  return ICOSAHEDRON_FACES.map(([i0, i1, i2]) => {
    const center = new Vector3()
      .add(vertices[i0])
      .add(vertices[i1])
      .add(vertices[i2])
      .divideScalar(3);
    return center.normalize();
  });
}

/**
 * For each icosahedron vertex, returns the indices of the 5 faces that share it.
 */
export function computeVertexToFaces(): Map<number, number[]> {
  const vertexToFaces = new Map<number, number[]>();

  for (let fi = 0; fi < ICOSAHEDRON_FACES.length; fi++) {
    for (const vi of ICOSAHEDRON_FACES[fi]) {
      if (!vertexToFaces.has(vi)) {
        vertexToFaces.set(vi, []);
      }
      vertexToFaces.get(vi)!.push(fi);
    }
  }

  return vertexToFaces;
}

/**
 * Edge pairs for the icosahedron (30 edges).
 */
export const ICOSAHEDRON_EDGES: [number, number][] = [
  [0, 1], [0, 4], [0, 5], [0, 8], [0, 10],
  [1, 6], [1, 7], [1, 8], [1, 10],
  [2, 3], [2, 4], [2, 5], [2, 9], [2, 11],
  [3, 6], [3, 7], [3, 9], [3, 11],
  [4, 5], [4, 8], [4, 9],
  [5, 10], [5, 11],
  [6, 7], [6, 8], [6, 9],
  [7, 10], [7, 11],
  [8, 9],
  [10, 11],
];
