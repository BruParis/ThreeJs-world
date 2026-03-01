/**
 * HexaCell - Hexagonal cells in the icosahedral net.
 *
 * Two types of hexagons:
 * - Complete: Triangle-centered hexagons, one inside each triangle (6 vertices).
 * - Incomplete: Vertex-centered hexagons around original triangle vertices (5-6 vertices).
 *
 * Due to the topology of the flattened grid, the same vertex on the sphere may have
 * multiple corresponding 2D coordinates. This is handled via the vertexPositions map.
 */

import { Vec2, IcoNetGeometry } from './IcoNetGeometry';

// ============================================================================
// Types
// ============================================================================

/**
 * A vertex in a hexagonal cell with its ID and position.
 */
export interface HexaVertex {
  /** Vertex ID (unique within the hexagon, sequential 0-5 or 0-4) */
  id: number;
  /** 2D position in the flattened grid */
  position: Vec2;
}

/**
 * Represents a hexagonal cell.
 */
export interface HexaCell {
  /** Unique identifier */
  id: number;

  /** The triangle this hexagon belongs to (-1 for vertex-centered) */
  triangleId: number;

  /** Whether this is a complete (triangle-centered) or incomplete (vertex-centered) hexagon */
  isComplete: boolean;

  /** For incomplete hexagons: the canonical vertex this hexagon is centered on */
  centerVertexId?: number;

  /** Center position of the hexagon (centroid for complete, original vertex for incomplete) */
  center: Vec2;

  /**
   * Ordered vertices forming the boundary (closed loop).
   * Each vertex has a local ID (0 to n-1) and its 2D position.
   */
  vertices: HexaVertex[];

  /**
   * Maps vertex ID -> set of 2D positions.
   * For complete hexagons: each ID maps to exactly one position.
   * For incomplete border hexagons: some IDs may map to multiple positions
   * (when the same 3D vertex appears at different 2D locations due to wrapping).
   */
  vertexPositions: Map<number, Vec2[]>;

  /**
   * Local center for each vertex, used for rendering triangles.
   * - Complete hexagons: all centers are the same (centroid).
   * - Incomplete hexagons: each vertex uses its associated original vertex position.
   */
  localCenters: Vec2[];
}

/**
 * Result of building all hexagons.
 */
export interface HexagonBuildResult {
  /** All hexagonal cells (complete + incomplete) */
  hexaCells: HexaCell[];

  /** Complete hexagons only (triangle-centered) */
  completeHexagons: HexaCell[];

  /** Incomplete hexagons only (vertex-centered) */
  incompleteHexagons: HexaCell[];
}

/**
 * Internal: vertex created on an edge at t=1/3 or t=2/3.
 */
interface EdgeVertex {
  id: number;
  position: Vec2;
  edge: [number, number];
  t: number;
}

/**
 * Internal: edge vertex with its associated original vertex info.
 */
interface EdgeVertexWithOrigin {
  position: Vec2;
  originalVertexId: number;
  originalVertexPos: Vec2;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Builds all hexagons for the given geometry.
 */
export function buildHexagons(geometry: IcoNetGeometry): HexagonBuildResult {
  // Create edge vertices (2 per edge at t=1/3 and t=2/3)
  const { edgeVertices, edgeToVertices } = createEdgeVertices(geometry);

  // Build both types of hexagons
  const completeHexagons = buildCompleteHexagons(geometry, edgeVertices, edgeToVertices);
  const incompleteHexagons = buildIncompleteHexagons(geometry, edgeVertices, edgeToVertices, geometry.faceCount);

  return {
    hexaCells: [...completeHexagons, ...incompleteHexagons],
    completeHexagons,
    incompleteHexagons,
  };
}

/**
 * Tests if a point is inside a convex polygon.
 */
export function isPointInCell(point: Vec2, cell: HexaCell): boolean {
  const { vertices } = cell;
  const n = vertices.length;
  if (n < 3) return false;

  let sign = 0;
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i].position;
    const v2 = vertices[(i + 1) % n].position;
    const cross = (v2.x - v1.x) * (point.y - v1.y) - (v2.y - v1.y) * (point.x - v1.x);

    if (Math.abs(cross) < 1e-10) continue;

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
 */
export function findCellAtPoint(point: Vec2, cells: HexaCell[]): HexaCell | null {
  for (const cell of cells) {
    if (isPointInCell(point, cell)) {
      return cell;
    }
  }
  return null;
}

// ============================================================================
// Edge Vertex Creation
// ============================================================================

/**
 * Creates vertices on each edge at t=1/3 and t=2/3.
 * These vertices form the corners of the hexagons.
 */
function createEdgeVertices(geometry: IcoNetGeometry): {
  edgeVertices: EdgeVertex[];
  edgeToVertices: Map<string, number[]>;
} {
  const edgeVertices: EdgeVertex[] = [];
  const edgeToVertices = new Map<string, number[]>();
  let vertexId = 0;

  for (let ti = 0; ti < geometry.faceCount; ti++) {
    const [i0, i1, i2] = geometry.getFace(ti);
    const edges: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]];

