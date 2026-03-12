import * as THREE from 'three';

/**
 * ISEA3H cell encoding represented by resolution level and triplet coordinates.
 */
export interface ISEA3HCell {
  n: number;       // Resolution level (0, 1, 2, ...)
  a: number;       // First coordinate
  b: number;       // Second coordinate
  c: number;       // Third coordinate
}

/**
 * Result of cell computation including barycenter and neighbors.
 */
export interface ISEA3HCellResult {
  cell: ISEA3HCell;
  barycenter: THREE.Vector3;
  isSquareCell: boolean;
  neighbors: ISEA3HCell[];
  neighborBarycenters: THREE.Vector3[];
  cellVertices: THREE.Vector3[];  // Vertices of the hexagon/square
  isValid: boolean;
  validationMessage: string;
}

/**
 * Computes 3^k for integer k >= 0.
 */
function pow3(k: number): number {
  return Math.pow(3, k);
}

/**
 * Gets the normalization factor for a given resolution level.
 * - If n is even: 3^(n/2)
 * - If n is odd: 3^((n+1)/2)
 */
export function getNormalizationFactor(n: number): number {
  if (n % 2 === 0) {
    return pow3(n / 2);
  } else {
    return pow3((n + 1) / 2);
  }
}

/**
 * Validates an ISEA3H cell encoding.
 * Returns an object with isValid flag and validation message.
 */
export function validateISEA3HCell(cell: ISEA3HCell): { isValid: boolean; message: string } {
  const { n, a, b, c } = cell;

  // Check n is non-negative integer
  if (!Number.isInteger(n) || n < 0) {
    return { isValid: false, message: `Resolution level n must be a non-negative integer, got ${n}` };
  }

  // Check a, b, c are integers
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
    return { isValid: false, message: `Coordinates (a, b, c) must be integers` };
  }

  // Check the sum constraint: |a| + |b| + |c| = normalization factor
  const normFactor = getNormalizationFactor(n);
  const absSum = Math.abs(a) + Math.abs(b) + Math.abs(c);

  if (absSum !== normFactor) {
    return {
      isValid: false,
      message: `|a| + |b| + |c| = ${absSum}, but should be ${normFactor} for n=${n}`
    };
  }

  return { isValid: true, message: 'Valid cell' };
}

/**
 * Checks if a cell is a square cell (at an octahedron vertex).
 * Square cells occur when one coordinate equals the normalization factor.
 */
export function isSquareCell(cell: ISEA3HCell): boolean {
  const normFactor = getNormalizationFactor(cell.n);
  const { a, b, c } = cell;

  // A square cell has one coordinate equal to ±normFactor (and others = 0)
  return Math.abs(a) === normFactor || Math.abs(b) === normFactor || Math.abs(c) === normFactor;
}

/**
 * Computes the barycenter position from cell coordinates.
 * The barycenter is at (a, b, c) / normFactor, normalized to the unit octahedron.
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
 * Gets the neighbor cells for a given cell.
 * For hexagonal cells: 6 neighbors
 * For square cells: 4 neighbors
 */
export function getNeighbors(cell: ISEA3HCell): ISEA3HCell[] {
  const { n, a, b, c } = cell;
  const neighbors: ISEA3HCell[] = [];
  const normFactor = getNormalizationFactor(n);

  // Check if this is a square cell
  if (isSquareCell(cell)) {
    // Square cells have 4 neighbors
    // They are at octahedron vertices, so we need special handling
    return getSquareCellNeighbors(cell);
  }

  // Hexagonal cell neighbors
  if (n % 2 === 0) {
    // Even n: neighbors differ by 1 in two coordinates
    // (a+1, b-1, c), (a+1, b, c-1), (a, b+1, c-1),
    // (a-1, b+1, c), (a-1, b, c+1), (a, b-1, c+1)
    const deltas = [
      [1, -1, 0],
      [1, 0, -1],
      [0, 1, -1],
      [-1, 1, 0],
      [-1, 0, 1],
      [0, -1, 1],
    ];

    for (const [da, db, dc] of deltas) {
      const neighbor = computeNeighborWithSignConvention(n, a, b, c, da, db, dc, normFactor);
      if (neighbor) {
        neighbors.push(neighbor);
      }
    }
  } else {
    // Odd n: neighbors differ by 2 in one coordinate and 1 in others
    // (a+2, b-1, c-1), (a-1, b+2, c-1), (a-1, b-1, c+2),
    // (a-2, b+1, c+1), (a+1, b-2, c+1), (a+1, b+1, c-2)
    const deltas = [
      [2, -1, -1],
      [-1, 2, -1],
      [-1, -1, 2],
      [-2, 1, 1],
      [1, -2, 1],
      [1, 1, -2],
    ];

    for (const [da, db, dc] of deltas) {
      const neighbor = computeNeighborWithSignConvention(n, a, b, c, da, db, dc, normFactor);
      if (neighbor) {
        neighbors.push(neighbor);
      }
    }
  }

  return neighbors;
}

