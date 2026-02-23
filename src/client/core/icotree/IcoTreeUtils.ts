import { Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { IcoTree } from './IcoTree';
import { IcoCell } from './IcoCell';

/**
 * Utility functions for working with IcoTree structures.
 */

/**
 * Creates a Three.js BufferGeometry from the leaf cells of an IcoTree.
 * Each cell (pentagon or hexagon) is triangulated from its center.
 * @param tree The IcoTree to convert
 * @returns A BufferGeometry with positions and normals
 */
export function createGeometryFromTree(tree: IcoTree): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  for (const cell of tree.leaves()) {
    const center = cell.center;
    const vertices = cell.vertices;
    const n = vertices.length;

    // Triangulate from center (fan triangulation)
    for (let i = 0; i < n; i++) {
      const v0 = center;
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];

      // Add triangle vertices
      positions.push(v0.x, v0.y, v0.z);
      positions.push(v2.x, v2.y, v2.z);
      positions.push(v1.x, v1.y, v1.z);

      // For sphere, normals point outward (same as position for unit sphere)
      normals.push(v0.x, v0.y, v0.z);
      normals.push(v2.x, v2.y, v2.z);
      normals.push(v1.x, v1.y, v1.z);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));

  return geometry;
}

/**
 * Creates a wireframe geometry showing the edges of leaf cells.
 * @param tree The IcoTree to convert
 * @returns A BufferGeometry suitable for LineSegments
 */
export function createWireframeGeometry(tree: IcoTree): BufferGeometry {
  const positions: number[] = [];

  for (const cell of tree.leaves()) {
    const vertices = cell.vertices;
    const n = vertices.length;

    // Add edges around the cell
    for (let i = 0; i < n; i++) {
      const v0 = vertices[i];
      const v1 = vertices[(i + 1) % n];

      positions.push(v0.x, v0.y, v0.z);
      positions.push(v1.x, v1.y, v1.z);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

  return geometry;
}

/**
 * Creates a geometry showing cell centers as points.
 * @param tree The IcoTree
 * @returns A BufferGeometry suitable for Points
 */
export function createCentersGeometry(tree: IcoTree): BufferGeometry {
  const positions: number[] = [];

  for (const cell of tree.leaves()) {
    const c = cell.center;
    positions.push(c.x, c.y, c.z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

  return geometry;
}

/**
 * Computes the spherical distance (angle) between two points on the unit sphere.
 * @param a First point (normalized)
 * @param b Second point (normalized)
 * @returns Angle in radians
 */
export function sphericalDistance(a: Vector3, b: Vector3): number {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  return Math.acos(dot);
}

/**
 * Interpolates between two points on the unit sphere using spherical linear interpolation.
 * @param a Start point (normalized)
 * @param b End point (normalized)
 * @param t Interpolation parameter [0, 1]
 * @param target Target vector to store result
 * @returns The interpolated point on the unit sphere
 */
export function slerp(a: Vector3, b: Vector3, t: number, target: Vector3): Vector3 {
  const dot = a.dot(b);

  if (dot > 0.9999) {
    return target.lerpVectors(a, b, t).normalize();
  }

  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta = Math.sin(theta);

  const s0 = Math.sin((1 - t) * theta) / sinTheta;
  const s1 = Math.sin(t * theta) / sinTheta;

  target.set(
    a.x * s0 + b.x * s1,
    a.y * s0 + b.y * s1,
    a.z * s0 + b.z * s1
  );

  return target;
}

/**
 * Converts spherical coordinates (latitude/longitude) to a unit vector.
 * @param lat Latitude in radians (-PI/2 to PI/2)
 * @param lon Longitude in radians (-PI to PI)
 * @param target Target vector to store result
 * @returns The point on the unit sphere
 */
export function latLonToVector(lat: number, lon: number, target: Vector3): Vector3 {
  const cosLat = Math.cos(lat);
  target.set(
    cosLat * Math.cos(lon),
    Math.sin(lat),
    cosLat * Math.sin(lon)
  );
  return target;
}

/**
 * Converts a unit vector to spherical coordinates (latitude/longitude).
 * @param v Point on the unit sphere
 * @returns [latitude, longitude] in radians
 */
export function vectorToLatLon(v: Vector3): [number, number] {
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y)));
  const lon = Math.atan2(v.z, v.x);
  return [lat, lon];
}

/**
 * Builds an adjacency map for all leaf cells in the tree.
 * Two cells are adjacent if they share at least one vertex.
 * @param tree The IcoTree
 * @returns Map from cell to array of neighboring cells
 */
export function buildAdjacencyMap(tree: IcoTree): Map<IcoCell, IcoCell[]> {
  const adjacency = new Map<IcoCell, IcoCell[]>();
  const vertexToCells = new Map<string, IcoCell[]>();

  // Helper to create vertex key (8 decimal places for tolerance ~1e-8)
  const vertexKey = (v: Vector3) =>
    `${v.x.toFixed(8)},${v.y.toFixed(8)},${v.z.toFixed(8)}`;

  // First pass: map vertices to cells
  for (const cell of tree.leaves()) {
    adjacency.set(cell, []);

    for (const v of cell.vertices) {
      const key = vertexKey(v);
      if (!vertexToCells.has(key)) {
        vertexToCells.set(key, []);
      }
      vertexToCells.get(key)!.push(cell);
    }
  }

  // Second pass: cells sharing a vertex are neighbors
  for (const cells of vertexToCells.values()) {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const neighbors1 = adjacency.get(cells[i])!;
        const neighbors2 = adjacency.get(cells[j])!;

        if (!neighbors1.includes(cells[j])) {
          neighbors1.push(cells[j]);
        }
        if (!neighbors2.includes(cells[i])) {
          neighbors2.push(cells[i]);
        }
      }
    }
  }

  return adjacency;
}

/**
 * Performs a breadth-first traversal from a starting cell.
 * @param start Starting leaf cell
 * @param adjacency Adjacency map from buildAdjacencyMap
 * @param maxDistance Maximum distance (number of edges) to traverse
 * @returns Map from cell to distance from start
 */
export function bfsTraversal(
  start: IcoCell,
  adjacency: Map<IcoCell, IcoCell[]>,
  maxDistance: number = Infinity
): Map<IcoCell, number> {
  const distances = new Map<IcoCell, number>();
  const queue: [IcoCell, number][] = [[start, 0]];
  distances.set(start, 0);

  while (queue.length > 0) {
    const [current, dist] = queue.shift()!;

    if (dist >= maxDistance) continue;

    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, dist + 1);
        queue.push([neighbor, dist + 1]);
      }
    }
  }

  return distances;
}

/**
 * Computes statistics about the tree.
 */
export function computeTreeStats(tree: IcoTree): {
  totalCells: number;
  leafCells: number;
  pentagons: number;
  hexagons: number;
  maxDepth: number;
} {
  let totalCells = 0;
  let leafCells = 0;
  let pentagons = 0;
  let hexagons = 0;
  let maxDepth = 0;

  for (const cell of tree.traverse()) {
    totalCells++;

    if (cell.isLeaf) {
      leafCells++;

      if (cell.isPentagon) {
        pentagons++;
      } else {
        hexagons++;
      }
    }

    if (cell.depth > maxDepth) {
      maxDepth = cell.depth;
    }
  }

  return { totalCells, leafCells, pentagons, hexagons, maxDepth };
}
