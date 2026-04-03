/**
 * Presentation-layer utilities for QuadTree visualisation.
 *
 * Everything here is specific to how the quadtree tab renders and labels cells.
 * Pure logic lives in @core/quadtree; this file is intentionally not reusable.
 */

import { QuadTreeCell, getParentCell } from '@core/quadtree/QuadTreeEncoding';

// ── Display types ─────────────────────────────────────────────────────────────

/**
 * Rendering state for a single cell in the hover hierarchy.
 */
export interface QuadTreeCellDisplayInfo {
  cell: QuadTreeCell;
  isSelected: boolean;
  /** Quadrant indices (0-3) occupied by children — those quadrants are not rendered at this level */
  childQuadrants?: Set<number>;
}

/**
 * Complete ancestry chain from hovered cell up to the root (level 0).
 */
export interface QuadTreeDisplayHierarchy {
  levels: QuadTreeCellDisplayInfo[];
}

// ── Level colors ──────────────────────────────────────────────────────────────

/** Hex colors indexed by quadtree level (wraps beyond the last entry). */
export const LEVEL_COLORS: readonly number[] = [
  0xff0000, // L0  – red
  0xff8800, // L1  – orange
  0xffff00, // L2  – yellow
  0x88ff00, // L3  – lime
  0x00ff00, // L4  – green
  0x00ff88, // L5  – spring green
  0x00ffff, // L6  – cyan
  0x0088ff, // L7  – sky blue
  0x0000ff, // L8  – blue
  0x8800ff, // L9  – purple
  0xff00ff, // L10 – magenta
  0xff0088, // L11 – pink
  0xff4444, // L12 – light red
  0xffaa44, // L13 – light orange
  0xffff88, // L14 – light yellow
  0xaaffaa, // L15 – light green
  0x88ffff, // L16 – light cyan
  0xaaaaff, // L17 – light blue
  0xffaaff, // L18 – light magenta
  0xffffff, // L19 – white
  0xcccccc, // L20+ – gray
];

/** Returns the display color for a given LOD level. */
export function getLevelColor(level: number): number {
  return LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)];
}

// ── Hierarchy helpers ─────────────────────────────────────────────────────────

/**
 * Builds the ancestry chain from a leaf cell up to the root (level 0),
 * marking only the leaf as selected.
 */
export function computeDisplayHierarchy(cell: QuadTreeCell): QuadTreeDisplayHierarchy {
  const levels: QuadTreeCellDisplayInfo[] = [];
  let current: QuadTreeCell | null = cell;
  let isFirst = true;

  while (current !== null) {
    levels.push({ cell: current, isSelected: isFirst });
    isFirst = false;
    current = getParentCell(current);
  }

  return { levels };
}

/**
 * Formats a cell as a human-readable label string.
 */
export function formatCell(cell: QuadTreeCell): string {
  const faceNames = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  return `Face ${faceNames[cell.face]}, L${cell.level}, (${cell.x}, ${cell.y})`;
}