/**
 * Computes a neighbor with sign convention handling.
 */
function computeNeighborWithSignConvention(
  n: number,
  a: number, b: number, c: number,
  da: number, db: number, dc: number,
  normFactor: number
): ISEA3HCell | null {
  // Apply sign convention: sign changes if the coordinate is negative
  let effectiveDa = da;
  let effectiveDb = db;
  let effectiveDc = dc;

  if (a < 0) effectiveDa = -da;
  if (b < 0) effectiveDb = -db;
  if (c < 0) effectiveDc = -dc;

  // Handle the special case of subtracting from 0
  // If coord is 0 and we're subtracting, flip signs of other deltas
  if (a === 0 && da < 0) {
    effectiveDb = -effectiveDb;
    effectiveDc = -effectiveDc;
  }
  if (b === 0 && db < 0) {
    effectiveDa = -effectiveDa;
    effectiveDc = -effectiveDc;
  }
  if (c === 0 && dc < 0) {
    effectiveDa = -effectiveDa;
    effectiveDb = -effectiveDb;
  }

  const newA = a + effectiveDa;
  const newB = b + effectiveDb;
  const newC = c + effectiveDc;

  // Validate the neighbor
  const absSum = Math.abs(newA) + Math.abs(newB) + Math.abs(newC);
  if (absSum !== normFactor) {
    return null;
  }

  return { n, a: newA, b: newB, c: newC };
}

/**
 * Gets neighbors for a square cell (4 neighbors).
 */
function getSquareCellNeighbors(cell: ISEA3HCell): ISEA3HCell[] {
  const { n, a, b, c } = cell;
  const normFactor = getNormalizationFactor(cell.n);
  const neighbors: ISEA3HCell[] = [];

  // Determine which coordinate is at the extreme
  if (Math.abs(a) === normFactor) {
    // Vertex on X axis, neighbors vary in b and c
    const sign = Math.sign(a);
    if (n % 2 === 0) {
      // Even n
      neighbors.push({ n, a: sign * (normFactor - 1), b: 1, c: 0 });
      neighbors.push({ n, a: sign * (normFactor - 1), b: 0, c: 1 });
      neighbors.push({ n, a: sign * (normFactor - 1), b: -1, c: 0 });
      neighbors.push({ n, a: sign * (normFactor - 1), b: 0, c: -1 });
    } else {
      // Odd n
      neighbors.push({ n, a: sign * (normFactor - 2), b: 1, c: 1 });
      neighbors.push({ n, a: sign * (normFactor - 2), b: 1, c: -1 });
      neighbors.push({ n, a: sign * (normFactor - 2), b: -1, c: 1 });
      neighbors.push({ n, a: sign * (normFactor - 2), b: -1, c: -1 });
    }
  } else if (Math.abs(b) === normFactor) {
    // Vertex on Y axis
    const sign = Math.sign(b);
    if (n % 2 === 0) {
      neighbors.push({ n, a: 1, b: sign * (normFactor - 1), c: 0 });
      neighbors.push({ n, a: 0, b: sign * (normFactor - 1), c: 1 });
      neighbors.push({ n, a: -1, b: sign * (normFactor - 1), c: 0 });
      neighbors.push({ n, a: 0, b: sign * (normFactor - 1), c: -1 });
    } else {
      neighbors.push({ n, a: 1, b: sign * (normFactor - 2), c: 1 });
      neighbors.push({ n, a: 1, b: sign * (normFactor - 2), c: -1 });
      neighbors.push({ n, a: -1, b: sign * (normFactor - 2), c: 1 });
      neighbors.push({ n, a: -1, b: sign * (normFactor - 2), c: -1 });
    }
  } else {
    // Vertex on Z axis
    const sign = Math.sign(c);
    if (n % 2 === 0) {
      neighbors.push({ n, a: 1, b: 0, c: sign * (normFactor - 1) });
      neighbors.push({ n, a: 0, b: 1, c: sign * (normFactor - 1) });
      neighbors.push({ n, a: -1, b: 0, c: sign * (normFactor - 1) });
      neighbors.push({ n, a: 0, b: -1, c: sign * (normFactor - 1) });
    } else {
      neighbors.push({ n, a: 1, b: 1, c: sign * (normFactor - 2) });
      neighbors.push({ n, a: 1, b: -1, c: sign * (normFactor - 2) });
      neighbors.push({ n, a: -1, b: 1, c: sign * (normFactor - 2) });
      neighbors.push({ n, a: -1, b: -1, c: sign * (normFactor - 2) });
    }
  }

  return neighbors;
}