    for (const [va, vb] of edges) {
      const edgeKey = makeEdgeKey(va, vb);

      if (!edgeToVertices.has(edgeKey)) {
        const [startIdx, endIdx] = va < vb ? [va, vb] : [vb, va];
        const startPos = geometry.getVertex(startIdx);
        const endPos = geometry.getVertex(endIdx);

        const v1: EdgeVertex = {
          id: vertexId++,
          position: lerp2D(startPos, endPos, 1 / 3),
          edge: [startIdx, endIdx],
          t: 1 / 3,
        };

        const v2: EdgeVertex = {
          id: vertexId++,
          position: lerp2D(startPos, endPos, 2 / 3),
          edge: [startIdx, endIdx],
          t: 2 / 3,
        };

        edgeVertices.push(v1, v2);
        edgeToVertices.set(edgeKey, [v1.id, v2.id]);
      }
    }
  }

  return { edgeVertices, edgeToVertices };
}

// ============================================================================
// Complete Hexagons (Triangle-Centered)
// ============================================================================

/**
 * Builds complete hexagons: one inside each triangle.
 * Each hexagon uses the 6 edge vertices around the triangle.
 */
function buildCompleteHexagons(
  geometry: IcoNetGeometry,
  edgeVertices: EdgeVertex[],
  edgeToVertices: Map<string, number[]>
): HexaCell[] {
  const hexagons: HexaCell[] = [];

  for (let ti = 0; ti < geometry.faceCount; ti++) {
    const [i0, i1, i2] = geometry.getFace(ti);
    const edges: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]];

    // Collect vertices in order around the hexagon
    const positions: Vec2[] = [];
    for (const [va, vb] of edges) {
      const edgeKey = makeEdgeKey(va, vb);
      const vertexIds = edgeToVertices.get(edgeKey)!;

      // Determine traversal direction
      if (va < vb) {
        positions.push(edgeVertices[vertexIds[0]].position, edgeVertices[vertexIds[1]].position);
      } else {
        positions.push(edgeVertices[vertexIds[1]].position, edgeVertices[vertexIds[0]].position);
      }
    }

    const centroid = computeCentroid(positions);

    // Build vertices with IDs
    const vertices: HexaVertex[] = positions.map((pos, idx) => ({
      id: idx,
      position: pos,
    }));

    // Build vertex positions map (each ID maps to exactly one position for complete hexagons)
    const vertexPositions = new Map<number, Vec2[]>();
    for (let i = 0; i < positions.length; i++) {
      vertexPositions.set(i, [positions[i]]);
    }

    hexagons.push({
      id: ti,
      triangleId: ti,
      isComplete: true,
      center: centroid,
      vertices,
      vertexPositions,
      localCenters: positions.map(() => centroid),
    });
  }

  return hexagons;
}

// ============================================================================
// Incomplete Hexagons (Vertex-Centered)
// ============================================================================

/**
 * Vertex equivalence groups: vertices that are the same on the 3D icosahedron
 * but appear at different positions in the 2D net.
 */
const VERTEX_EQUIVALENCES: number[][] = [
  [0, 1, 2, 3, 4],      // North pole (pentagon)
  [17, 18, 19, 20, 21], // South pole (pentagon)
  [5, 10],              // Left/right wrap
  [11, 16],             // Left/right wrap
];

/**
 * Builds incomplete hexagons: one around each original vertex.
 * Handles vertex equivalences (vertices that wrap around the net).
 *
 * For vertices that appear at multiple 2D positions (equivalence classes),
 * we group edge vertices by their original vertex and sort within each group.
 */
