/**
 * RootTriangle - Data structure representing a triangle in the icosahedral net.
 *
 * Each triangle stores its ID, vertex indices, and 2D coordinates.
 * Provides utility methods for point-in-triangle testing and barycentric interpolation.
 */

import { Vec2, IcoNetGeometry } from './IcoNetGeometry';
import { LatLon, IcoNetCoordinates } from './IcoNetCoordinates';

/**
 * Triangle adjacency mapping for the icosahedral net.
 * Each triangle has 3 neighbors indexed as: [left edge, right edge, base edge]
 */
export const ROOT_TRIANGLE_ADJACENCY: ReadonlyArray<readonly [number, number, number]> = [
  [4, 1, 5],    // 0
  [0, 2, 7],    // 1
  [1, 3, 9],    // 2
  [2, 4, 11],   // 3
  [3, 0, 13],   // 4
  [6, 14, 0],   // 5
  [5, 7, 15],   // 6
  [8, 6, 1],    // 7
  [7, 9, 16],   // 8
  [10, 8, 2],   // 9
  [9, 11, 17],  // 10
  [12, 10, 3],  // 11
  [11, 13, 18], // 12
  [14, 12, 4],  // 13
  [13, 5, 19],  // 14
  [16, 19, 6],  // 15
  [17, 15, 8],  // 16
  [18, 16, 10], // 17
  [19, 17, 12], // 18
  [15, 18, 14], // 19
] as const;

/**
 * Neighbor information for a root triangle
 */
export interface RootTriangleNeighbors {
  /** Neighbor across the left edge */
  left: number;
  /** Neighbor across the right edge */
  right: number;
  /** Neighbor across the base edge */
  base: number;
}

/**
 * Gets the neighboring triangle IDs for a given root triangle.
 */
export function getRootTriangleNeighbors(triangleId: number): RootTriangleNeighbors {
  const [left, right, base] = ROOT_TRIANGLE_ADJACENCY[triangleId];
  return { left, right, base };
}

/**
 * Represents a single triangle in the icosahedral net.
 */
export interface RootTriangle {
  /** Unique identifier for this triangle */
  id: number;

  /** Indices of the three vertices in the geometry */
  vertexIndices: [number, number, number];

  /** 2D coordinates of vertex 0 */
  v0: Vec2;

  /** 2D coordinates of vertex 1 */
  v1: Vec2;

  /** 2D coordinates of vertex 2 */
  v2: Vec2;

  /** Row index (0=top, 1=middle, 2=bottom) */
  row: number;

  /** Whether the triangle is up-pointing */
  isUpPointing: boolean;
}

/**
 * Creates RootTriangle objects from IcoNetGeometry.
 */
export function buildRootTriangles(geometry: IcoNetGeometry): RootTriangle[] {
  const triangles: RootTriangle[] = [];

  for (let i = 0; i < geometry.faceCount; i++) {
    const [i0, i1, i2] = geometry.getFace(i);
    const v0 = geometry.getVertex(i0);
    const v1 = geometry.getVertex(i1);
    const v2 = geometry.getVertex(i2);

    triangles.push({
      id: i,
      vertexIndices: [i0, i1, i2],
      v0,
      v1,
      v2,
      row: geometry.getFaceRow(i),
      isUpPointing: geometry.isUpPointing(i),
    });
  }

  return triangles;
}

/**
 * Computes the signed area of a triangle formed by three 2D points.
 * Positive if counter-clockwise, negative if clockwise.
 */
function signedArea(p1: Vec2, p2: Vec2, p3: Vec2): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

/**
 * Tests if a point is inside a triangle using barycentric coordinates.
 * Returns true if the point is inside or on the edge of the triangle.
 */
export function isPointInTriangle(point: Vec2, triangle: RootTriangle): boolean {
  const { v0, v1, v2 } = triangle;

  const d1 = signedArea(point, v0, v1);
  const d2 = signedArea(point, v1, v2);
  const d3 = signedArea(point, v2, v0);

  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

  return !(hasNeg && hasPos);
}

/**
 * Computes barycentric coordinates for a point within a triangle.
 * Returns [u, v, w] where u + v + w = 1.
 *
 * The coordinates can be used for interpolation:
 * interpolatedValue = u * valueAtV0 + v * valueAtV1 + w * valueAtV2
 */
export function computeBarycentricCoordinates(point: Vec2, triangle: RootTriangle): [number, number, number] {
  const { v0, v1, v2 } = triangle;

  const totalArea = signedArea(v0, v1, v2);

  if (Math.abs(totalArea) < 1e-10) {
    // Degenerate triangle
    return [1/3, 1/3, 1/3];
  }

  const u = signedArea(point, v1, v2) / totalArea;
  const v = signedArea(point, v2, v0) / totalArea;
  const w = signedArea(point, v0, v1) / totalArea;

  return [u, v, w];
}

/**
 * Interpolates lat/lon for a point inside a triangle using barycentric coordinates.
 *
 * Note: This is a simple linear interpolation in lat/lon space, which is an
 * approximation. For more accurate results at large scales, spherical
 * interpolation would be needed.
 */
export function interpolateLatLon(
  point: Vec2,
  triangle: RootTriangle,
  coordinates: IcoNetCoordinates
): LatLon {
  const [u, v, w] = computeBarycentricCoordinates(point, triangle);
  const [i0, i1, i2] = triangle.vertexIndices;

  const ll0 = coordinates.getVertexLatLon(i0);
  const ll1 = coordinates.getVertexLatLon(i1);
  const ll2 = coordinates.getVertexLatLon(i2);

  // Handle longitude wrap-around for triangles crossing the 0/360 boundary
  let lon0 = ll0.lon;
  let lon1 = ll1.lon;
  let lon2 = ll2.lon;

  // Check if we need to handle wrap-around (longitude spanning more than 180 degrees)
  const maxLon = Math.max(lon0, lon1, lon2);
  const minLon = Math.min(lon0, lon1, lon2);

  if (maxLon - minLon > 180) {
    // Wrap-around case: adjust longitudes that are near 0 to be near 360
    if (lon0 < 180) lon0 += 360;
    if (lon1 < 180) lon1 += 360;
    if (lon2 < 180) lon2 += 360;
  }

  const lat = u * ll0.lat + v * ll1.lat + w * ll2.lat;
  let lon = u * lon0 + v * lon1 + w * lon2;

  // Normalize longitude back to [0, 360)
  lon = IcoNetCoordinates.normalizeLon(lon);

  return { lat, lon };
}

/**
 * Finds the triangle containing the given point.
 * Returns null if the point is outside all triangles.
 */
export function findTriangleAtPoint(point: Vec2, triangles: RootTriangle[]): RootTriangle | null {
  for (const triangle of triangles) {
    if (isPointInTriangle(point, triangle)) {
      return triangle;
    }
  }
  return null;
}
