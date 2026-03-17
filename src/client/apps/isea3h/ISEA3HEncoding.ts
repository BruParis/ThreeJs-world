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
  isSquareCell: boolean;
  isValid: boolean;
  validationMessage: string;
}

/**
 * Display info for a single cell in the hierarchy.
 * All positions are represented as ISEA3HCell encodings.
 */
export interface ISEA3HCellDisplayInfo {
  cell: ISEA3HCell;
  isSquareCell: boolean;
  cellVertexCells: ISEA3HCell[];  // Cells whose barycenters form the hexagon/square vertices
  neighborCells: ISEA3HCell[];    // Neighbor cells for debug display
  isSelected: boolean;            // True if this is the cell that encloses the original point
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
 * n acts as a scaling factor:
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
    // Even n: a, b, c are congruent to each other modulo 3
    const modA = Math.abs(a) % 3;
    const modB = Math.abs(b) % 3;
    const modC = Math.abs(c) % 3;

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

  if (n === 1) return null; // No parent for base level

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
 * Computes the intrinsic ISEA3H cell info (encoding only).
 */
export function computeISEA3HCell(cell: ISEA3HCell): ISEA3HCellResult {
  const validation = validateISEA3HCell(cell);

  if (!validation.isValid) {
    return {
      cell,
      isSquareCell: false,
      isValid: false,
      validationMessage: validation.message,
    };
  }

  const squareCell = isSquareCell(cell);

  return {
    cell,
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
 *
 * neighborCells are the original cell's neighbors (at level n) for debug display.
 */
function computeCellDisplayInfo(cell: ISEA3HCell, isSelected: boolean): ISEA3HCellDisplayInfo {
  const squareCell = isSquareCell(cell);

  // Get the original cell's neighbors (at level n) - for debug display
  const neighborCells = getNeighbors(cell);

  // Get the central child at level n+1
  const centralChild = getCentralChild(cell);

  // Get neighbors of central child (at level n+1) - their barycenters are the cell vertices
  const cellVertexCells = getNeighbors(centralChild);

  return {
    cell,
    isSquareCell: squareCell,
    cellVertexCells,
    neighborCells,
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
 * Computes the display hierarchy for a cell at level n.
 *
 * Algorithm:
 * 1. Start at level n, get the central child at n+1
 * 2. Compute neighbors of central child → these are vertices for level n
 * 3. Go up the hierarchy: for each level, if not central, show ALL parents
 *    of central neighbors
 *
 * @param cell The cell at level n
 * @param findEnclosingParent Optional callback to find which parent encloses a reference point
 *        Returns { selected: ISEA3HCell, alternatives: ISEA3HCell[] }
 */
export function computeDisplayHierarchy(
  cell: ISEA3HCell,
  findEnclosingParent?: (parentCells: ISEA3HCell[], currentCell: ISEA3HCell) => { selected: ISEA3HCell; alternatives: ISEA3HCell[] } | null
): ISEA3HDisplayHierarchy {
  const levels: ISEA3HCellDisplayInfo[] = [];

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

      // Use callback to find which parent encloses the reference point
      if (findEnclosingParent) {
        const result = findEnclosingParent(parentCells, currentCell);
        if (!result) {
          // Fallback: use first parent
          nextCell = parentCells[0];
          nextDisplayInfo = computeCellDisplayInfo(nextCell, true);
          if (parentCells.length > 1) {
            nextDisplayInfo.alternativeCells = parentCells.slice(1).map(p =>
              computeCellDisplayInfo(p, false)
            );
          }
        } else {
          nextCell = result.selected;
          nextDisplayInfo = computeCellDisplayInfo(nextCell, true);
          if (result.alternatives.length > 0) {
            nextDisplayInfo.alternativeCells = result.alternatives.map(p =>
              computeCellDisplayInfo(p, false)
            );
          }
        }
      } else {
        // No callback - just use first parent and show others as alternatives
        nextCell = parentCells[0];
        nextDisplayInfo = computeCellDisplayInfo(nextCell, true);
        if (parentCells.length > 1) {
          nextDisplayInfo.alternativeCells = parentCells.slice(1).map(p =>
            computeCellDisplayInfo(p, false)
          );
        }
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
 * Gets a central cell from which we can go up to parent level.
 * If the cell is already central, returns itself.
 * Otherwise, returns the first central neighbor found.
 *
 * Note: For geometric proximity-based selection, use the version in ISEA3HGeometry.
 */
export function getCentralCellForParent(cell: ISEA3HCell): ISEA3HCell {
  if (isCentralChild(cell)) {
    return cell;
  }

  // Find the first central neighbor
  const neighbors = getNeighbors(cell);

  for (const neighbor of neighbors) {
    if (isCentralChild(neighbor)) {
      return neighbor;
    }
  }

  // Fallback: return the original cell (shouldn't happen with valid encoding)
  console.warn('Could not find central neighbor for cell:', cell);
  return cell;
}

/**
 * Formats a cell as a string for display.
 */
export function formatCell(cell: ISEA3HCell): string {
  return `n=${cell.n}, (${cell.a}, ${cell.b}, ${cell.c})`;
}

/**
 * Creates a unique key string for a cell.
 */
export function cellKey(cell: ISEA3HCell): string {
  return `${cell.n},${cell.a},${cell.b},${cell.c}`;
}

/**
 * Checks if two cells are equal.
 */
export function cellsEqual(cell1: ISEA3HCell, cell2: ISEA3HCell): boolean {
  return cell1.n === cell2.n && cell1.a === cell2.a && cell1.b === cell2.b && cell1.c === cell2.c;
}
