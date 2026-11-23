/**
 * Biome boundaries of World-tab LOD patches, derived from the tectonic tiles.
 *
 * A tile's biome comes from its plate (oceanic plate → ocean biome).  For a
 * patch, the boundaries are the tile edges separating two biomes, taken from
 * the tiles overlapping the patch plus enough rings of neighbours to cover the
 * transition width and the boundary noise: every boundary that can influence
 * a texel of the patch is included, so neighbouring patches blend identically
 * and show no seam.
 */

import * as THREE from 'three';
import { QuadrantSpec } from '@core/quadtree';
import { CubeFace } from '@core/geometry/SphereProjection';
import {
  BIOME_OCEAN,
  BIOME_STANDARD,
  pushBoundaryEdge,
  type BiomeBoundaryEdge,
  type BiomeBoundarySet,
} from '@core/terrain/BiomeBoundaries';
import type { TerrainParams } from '../../../shared/terrain/TerrainParams';
import { WORLD_RADIUS_KM } from '../../../shared/world/World';
import { TileQuadTree } from '../tectonics/TileQuadTree';
import { PlateCategory, Tile, TectonicSystem } from '../tectonics/data/Plate';
import type { Halfedge } from '@core/halfedge/Halfedge';

/** Upper bound on the neighbour rings added around a patch. */
const MAX_RINGS = 6;

/** Biome of a tile. */
export function tileBiome(tile: Tile): number {
  return tile.hasPlate && tile.plate.category === PlateCategory.OCEANIC ? BIOME_OCEAN : BIOME_STANDARD;
}

/**
 * Tiles overlapping a quadtree quadrant (may include a few just outside it).
 */
export function collectQuadrantTiles(tree: TileQuadTree, spec: QuadrantSpec): Tile[] {
  const tileLevel = tree.level;
  const gridSize  = 1 << tileLevel;

  const xMin = Math.max(0,            Math.floor((spec.u0 + 1) * gridSize / 2) - 1);
  const xMax = Math.min(gridSize - 1, Math.floor((spec.u1 + 1) * gridSize / 2));
  const yMin = Math.max(0,            Math.floor((spec.v0 + 1) * gridSize / 2) - 1);
  const yMax = Math.min(gridSize - 1, Math.floor((spec.v1 + 1) * gridSize / 2));

  const face = spec.face as CubeFace;
  const seen  = new Set<number>();
  const tiles: Tile[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      for (const tile of tree.queryCell({ face, level: tileLevel, x, y })) {
        if (!seen.has(tile.id)) {
          seen.add(tile.id);
          tiles.push(tile);
        }
      }
    }
  }
  return tiles;
}

export class TileBiomeBoundaries {
  /** Typical angular diameter of a tile, radians. */
  private readonly tileDiameter: number;

  constructor(
    private readonly tree: TileQuadTree,
    private readonly system: TectonicSystem,
    private readonly params: TerrainParams,
  ) {
    this.tileDiameter = estimateTileDiameter(system);
  }

  forQuadrant(spec: QuadrantSpec): BiomeBoundarySet {
    const tiles = collectQuadrantTiles(this.tree, spec);
    if (tiles.length === 0) return { defaultBiome: BIOME_STANDARD, edges: [] };

    // ── Grow by neighbour rings to cover the reach of the boundaries ─────────
    const p = this.params;
    const reach = (0.5 * p.biomeTransitionKm + p.biomeBoundaryNoiseKm) / WORLD_RADIUS_KM;
    const rings = Math.min(MAX_RINGS, 1 + Math.ceil(reach / Math.max(this.tileDiameter, 1e-6)));

    const map = this.system.edge2TileMap;
    const set = new Set<Tile>(tiles);
    let frontier = tiles;
    for (let r = 0; r < rings; r++) {
      const next: Tile[] = [];
      for (const tile of frontier) {
        for (const he of tile.loop()) {
          const other = map.get(he.twin);
          if (other && !set.has(other)) {
            set.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }

    // ── Edges between tiles of different biomes ──────────────────────────────
    const edges: BiomeBoundaryEdge[] = [];
    const done = new Set<Halfedge>();
    for (const tile of set) {
      const biome = tileBiome(tile);
      for (const he of tile.loop()) {
        const other = map.get(he.twin);
        if (!other || done.has(he.twin)) continue;
        const otherBiome = tileBiome(other);
        if (otherBiome === biome) continue;
        done.add(he);
        pushBoundaryEdge(edges, he.vertex.position, he.twin.vertex.position, tile.centroid, biome, otherBiome);
      }
    }

    return { defaultBiome: tileBiome(tiles[0]), edges };
  }
}

function estimateTileDiameter(system: TectonicSystem): number {
  for (const plate of system.plates) {
    for (const tile of plate.tiles) {
      let max = 0;
      const c = tile.centroid;
      const v = new THREE.Vector3();
      for (const he of tile.loop()) max = Math.max(max, c.angleTo(v.copy(he.vertex.position).normalize()));
      return 2 * max;
    }
  }
  return 0;
}
