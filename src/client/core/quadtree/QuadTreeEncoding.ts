/**
 * QuadTree cell encoding for a cube-based spherical grid.
 *
 * Each cell is identified by:
 * - face: which cube face (0-5: +X, -X, +Y, -Y, +Z, -Z)
 * - level: depth in the quadtree (0 = entire face, 1 = 4 cells, etc.)
 * - x, y: position within the face grid [0, 2^level - 1]
 *
 * This module has zero external dependencies and can be used standalone.
 */

export enum CubeFace {
  PLUS_X = 0,
  MINUS_X = 1,
  PLUS_Y = 2,
  MINUS_Y = 3,
  PLUS_Z = 4,
  MINUS_Z = 5,
}

export interface QuadTreeCell {
  face: CubeFace;
  level: number;
  x: number;
  y: number;
}

/**
 * Returns the grid size at a given level (2^level).
 */
export function getGridSize(level: number): number {
  return Math.pow(2, level);
}

/**
 * Validates a QuadTree cell encoding.
 */
export function validateQuadTreeCell(cell: QuadTreeCell): { isValid: boolean; message: string } {
  const { face, level, x, y } = cell;

  if (face < 0 || face > 5) {
    return { isValid: false, message: `Invalid face: ${face}. Must be 0-5.` };
  }
  if (!Number.isInteger(level) || level < 0) {
    return { isValid: false, message: `Level must be a non-negative integer, got ${level}` };
  }

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
 * Gets the parent cell (one level up). Returns null at level 0.
 */
export function getParentCell(cell: QuadTreeCell): QuadTreeCell | null {
  if (cell.level === 0) return null;
  return {
    face: cell.face,
    level: cell.level - 1,
    x: Math.floor(cell.x / 2),
    y: Math.floor(cell.y / 2),
  };
}

/**
 * Gets the four child cells (one level down).
 */
export function getChildCells(cell: QuadTreeCell): QuadTreeCell[] {
  const newLevel = cell.level + 1;
  const baseX = cell.x * 2;
  const baseY = cell.y * 2;
  return [
    { face: cell.face, level: newLevel, x: baseX,     y: baseY },
    { face: cell.face, level: newLevel, x: baseX + 1, y: baseY },
    { face: cell.face, level: newLevel, x: baseX,     y: baseY + 1 },
    { face: cell.face, level: newLevel, x: baseX + 1, y: baseY + 1 },
  ];
}

/**
 * Gets same-level neighbors on the same cube face.
 * Cross-face neighbours are not yet implemented.
 */
export function getNeighborCells(cell: QuadTreeCell): QuadTreeCell[] {
  const { face, level, x, y } = cell;
  const gridSize = getGridSize(level);
  const neighbors: QuadTreeCell[] = [];

  if (x > 0)            neighbors.push({ face, level, x: x - 1, y });
  if (x < gridSize - 1) neighbors.push({ face, level, x: x + 1, y });
  if (y > 0)            neighbors.push({ face, level, x, y: y - 1 });
  if (y < gridSize - 1) neighbors.push({ face, level, x, y: y + 1 });

  return neighbors;
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
  return ['+X', '-X', '+Y', '-Y', '+Z', '-Z'][face];
}
