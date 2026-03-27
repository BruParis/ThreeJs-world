/**
 * QuadTree cell encoding for a cube-based spherical grid.
 *
 * Each cell is identified by:
 * - face: which cube face (0-5: +X, -X, +Y, -Y, +Z, -Z)
 * - level: depth in the quadtree (0 = entire face, 1 = 4 cells, etc.)
 * - x, y: position within the face grid [0, 2^level - 1]
 */

/**
 * Cube face identifiers
 */
export enum CubeFace {
  PLUS_X = 0,
  MINUS_X = 1,
  PLUS_Y = 2,
  MINUS_Y = 3,
  PLUS_Z = 4,
  MINUS_Z = 5,
}

/**
 * QuadTree cell encoding
 */
export interface QuadTreeCell {
  face: CubeFace;
  level: number;
  x: number;
  y: number;
}

/**
 * Display info for a cell in the hierarchy
 */
export interface QuadTreeCellDisplayInfo {
  cell: QuadTreeCell;
  isSelected: boolean;
  /** Set of quadrant indices (0-3) that contain children and should not be rendered */
  childQuadrants?: Set<number>;
}

/**
 * Complete display hierarchy from current level up to level 0
 */
export interface QuadTreeDisplayHierarchy {
  levels: QuadTreeCellDisplayInfo[];
}

/**
 * Returns the grid size at a given level (2^level)
 */
export function getGridSize(level: number): number {
  return Math.pow(2, level);
}

/**
 * Validates a QuadTree cell encoding.
 */
export function validateQuadTreeCell(cell: QuadTreeCell): { isValid: boolean; message: string } {
  const { face, level, x, y } = cell;

  // Check face is valid
  if (face < 0 || face > 5) {
    return { isValid: false, message: `Invalid face: ${face}. Must be 0-5.` };
  }

  // Check level is non-negative
  if (!Number.isInteger(level) || level < 0) {
    return { isValid: false, message: `Level must be a non-negative integer, got ${level}` };
  }

  // Check x and y are valid for this level
  const gridSize = getGridSize(level);
  if (!Number.isInteger(x) || x < 0 || x >= gridSize) {
    return { isValid: false, message: `x must be in [0, ${gridSize - 1}] for level ${level}, got ${x}` };
  }
  if (!Number.isInteger(y) || y < 0 || y >= gridSize) {
    return { isValid: false, message: `y must be in [0, ${gridSize - 1}] for level ${level}, got ${y}` };
  }

  return { isValid: true, message: 'Valid cell' };
}

/**
 * Gets the parent cell (one level up in the hierarchy).
 * Returns null if already at level 0.
 */
export function getParentCell(cell: QuadTreeCell): QuadTreeCell | null {
  if (cell.level === 0) {
    return null;
  }

  return {
    face: cell.face,
    level: cell.level - 1,
    x: Math.floor(cell.x / 2),
    y: Math.floor(cell.y / 2),
  };
}

/**
 * Gets the four child cells (one level down in the hierarchy).
 */
export function getChildCells(cell: QuadTreeCell): QuadTreeCell[] {
  const newLevel = cell.level + 1;
  const baseX = cell.x * 2;
  const baseY = cell.y * 2;

  return [
    { face: cell.face, level: newLevel, x: baseX, y: baseY },
    { face: cell.face, level: newLevel, x: baseX + 1, y: baseY },
    { face: cell.face, level: newLevel, x: baseX, y: baseY + 1 },
    { face: cell.face, level: newLevel, x: baseX + 1, y: baseY + 1 },
  ];
}

/**
 * Gets the neighbor cells (same level, adjacent cells).
 * Returns up to 4 neighbors (some may be on different faces at boundaries).
 * For simplicity, this version only returns neighbors on the same face.
 */
export function getNeighborCells(cell: QuadTreeCell): QuadTreeCell[] {
  const { face, level, x, y } = cell;
  const gridSize = getGridSize(level);
  const neighbors: QuadTreeCell[] = [];

  // Left neighbor
  if (x > 0) {
    neighbors.push({ face, level, x: x - 1, y });
  }
  // Right neighbor
  if (x < gridSize - 1) {
    neighbors.push({ face, level, x: x + 1, y });
  }
  // Bottom neighbor
  if (y > 0) {
    neighbors.push({ face, level, x, y: y - 1 });
  }
  // Top neighbor
  if (y < gridSize - 1) {
    neighbors.push({ face, level, x, y: y + 1 });
  }

  return neighbors;
}

/**
 * Computes the display hierarchy for a cell (from current level up to level 0).
 */
export function computeDisplayHierarchy(cell: QuadTreeCell): QuadTreeDisplayHierarchy {
  const levels: QuadTreeCellDisplayInfo[] = [];

  let currentCell: QuadTreeCell | null = cell;
  let isFirst = true;

  while (currentCell !== null) {
    levels.push({
      cell: currentCell,
      isSelected: isFirst,
    });
    isFirst = false;
    currentCell = getParentCell(currentCell);
  }

  return { levels };
}

/**
 * Formats a cell as a string for display.
 */
export function formatCell(cell: QuadTreeCell): string {
  const faceNames = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  return `Face ${faceNames[cell.face]}, L${cell.level}, (${cell.x}, ${cell.y})`;
}

/**
 * Creates a unique key string for a cell.
 */
export function cellKey(cell: QuadTreeCell): string {
  return `${cell.face},${cell.level},${cell.x},${cell.y}`;
}

/**
 * Checks if two cells are equal.
 */
export function cellsEqual(cell1: QuadTreeCell, cell2: QuadTreeCell): boolean {
  return cell1.face === cell2.face &&
         cell1.level === cell2.level &&
         cell1.x === cell2.x &&
         cell1.y === cell2.y;
}

/**
 * Gets the face name as a string.
 */
export function getFaceName(face: CubeFace): string {
  const names = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  return names[face];
}
