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
   */
  queryPoint(point: THREE.Vector3): Tile[] {
    const cell = spherePointToCell(point, this.level);
    if (!cell) return [];
    return this.cellToTiles.get(cellKey(cell)) ?? [];
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
   *   • the midpoint of each polygon edge (normalized to the sphere)
   *
   * This three-point sampling is sufficient for typical tile sizes relative to
   * the cell size at the index level.
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

    const mid = new THREE.Vector3();
    for (let i = 0; i < verts.length; i++) {
      add(verts[i]);
      // Sphere-surface midpoint of edge i → i+1
      mid.addVectors(verts[i], verts[(i + 1) % verts.length]).normalize();
      add(mid.clone());
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
 * At degree D the dual graph has ~10·4^D tiles.  We target ~4–8 tiles per cell
 * on average, which gives index level D + 2.
 */
export function defaultLevelForDegree(degree: number): number {
  return degree + 2;
}