function buildIncompleteHexagons(
  geometry: IcoNetGeometry,
  edgeVertices: EdgeVertex[],
  edgeToVertices: Map<string, number[]>,
  startId: number
): HexaCell[] {
  const hexagons: HexaCell[] = [];
  const processedVertices = new Set<number>();
  let currentId = startId;

  for (let vi = 0; vi < geometry.vertexCount; vi++) {
    const canonicalVi = getCanonicalVertex(vi);
    if (processedVertices.has(canonicalVi)) continue;
    processedVertices.add(canonicalVi);

    const equivalentVertices = getEquivalentVertices(vi);
    const edgeVertexInfos = collectEdgeVerticesAroundVertex(
      equivalentVertices,
      geometry,
      edgeVertices,
      edgeToVertices
    );

    if (edgeVertexInfos.length < 3) continue;

    // Sort edge vertices properly based on their spatial distribution
    const sorted = sortEdgeVerticesForHexagon(edgeVertexInfos, equivalentVertices, geometry);

    // Build HexaVertex array with sequential IDs
    const vertices: HexaVertex[] = sorted.map((info, idx) => ({
      id: idx,
      position: info.position,
    }));

    // Build vertex positions map
    const vertexPositions = new Map<number, Vec2[]>();
    for (let i = 0; i < sorted.length; i++) {
      const positions = vertexPositions.get(i) || [];
      positions.push(sorted[i].position);
      vertexPositions.set(i, positions);
    }

    // Compute center as centroid of all equivalent vertex positions
    const equivalentPositions = equivalentVertices.map(v => geometry.getVertex(v));
    const center = computeCentroid(equivalentPositions);

    hexagons.push({
      id: currentId++,
      triangleId: -1,
      isComplete: false,
      centerVertexId: canonicalVi,
      center,
      vertices,
      vertexPositions,
      localCenters: sorted.map(info => info.originalVertexPos),
    });
  }

  return hexagons;
}

/**
 * Collects edge vertices that are closest to the given original vertices.
 */
function collectEdgeVerticesAroundVertex(
  originalVertices: number[],
  geometry: IcoNetGeometry,
  edgeVertices: EdgeVertex[],
  edgeToVertices: Map<string, number[]>
): EdgeVertexWithOrigin[] {
  const result: EdgeVertexWithOrigin[] = [];

  for (const origVi of originalVertices) {
    const origPos = geometry.getVertex(origVi);

    for (const [edgeKey, vertexIds] of edgeToVertices) {
      const [v1, v2] = edgeKey.split('-').map(Number);

      if (v1 === origVi || v2 === origVi) {
        // Get the edge vertex closest to this original vertex
        const edgeVertexIdx = origVi === v1 ? vertexIds[0] : vertexIds[1];

        result.push({
          position: edgeVertices[edgeVertexIdx].position,
          originalVertexId: origVi,
          originalVertexPos: origPos,
        });
      }
    }
  }

  return result;
}

/**
 * Sorts edge vertices for an incomplete hexagon.
 * Groups vertices by their original vertex, sorts within each group by angle,
 * then concatenates groups in spatial order.
 */
function sortEdgeVerticesForHexagon(
  infos: EdgeVertexWithOrigin[],
  equivalentVertices: number[],
  geometry: IcoNetGeometry
): EdgeVertexWithOrigin[] {
  // Group edge vertices by their original vertex ID
  const groups = new Map<number, EdgeVertexWithOrigin[]>();
  for (const info of infos) {
    const group = groups.get(info.originalVertexId) || [];
    group.push(info);
    groups.set(info.originalVertexId, group);
  }

  // Sort vertices within each group by angle around their original vertex
  for (const [origVi, group] of groups) {
    const origPos = geometry.getVertex(origVi);
    group.sort((a, b) => {
      const angleA = Math.atan2(a.position.y - origPos.y, a.position.x - origPos.x);
      const angleB = Math.atan2(b.position.y - origPos.y, b.position.x - origPos.x);
      return angleA - angleB;
    });
  }

  // Order the groups by the x-coordinate of their original vertex (left to right)
  const sortedOrigVertices = [...equivalentVertices].sort((a, b) => {
    const posA = geometry.getVertex(a);
    const posB = geometry.getVertex(b);
    return posA.x - posB.x;
  });

  // Concatenate all groups in order
  const result: EdgeVertexWithOrigin[] = [];
  for (const origVi of sortedOrigVertices) {
    const group = groups.get(origVi);
    if (group) {
      result.push(...group);
    }
  }

  return result;
}

/**
 * Returns the canonical (smallest) vertex ID in an equivalence group.
 */
function getCanonicalVertex(vi: number): number {
  for (const group of VERTEX_EQUIVALENCES) {
    if (group.includes(vi)) {
      return Math.min(...group);
    }
  }
  return vi;
}

/**
 * Returns all vertices equivalent to the given vertex.
 */
function getEquivalentVertices(vi: number): number[] {
  for (const group of VERTEX_EQUIVALENCES) {
    if (group.includes(vi)) {
      return group;
    }
  }
  return [vi];
}

// ============================================================================
// Utilities
// ============================================================================

function makeEdgeKey(v1: number, v2: number): string {
  return v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
}

function lerp2D(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function computeCentroid(vertices: Vec2[]): Vec2 {
  if (vertices.length === 0) return { x: 0, y: 0 };

  let sumX = 0, sumY = 0;
  for (const v of vertices) {
    sumX += v.x;
    sumY += v.y;
  }
  return { x: sumX / vertices.length, y: sumY / vertices.length };
}
