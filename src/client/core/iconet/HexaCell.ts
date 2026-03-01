/**
 * HexaCell - Data structure representing a hexagonal cell (pentagon) in the icosahedral net.
 *
 * Each cell is centered on a vertex of the original mesh and formed by connecting
 * the centroids of triangles sharing that vertex.
 *
 * For the base icosahedron (no subdivision), all cells are pentagons since
 * each vertex is shared by exactly 5 triangles.
 *
 * Special cases:
 * - Pole cells: The 5 top row vertices all represent the North Pole, and the
 *   5 bottom row vertices all represent the South Pole. These form single pentagons.
 * - Edge wraparound: The leftmost and rightmost vertices in rows 1 and 2 are
 *   the same point (longitude 0° = 360°). Their cells must combine triangles
 *   from both sides.
 */

import { Vec2, IcoNetGeometry } from './IcoNetGeometry';

/**
 * Represents a hexagonal cell (pentagon in base icosahedron) in the net.
 */
export interface HexaCell {
  /** Unique identifier for this cell */
  id: number;

  /** 2D vertices forming the cell boundary (ordered for a closed loop) */
  vertices: Vec2[];

  /** Triangle indices whose centroids form this cell's vertices */
  triangleIndices: number[];

  /** Whether this is a pole cell (North or South) */
  isPole: boolean;

  /** Whether this cell wraps around the horizontal edge of the net */
  wrapsHorizontally: boolean;

  /** The row of the center vertex (0=North Pole, 1=Upper Ring, 2=Lower Ring, 3=South Pole) */
  row: number;

  /** The column index within the row (0 to numCols-1) */
  col: number;
}

/**
 * Computes the centroid of a triangle.
 */
function computeCentroid(v0: Vec2, v1: Vec2, v2: Vec2): Vec2 {
  return {
    x: (v0.x + v1.x + v2.x) / 3,
    y: (v0.y + v1.y + v2.y) / 3,
  };
}

/**
 * Computes centroids for all triangles in the geometry.
 */
export function computeTriangleCentroids(geometry: IcoNetGeometry): Vec2[] {
  const centroids: Vec2[] = [];

  for (let i = 0; i < geometry.faceCount; i++) {
    const [i0, i1, i2] = geometry.getFace(i);
    const v0 = geometry.getVertex(i0);
    const v1 = geometry.getVertex(i1);
    const v2 = geometry.getVertex(i2);
    centroids.push(computeCentroid(v0, v1, v2));
  }

  return centroids;
}

/**
 * Builds a mapping from vertex index to triangle indices that contain that vertex.
 */
function buildVertexToTrianglesMap(geometry: IcoNetGeometry): Map<number, number[]> {
  const map = new Map<number, number[]>();

  for (let ti = 0; ti < geometry.faceCount; ti++) {
    const [i0, i1, i2] = geometry.getFace(ti);
    for (const vi of [i0, i1, i2]) {
      if (!map.has(vi)) {
        map.set(vi, []);
      }
      map.get(vi)!.push(ti);
    }
  }

  return map;
}

/**
 * Orders triangle indices around a vertex to form a consistent loop.
 * Uses angle from vertex to centroid for ordering.
 */
function orderTrianglesAroundVertex(
  vertex: Vec2,
  triangleIndices: number[],
  centroids: Vec2[]
): number[] {
  return [...triangleIndices].sort((a, b) => {
    const ca = centroids[a];
    const cb = centroids[b];
    const angleA = Math.atan2(ca.y - vertex.y, ca.x - vertex.x);
    const angleB = Math.atan2(cb.y - vertex.y, cb.x - vertex.x);
    return angleA - angleB;
  });
}

/**
 * Creates the North Pole cell by combining all row 0 vertices.
 * The pole is shared by all 5 top triangles.
 */
function createNorthPoleCell(
  geometry: IcoNetGeometry,
  centroids: Vec2[]
): HexaCell {
  const numCols = geometry.numCols;

  // Top triangles are indices 0 to numCols-1
  const triangleIndices: number[] = [];
  for (let i = 0; i < numCols; i++) {
    triangleIndices.push(i);
  }

  // Order by x-coordinate of centroid (left to right)
  triangleIndices.sort((a, b) => centroids[a].x - centroids[b].x);

  return {
    id: 0,
    vertices: triangleIndices.map(ti => centroids[ti]),
    triangleIndices,
    isPole: true,
    wrapsHorizontally: true,
    row: 0,
    col: 0,
  };
}

/**
 * Creates the South Pole cell by combining all row 3 vertices.
 * The pole is shared by all 5 bottom triangles.
 */
function createSouthPoleCell(
  geometry: IcoNetGeometry,
  centroids: Vec2[],
  cellId: number
): HexaCell {
  const numCols = geometry.numCols;

  // Bottom triangles are the last numCols triangles
  const bottomStart = geometry.faceCount - numCols;
  const triangleIndices: number[] = [];
  for (let i = 0; i < numCols; i++) {
    triangleIndices.push(bottomStart + i);
  }

  // Order by x-coordinate of centroid (left to right)
  triangleIndices.sort((a, b) => centroids[a].x - centroids[b].x);

  return {
    id: cellId,
    vertices: triangleIndices.map(ti => centroids[ti]),
    triangleIndices,
    isPole: true,
    wrapsHorizontally: true,
    row: 3,
    col: 0,
  };
}

/**
 * Creates a cell for a row 1 vertex (upper ring).
 * Handles wraparound for vertices at the edges.
 */
