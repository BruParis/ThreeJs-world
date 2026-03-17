import * as THREE from 'three';
import {
  ISEA3HCell,
  ISEA3HCellDisplayInfo,
  getNormalizationFactor,
} from './ISEA3HEncoding';

/**
 * Computes the barycenter position from cell coordinates.
 * The barycenter is at (a, b, c) / normFactor, on the octahedron surface.
 */
export function computeBarycenter(cell: ISEA3HCell): THREE.Vector3 {
  const normFactor = getNormalizationFactor(cell.n);
  return new THREE.Vector3(
    cell.a / normFactor,
    cell.b / normFactor,
    cell.c / normFactor
  );
}

/**
 * Computes the cell vertices as THREE.Vector3 from a display info.
 * Returns barycenters of the cellVertexCells.
 */
export function computeCellVertices(displayInfo: ISEA3HCellDisplayInfo): THREE.Vector3[] {
  const vertices = displayInfo.cellVertexCells.map(cell => computeBarycenter(cell));

  if (vertices.length >= 3) {
    const center = computeBarycenter(displayInfo.cell);
    sortVerticesByAngle(center, vertices);
  }

  return vertices;
}

/**
 * Computes neighbor barycenters as THREE.Vector3 from a display info.
 */
export function computeNeighborBarycenters(displayInfo: ISEA3HCellDisplayInfo): THREE.Vector3[] {
  return displayInfo.neighborCells.map(cell => computeBarycenter(cell));
}

/**
 * Sorts vertices by angle around the center for proper polygon rendering.
 */
export function sortVerticesByAngle(center: THREE.Vector3, vertices: THREE.Vector3[]): void {
  // Project to a local 2D coordinate system on the octahedron surface
  // Use the normal at the center point
  const normal = center.clone().normalize();

  // Create a local coordinate system
  let tangent: THREE.Vector3;
  if (Math.abs(normal.x) < 0.9) {
    tangent = new THREE.Vector3(1, 0, 0).cross(normal).normalize();
  } else {
    tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
  }
  const bitangent = normal.clone().cross(tangent).normalize();

  // Compute angle for each vertex
  const verticesWithAngles = vertices.map(v => {
    const localVec = v.clone().sub(center);
    const x = localVec.dot(tangent);
    const y = localVec.dot(bitangent);
    const angle = Math.atan2(y, x);
    return { vertex: v, angle };
  });

  // Sort by angle
  verticesWithAngles.sort((a, b) => a.angle - b.angle);

  // Replace vertices in sorted order
  for (let i = 0; i < vertices.length; i++) {
    vertices[i] = verticesWithAngles[i].vertex;
  }
}

/**
 * Checks if a point is inside a convex polygon on the octahedron surface.
 * Uses the cross product approach: point is inside if it's on the same side of all edges.
 */
export function isPointInPolygon(point: THREE.Vector3, vertices: THREE.Vector3[]): boolean {
  if (vertices.length < 3) return false;

  const n = vertices.length;
  let sign: number | null = null;

  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];

    // Edge vector
    const edge = new THREE.Vector3().subVectors(v2, v1);
    // Vector from v1 to point
    const toPoint = new THREE.Vector3().subVectors(point, v1);

    // Cross product gives the normal direction
    const cross = new THREE.Vector3().crossVectors(edge, toPoint);

    // Project onto the surface normal (center of polygon, roughly)
    // We check if the cross products all have the same orientation
    const crossSign = Math.sign(cross.x + cross.y + cross.z);

    if (crossSign === 0) continue; // Point is on the edge

    if (sign === null) {
      sign = crossSign;
    } else if (sign !== crossSign) {
      return false; // Point is on different sides of edges
    }
  }

  return true;
}

/**
 * Computes cell vertices for enclosure testing.
 * Returns sorted vertices as THREE.Vector3.
 */
export function computeCellVerticesForEnclosure(displayInfo: ISEA3HCellDisplayInfo): THREE.Vector3[] {
  return computeCellVertices(displayInfo);
}

/**
 * Computes distance between two cells (using their barycenters).
 */
export function cellDistance(cell1: ISEA3HCell, cell2: ISEA3HCell): number {
  const b1 = computeBarycenter(cell1);
  const b2 = computeBarycenter(cell2);
  return b1.distanceTo(b2);
}
