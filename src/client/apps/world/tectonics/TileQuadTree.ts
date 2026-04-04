/**
 * Spatial index mapping quadtree cells to the tiles that overlap them.
 *
 * At a given resolution level each tile is associated with all cells whose
 * footprint it overlaps (centroid + vertices + edge midpoints).  The index
 * answers two kinds of queries efficiently:
 *
 *   - Point query  : given a sphere point, which tiles enclose it?
 *   - Patch query  : given a QuadTreeCell (or a list of cells), which tiles
 *                    overlap that patch?
 *
 * Cell queries support cells at any level, not just the index level:
 *   - coarser cells  → all descendant cells at index level are aggregated
 *   - finer cells    → the ancestor cell at index level is used
 */

import * as THREE from 'three';
import { Tile } from './data/Plate';
import {
  QuadTreeCell,
  cellKey,
  getGridSize,
  spherePointToCell,
} from '@core/quadtree';

export class TileQuadTree {
  readonly level: number;

  /** cell key → tiles overlapping that cell */
  private readonly cellToTiles: Map<string, Tile[]> = new Map();

  /** tile id → centroid cell (for reverse lookup) */
  private readonly tileToCentroidCell: Map<number, QuadTreeCell> = new Map();

  constructor(tiles: Iterable<Tile>, level: number) {
    this.level = level;
    this.build(tiles);
  }

  // ── Public query API ──────────────────────────────────────────────────────