function createRow1Cell(
  geometry: IcoNetGeometry,
  centroids: Vec2[],
  vertexToTriangles: Map<number, number[]>,
  col: number,
  cellId: number
): HexaCell {
  const numCols = geometry.numCols;
  const { row1 } = geometry.rowStarts;

  const wrapsHorizontally = col === 0;

  // Primary vertex index
  const primaryVertexIndex = row1 + col;

  // Get triangles for this vertex
  let triangleIndices = [...(vertexToTriangles.get(primaryVertexIndex) || [])];

  // Handle wraparound: vertex at col=0 wraps with vertex at col=numCols
  if (wrapsHorizontally) {
    const wrapVertexIndex = row1 + numCols;
    const wrapTriangles = vertexToTriangles.get(wrapVertexIndex) || [];
    triangleIndices.push(...wrapTriangles);
  }

  // Compute virtual center for ordering (average of vertex positions)
  let centerVertex = geometry.getVertex(primaryVertexIndex);
  if (wrapsHorizontally) {
    // For wraparound, use the average x position
    const wrapVertex = geometry.getVertex(row1 + numCols);
    centerVertex = {
      x: (centerVertex.x + wrapVertex.x) / 2,
      y: centerVertex.y,
    };
  }

  // Order triangles around the vertex
  triangleIndices = orderTrianglesAroundVertex(centerVertex, triangleIndices, centroids);

  return {
    id: cellId,
    vertices: triangleIndices.map(ti => centroids[ti]),
    triangleIndices,
    isPole: false,
    wrapsHorizontally,
    row: 1,
    col,
  };
}

/**
 * Creates a cell for a row 2 vertex (lower ring).
 * Handles wraparound for vertices at the edges.
 */
function createRow2Cell(
  geometry: IcoNetGeometry,
  centroids: Vec2[],
  vertexToTriangles: Map<number, number[]>,
  col: number,
  cellId: number
): HexaCell {
  const numCols = geometry.numCols;
  const { row2 } = geometry.rowStarts;

  const wrapsHorizontally = col === 0;

  // Primary vertex index
  const primaryVertexIndex = row2 + col;

  // Get triangles for this vertex
  let triangleIndices = [...(vertexToTriangles.get(primaryVertexIndex) || [])];

  // Handle wraparound: vertex at col=0 wraps with vertex at col=numCols
  if (wrapsHorizontally) {
    const wrapVertexIndex = row2 + numCols;
    const wrapTriangles = vertexToTriangles.get(wrapVertexIndex) || [];
    triangleIndices.push(...wrapTriangles);
  }

  // Compute virtual center for ordering
  let centerVertex = geometry.getVertex(primaryVertexIndex);
  if (wrapsHorizontally) {
    const wrapVertex = geometry.getVertex(row2 + numCols);
    centerVertex = {
      x: (centerVertex.x + wrapVertex.x) / 2,
      y: centerVertex.y,
    };
  }

  // Order triangles around the vertex
  triangleIndices = orderTrianglesAroundVertex(centerVertex, triangleIndices, centroids);

  return {
    id: cellId,
    vertices: triangleIndices.map(ti => centroids[ti]),
    triangleIndices,
    isPole: false,
    wrapsHorizontally,
    row: 2,
    col,
  };
}

/**
 * Builds all HexaCells from the geometry.
 *
 * Returns 12 cells for the base icosahedron:
 * - 1 North Pole pentagon
 * - 5 upper ring pentagons
 * - 5 lower ring pentagons
 * - 1 South Pole pentagon
 */
export function buildHexaCells(geometry: IcoNetGeometry): HexaCell[] {
  const numCols = geometry.numCols;
  const centroids = computeTriangleCentroids(geometry);
  const vertexToTriangles = buildVertexToTrianglesMap(geometry);

  const cells: HexaCell[] = [];
  let cellId = 0;

  // North Pole cell (id = 0)
  cells.push(createNorthPoleCell(geometry, centroids));
  cellId++;

  // Row 1 cells (upper ring) - numCols cells (not numCols+1 due to wraparound)
  for (let col = 0; col < numCols; col++) {
    cells.push(createRow1Cell(geometry, centroids, vertexToTriangles, col, cellId));
    cellId++;
  }

  // Row 2 cells (lower ring) - numCols cells
  for (let col = 0; col < numCols; col++) {
    cells.push(createRow2Cell(geometry, centroids, vertexToTriangles, col, cellId));
    cellId++;
  }

  // South Pole cell
  cells.push(createSouthPoleCell(geometry, centroids, cellId));

  return cells;
}

/**
 * Tests if a point is inside a convex polygon using cross product method.
 */
export function isPointInCell(point: Vec2, cell: HexaCell): boolean {
  const vertices = cell.vertices;
  const n = vertices.length;

  if (n < 3) return false;

  // Check if point is on the same side of all edges
  let sign = 0;

  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];

    // Cross product of edge vector and point vector
    const cross = (v2.x - v1.x) * (point.y - v1.y) - (v2.y - v1.y) * (point.x - v1.x);

    if (Math.abs(cross) < 1e-10) continue; // On the edge

    const currentSign = cross > 0 ? 1 : -1;

    if (sign === 0) {
      sign = currentSign;
    } else if (sign !== currentSign) {
      return false;
    }
  }

  return true;
}

/**
 * Finds the cell containing the given point.
 * Returns null if the point is outside all cells.
 */
export function findCellAtPoint(point: Vec2, cells: HexaCell[]): HexaCell | null {
  for (const cell of cells) {
    if (isPointInCell(point, cell)) {
      return cell;
    }
  }
  return null;
}

/**
 * Computes the centroid of a cell (average of its vertices).
 */
export function computeCellCentroid(cell: HexaCell): Vec2 {
  const n = cell.vertices.length;
  if (n === 0) return { x: 0, y: 0 };

  let sumX = 0;
  let sumY = 0;
  for (const v of cell.vertices) {
    sumX += v.x;
    sumY += v.y;
  }

  return { x: sumX / n, y: sumY / n };
}
