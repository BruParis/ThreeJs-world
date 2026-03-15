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
 * Result of cell computation - intrinsic info only.
 */
export interface ISEA3HCellResult {
  cell: ISEA3HCell;
  barycenter: THREE.Vector3;
  isSquareCell: boolean;
  isValid: boolean;
  validationMessage: string;
}

/**
 * Display info for a single cell in the hierarchy.
 */
export interface ISEA3HCellDisplayInfo {
  cell: ISEA3HCell;
  barycenter: THREE.Vector3;
  isSquareCell: boolean;
  cellVertices: THREE.Vector3[];  // Vertices of the hexagon/square (from central child's neighbors)
  neighborBarycenters: THREE.Vector3[];  // For debug display
  isSelected: boolean;  // True if this is the cell that encloses the original point
  alternativeCells?: ISEA3HCellDisplayInfo[];  // Other parent cells to display (when not central child)
}

/**
 * Complete display hierarchy from level n down to level 1.
 */
export interface ISEA3HDisplayHierarchy {
  levels: ISEA3HCellDisplayInfo[];  // Index 0 = level n, last = level 1
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

  // For odd n: |a|, |b|, |c| must all be congruent to each other modulo 3
  if (n % 2 === 1) {
    const modAbsA = Math.abs(a) % 3;
    const modAbsB = Math.abs(b) % 3;
    const modAbsC = Math.abs(c) % 3;

    if (modAbsA !== modAbsB || modAbsB !== modAbsC) {
      return {
        isValid: false,
        message: `For odd n, |a|, |b|, |c| must be congruent mod 3. Got |a|≡${modAbsA}, |b|≡${modAbsB}, |c|≡${modAbsC} (mod 3)`
      };
    }
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
  console.log("Get neighbors for cell:", formatCell(cell), "with normFactor:", normFactor);

  // Check if this is a square cell
  if (isSquareCell(cell)) {
    // Square cells have 4 neighbors
    // They are at octahedron vertices, so we need special handling
    console.log("   -> is a square cell, using special neighbor logic");
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
      console.log("delta:", da, db, dc);
      const neighbor = computeNeighborWithSignConvention(n, a, b, c, da, db, dc, normFactor);
      console.log("   neighbor:", neighbor ? formatCell(neighbor) : "invalid");
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
  console.log("   new neighbor coords:", newA, newB, newC, "absSum:", absSum);
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
 * Gets the central child of a cell (at level n+1).
 * The central child is the child cell that has the same barycenter direction as the parent.
 */
export function getCentralChild(cell: ISEA3HCell): ISEA3HCell {
  const { n, a, b, c } = cell;

  if (n % 2 === 0) {
    // Even n: central child at n+1 has same coordinates
    return { n: n + 1, a: a * 3, b: b * 3, c: c * 3 };
  } else {
    // Odd n: central child at n+1 has coordinates * 3
    return { n: n + 1, a, b, c };
  }
}

/**
 * Computes the intrinsic ISEA3H cell info (no neighbors).
 */
export function computeISEA3HCell(cell: ISEA3HCell): ISEA3HCellResult {
  const validation = validateISEA3HCell(cell);

  if (!validation.isValid) {
    return {
      cell,
      barycenter: new THREE.Vector3(),
      isSquareCell: false,
      isValid: false,
      validationMessage: validation.message,
    };
  }

  const barycenter = computeBarycenter(cell);
  const squareCell = isSquareCell(cell);

  return {
    cell,
    barycenter,
    isSquareCell: squareCell,
    isValid: true,
    validationMessage: validation.message,
  };
}

/**
 * Computes cell display info for a single cell.
 *
 * Cell vertices are the barycenters of the central child's neighbors:
 * 1. Get the central child of the original cell (at level n+1)
 * 2. Get the neighbors of that central child (at level n+1)
 * 3. The barycenters of those neighbors are the cell vertices
 * 4. Sort by angle and connect i -> i+1
 *
 * neighborBarycenters are the original cell's neighbors (at level n) for debug display.
 */
function computeCellDisplayInfo(cell: ISEA3HCell, isSelected: boolean): ISEA3HCellDisplayInfo {
  const barycenter = computeBarycenter(cell);
  const squareCell = isSquareCell(cell);

  // Get the original cell's neighbors (at level n) - for debug display as points
  const originalNeighbors = getNeighbors(cell);
  const neighborBarycenters = originalNeighbors.map(n => computeBarycenter(n));

  // Get the central child at level n+1
  const centralChild = getCentralChild(cell);

  // Get neighbors of central child (at level n+1) - their barycenters are the cell vertices
  const centralChildNeighbors = getNeighbors(centralChild);
  const centralChildNeighborBarycenters = centralChildNeighbors.map(n => computeBarycenter(n));

  // Sort vertices by angle for proper polygon rendering
  const cellVertices = [...centralChildNeighborBarycenters];
  if (cellVertices.length >= 3) {
    sortVerticesByAngle(barycenter, cellVertices);
  }

  return {
    cell,
    barycenter,
    isSquareCell: squareCell,
    cellVertices,
    neighborBarycenters,  // Original cell's neighbors for debug
    isSelected,
  };
}

/**
 * Gets all unique parent cells from central neighbors of a non-central cell.
 */
function getAllParentCellsFromCentralNeighbors(cell: ISEA3HCell): ISEA3HCell[] {
  const neighbors = getNeighbors(cell);
  const centralNeighbors = neighbors.filter(n => isCentralChild(n));

  const parentCells: ISEA3HCell[] = [];
  const parentCellKeys = new Set<string>();

  for (const centralNeighbor of centralNeighbors) {
    const parent = getParentCell(centralNeighbor);
    if (parent) {
      const key = `${parent.n},${parent.a},${parent.b},${parent.c}`;
      if (!parentCellKeys.has(key)) {
        parentCellKeys.add(key);
        parentCells.push(parent);
      }
    }
  }

  return parentCells;
}

/**
 * Finds the parent cell that encloses the reference point.
 * Falls back to the closest parent if none enclose the point.
 */
function findEnclosingParent(
  parentCells: ISEA3HCell[],
  referencePoint: THREE.Vector3
): { selected: ISEA3HCell; alternatives: ISEA3HCell[] } | null {
  if (parentCells.length === 0) return null;

  let selectedParent: ISEA3HCell | null = null;
  const alternativeParents: ISEA3HCell[] = [];

  for (const parent of parentCells) {
    const parentVertices = computeCellVerticesForEnclosure(parent);
    if (parentVertices.length >= 3 && isPointInPolygon(referencePoint, parentVertices)) {
      if (!selectedParent) {
        selectedParent = parent;
      } else {
        alternativeParents.push(parent);
      }
    } else {
      alternativeParents.push(parent);
    }
  }

  // If no enclosing parent found, use the closest one
  if (!selectedParent) {
    let closestDist = Infinity;
    for (const parent of parentCells) {
      const dist = computeBarycenter(parent).distanceTo(referencePoint);
      if (dist < closestDist) {
        closestDist = dist;
        selectedParent = parent;
      }
    }
    // Remove selected from alternatives
    if (selectedParent) {
      const selectedKey = `${selectedParent.n},${selectedParent.a},${selectedParent.b},${selectedParent.c}`;
      for (let i = alternativeParents.length - 1; i >= 0; i--) {
        const key = `${alternativeParents[i].n},${alternativeParents[i].a},${alternativeParents[i].b},${alternativeParents[i].c}`;
        if (key === selectedKey) {
          alternativeParents.splice(i, 1);
        }
      }
    }
  }

  if (!selectedParent) return null;

  return { selected: selectedParent, alternatives: alternativeParents };
}

/**
 * Computes the display hierarchy for a cell at level n.
 *
 * Algorithm:
 * 1. Start at level n, get the central child at n+1
 * 2. Compute neighbors of central child → these are vertices for level n
 * 3. Go up the hierarchy: for each level, if not central, show ALL parents
 *    of central neighbors, but only select the one that encloses the original
 *    point for continuing up the hierarchy.
 *
 * @param cell The cell at level n
 * @param hoverPoint Optional point for choosing closest central neighbor when cell is not central
 */
export function computeDisplayHierarchy(
  cell: ISEA3HCell,
  hoverPoint?: THREE.Vector3
): ISEA3HDisplayHierarchy {
  const levels: ISEA3HCellDisplayInfo[] = [];

  // Store the original reference point for enclosure testing throughout the hierarchy
  const referencePoint = hoverPoint || computeBarycenter(cell);

  // Push first level (the input cell)
  levels.push(computeCellDisplayInfo(cell, true));

  if (cell.n <= 1) {
    return { levels };
  }

  let currentCell = cell;

  // Process from level n-1 down to level 1
  while (true) {
    let nextCell: ISEA3HCell | null = null;
    let nextDisplayInfo: ISEA3HCellDisplayInfo | null = null;

    if (isCentralChild(currentCell)) {
      // Direct parent - single cell, no alternatives
      nextCell = getParentCell(currentCell);
      if (!nextCell) break;
      nextDisplayInfo = computeCellDisplayInfo(nextCell, true);
    } else {
      // Not a central child - get ALL central neighbors and their parents
      const parentCells = getAllParentCellsFromCentralNeighbors(currentCell);

      if (parentCells.length === 0) {
        console.warn('No parent cells found for non-central cell:', formatCell(currentCell));
        break;
      }

      // Find which parent encloses the reference point
      const result = findEnclosingParent(parentCells, referencePoint);
      if (!result) break;

      nextCell = result.selected;
      nextDisplayInfo = computeCellDisplayInfo(nextCell, true);

      // Add alternative parents for display
      if (result.alternatives.length > 0) {
        nextDisplayInfo.alternativeCells = result.alternatives.map(p =>
          computeCellDisplayInfo(p, false)
        );
      }
    }

    if (!nextCell || !nextDisplayInfo) break;

    levels.push(nextDisplayInfo);

    if (nextCell.n <= 1) break;

    currentCell = nextCell;
  }

  return { levels };
}

/**
 * Checks if a point is inside a convex polygon on the octahedron surface.
 * Uses the cross product approach: point is inside if it's on the same side of all edges.
 */
function isPointInPolygon(point: THREE.Vector3, vertices: THREE.Vector3[]): boolean {
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
 * Computes the cell vertices for a given cell (for enclosure testing).
 * Uses the same approach as computeCellDisplayInfo.
 */
function computeCellVerticesForEnclosure(cell: ISEA3HCell): THREE.Vector3[] {
  const barycenter = computeBarycenter(cell);
  const centralChild = getCentralChild(cell);
  const centralChildNeighbors = getNeighbors(centralChild);
  const neighborBarycenters = centralChildNeighbors.map(n => computeBarycenter(n));

  if (neighborBarycenters.length < 3) return [];

  const vertices = [...neighborBarycenters];
  sortVerticesByAngle(barycenter, vertices);

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