  /**
   * Returns all tiles whose coverage includes the cell that contains `point`.
   *
   * If the exact cell has no registrations (coverage gap due to discrete
   * sampling), falls back to the 8 same-face neighbours.  This handles the
   * two main failure modes of the point-sampling build strategy:
   *   - interior gap  : a cell lies inside a tile polygon but no sample landed in it
   *   - boundary gap  : a cell is crossed by a tile edge between two sample points
   */
  queryPoint(point: THREE.Vector3): Tile[] {
    const cell = spherePointToCell(point, this.level);
    if (!cell) return [];

    const exact = this.cellToTiles.get(cellKey(cell));
    if (exact && exact.length > 0) return exact;

    // Fallback: aggregate same-face neighbours (no cross-face lookup needed
    // because closestTile will still pick the correct candidate).
    const gridSize = getGridSize(this.level);
    const seen = new Set<number>();
    const result: Tile[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
        const bucket = this.cellToTiles.get(
          cellKey({ face: cell.face, level: this.level, x: nx, y: ny })
        );
        if (bucket) {
          for (const t of bucket) {
            if (!seen.has(t.id)) { seen.add(t.id); result.push(t); }
          }
        }
      }
    }
    return result;
  }

  /**
   * Returns all tiles overlapping `cell`.
   *
   * - Same level as the index → direct lookup.
   * - Coarser than the index  → aggregates all descendant cells at index level.
   * - Finer than the index    → looks up the ancestor cell at index level.
   */
  queryCell(cell: QuadTreeCell): Tile[] {
    if (cell.level === this.level) {
      return this.cellToTiles.get(cellKey(cell)) ?? [];
    }
    if (cell.level < this.level) {
      return this._queryCoarseCell(cell);
    }
    // finer than index level — walk up to index level
    const ancestor = this._ancestorAt(cell, this.level);
    return this.cellToTiles.get(cellKey(ancestor)) ?? [];
  }

  /**
   * Returns all tiles overlapping any of the given cells (deduplicated by tile id).
   */
  queryCells(cells: QuadTreeCell[]): Tile[] {
    const seen = new Set<number>();
    const result: Tile[] = [];
    for (const cell of cells) {
      for (const tile of this.queryCell(cell)) {
        if (!seen.has(tile.id)) {
          seen.add(tile.id);
          result.push(tile);
        }
      }
    }
    return result;
  }

  /**
   * Returns the index-level cell that contains the centroid of `tile`.
   */
  getCentroidCell(tile: Tile): QuadTreeCell | undefined {
    return this.tileToCentroidCell.get(tile.id);
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  private build(tiles: Iterable<Tile>): void {
    for (const tile of tiles) {
      const cells = this._coverageCells(tile);
      for (const cell of cells) {
        const key = cellKey(cell);
        let bucket = this.cellToTiles.get(key);
        if (!bucket) {
          bucket = [];
          this.cellToTiles.set(key, bucket);
        }
        bucket.push(tile);
      }

      const centroidCell = spherePointToCell(tile.centroid, this.level);
      if (centroidCell) {
        this.tileToCentroidCell.set(tile.id, centroidCell);
      }
    }
  }

  /**
   * Collects all index-level cells that this tile overlaps by sampling:
   *   • the tile centroid
   *   • each polygon vertex
   *   • sphere-surface points at ¼, ½ and ¾ along each polygon edge
   *   • sphere-surface midpoints between the centroid and each vertex (interior)
   *
   * The denser edge sampling (vs. the old ½-only approach) prevents the two
   * main coverage-gap failure modes:
   *   - interior gap  : a cell lies inside the polygon but no sample landed there
   *   - boundary gap  : a curved projected edge crosses a cell without a sample
   */
  private _coverageCells(tile: Tile): QuadTreeCell[] {
    const seen = new Set<string>();
    const cells: QuadTreeCell[] = [];

    const add = (p: THREE.Vector3): void => {
      const cell = spherePointToCell(p, this.level);
      if (!cell) return;
      const k = cellKey(cell);
      if (!seen.has(k)) {
        seen.add(k);
        cells.push(cell);
      }
    };

    add(tile.centroid);

    // Collect polygon vertices
    const verts: THREE.Vector3[] = [];
    for (const he of tile.loop()) {
      verts.push(he.vertex.position);
    }

    const tmp = new THREE.Vector3();
    for (let i = 0; i < verts.length; i++) {
      const v0 = verts[i];
      const v1 = verts[(i + 1) % verts.length];

      add(v0);

      // ¼, ½, ¾ along each edge — sphere-surface points via lerp + normalize
      for (const t of [0.25, 0.5, 0.75]) {
        add(tmp.lerpVectors(v0, v1, t).normalize().clone());
      }

      // Interior sample: midpoint between centroid and this vertex
      add(tmp.addVectors(tile.centroid, v0).normalize().clone());
    }

    return cells;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _ancestorAt(cell: QuadTreeCell, targetLevel: number): QuadTreeCell {
    let c = cell;
    while (c.level > targetLevel) {
      c = {
        face: c.face,
        level: c.level - 1,
        x: Math.floor(c.x / 2),
        y: Math.floor(c.y / 2),
      };
    }
    return c;
  }

  /** BFS expansion of a coarse cell down to index level, aggregating tiles. */
  private _queryCoarseCell(ancestor: QuadTreeCell): Tile[] {
    const seen = new Set<number>();
    const result: Tile[] = [];
    const stack: QuadTreeCell[] = [ancestor];

    while (stack.length > 0) {
      const c = stack.pop()!;
      if (c.level === this.level) {
        const bucket = this.cellToTiles.get(cellKey(c));
        if (bucket) {
          for (const t of bucket) {
            if (!seen.has(t.id)) {
              seen.add(t.id);
              result.push(t);
            }
          }
        }
      } else {
        const nextLevel = c.level + 1;
        const bx = c.x * 2;
        const by = c.y * 2;
        stack.push({ face: c.face, level: nextLevel, x: bx,     y: by     });
        stack.push({ face: c.face, level: nextLevel, x: bx + 1, y: by     });
        stack.push({ face: c.face, level: nextLevel, x: bx,     y: by + 1 });
        stack.push({ face: c.face, level: nextLevel, x: bx + 1, y: by + 1 });
      }
    }

    return result;
  }
}

/**
 * Chooses an appropriate index level for a given icosahedron subdivision degree.
 *
 * At degree D the dual graph has ~10·4^D tiles.
 * At level L there are 6·4^L cells total.
 *
 * Cells per tile = 6·4^L / (10·4^D) = (6/10)·4^(L−D).
 * With L = D+2 that gives ~9.6 cells/tile.  Each tile only has ~13 sample
 * points (centroid + vertices + edge midpoints), so some cells in the interior
 * of large or projection-distorted tiles are never registered → gray patches.
 *
 * L = D+1 gives ~2.4 cells/tile, well within the 13-sample budget, and
 * ~5.4 registrations/cell (vs ~1.35 at D+2 → ~26 % empty cells).
 */
export function defaultLevelForDegree(degree: number): number {
  return degree + 1;
}