/**
 * Checks if a cell is a central child (can be directly traced to parent).
 */
export function isCentralChild(cell: ISEA3HCell): boolean {
  const { n, a, b, c } = cell;

  if (n === 0) return true; // Base level is always "central"

  if (n % 2 === 0) {
    // Even n: a, b, c are congruent modulo 3
    const modA = ((a % 3) + 3) % 3;
    const modB = ((b % 3) + 3) % 3;
    const modC = ((c % 3) + 3) % 3;
    return modA === modB && modB === modC;
  } else {
    // Odd n: a, b, c are congruent to 0 modulo 3
    return a % 3 === 0 && b % 3 === 0 && c % 3 === 0;
  }
}

/**
 * Gets the parent cell at level n-1.
 * If the cell is not a central child, returns null.
 */
export function getParentCell(cell: ISEA3HCell): ISEA3HCell | null {
  const { n, a, b, c } = cell;

  if (n === 0) return null; // No parent for base level

  if (n % 2 === 0) {
    // Even n: parent has same coordinates
    return { n: n - 1, a, b, c };
  } else {
    // Odd n: parent has coordinates divided by 3
    if (a % 3 !== 0 || b % 3 !== 0 || c % 3 !== 0) {
      return null; // Not a central child
    }
    return { n: n - 1, a: a / 3, b: b / 3, c: c / 3 };
  }
}

/**
 * Gets a central cell from which we can go up to parent level.
 * If the cell is already central, returns itself.
 * Otherwise, finds the closest neighboring central cell (Rule 6).
 */
export function getCentralCellForParent(cell: ISEA3HCell): ISEA3HCell {
  if (isCentralChild(cell)) {
    return cell;
  }

  // Find the closest neighboring cell that is central
  const neighbors = getNeighbors(cell);
  const cellBarycenter = computeBarycenter(cell);

  let closestCentral: ISEA3HCell | null = null;
  let closestDistance = Infinity;

  for (const neighbor of neighbors) {
    console.log("formatCell(neighbor):", formatCell(neighbor));
    if (isCentralChild(neighbor)) {
      console.log("   -> is central");
      const neighborBarycenter = computeBarycenter(neighbor);
      const distance = cellBarycenter.distanceTo(neighborBarycenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestCentral = neighbor;
      }
    }
  }

  if (closestCentral) {
    return closestCentral;
  }

  // Fallback: return the original cell (shouldn't happen with valid encoding)
  console.warn('Could not find central neighbor for cell:', cell);
  return cell;
}

/**
 * Computes the full ISEA3H cell result including barycenter, neighbors, and cell vertices.
 */
export function computeISEA3HCell(cell: ISEA3HCell): ISEA3HCellResult {
  const validation = validateISEA3HCell(cell);

  if (!validation.isValid) {
    return {
      cell,
      barycenter: new THREE.Vector3(),
      isSquareCell: false,
      neighbors: [],
      neighborBarycenters: [],
      cellVertices: [],
      isValid: false,
      validationMessage: validation.message,
    };
  }

  const barycenter = computeBarycenter(cell);
  const squareCell = isSquareCell(cell);
  const neighbors = getNeighbors(cell);
  const neighborBarycenters = neighbors.map(n => computeBarycenter(n));

  // Compute cell vertices from neighbor edge midpoints
  const cellVertices = computeCellVertices(barycenter, neighborBarycenters);

  return {
    cell,
    barycenter,
    isSquareCell: squareCell,
    neighbors,
    neighborBarycenters,
    cellVertices,
    isValid: true,
    validationMessage: validation.message,
  };
}

/**
 * Computes the vertices of a cell (hexagon or square) from the midpoints
 * of edges to neighboring cells.
 */
function computeCellVertices(
  barycenter: THREE.Vector3,
  neighborBarycenters: THREE.Vector3[]
): THREE.Vector3[] {
  const vertices: THREE.Vector3[] = [];

  for (const neighborCenter of neighborBarycenters) {
    // The vertex is at the midpoint between this cell and its neighbor
    const midpoint = new THREE.Vector3()
      .addVectors(barycenter, neighborCenter)
      .multiplyScalar(0.5);
    vertices.push(midpoint);
  }

  // Sort vertices by angle around barycenter for proper polygon ordering
  if (vertices.length > 2) {
    sortVerticesByAngle(barycenter, vertices);
  }

  return vertices;
}

/**
 * Sorts vertices by angle around the barycenter for proper polygon rendering.
 */
function sortVerticesByAngle(center: THREE.Vector3, vertices: THREE.Vector3[]): void {
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
 * Formats a cell as a string for display.
 */
export function formatCell(cell: ISEA3HCell): string {
  return `n=${cell.n}, (${cell.a}, ${cell.b}, ${cell.c})`;
}
