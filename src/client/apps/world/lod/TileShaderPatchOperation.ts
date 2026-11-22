/**
 * Shader-based LOD patch operation for tectonic tile visualization.
 *
 * Renders the tectonic data (plate, geology) as a flat overlay on the sphere.
 * Terrain relief is the job of TerrainPatchOperation.
 *
 * For each visible quadrant, this operation:
 *   1. Queries TileQuadTree.queryCell() once to get the small set of tiles
 *      overlapping the patch — O(tiles), not O(vertices).
 *   2. Packs those tiles' polygon vertices and colors into a per-patch
 *      DataTexture that is uploaded to the GPU once.
 *   3. Creates a ShaderMaterial whose fragment shader resolves tile membership
 *      via exact spherical polygon containment — all per-fragment work on the GPU.
 *
 * DataTexture layout  (width = numTiles, height = 1 + MAX_VERTS, RGBA Float32)
 *   Row 0 :  (r, g, b, numVertices)
 *   Row 1+j: (vx, vy, vz, 0)  — j-th polygon vertex on the unit sphere
 */

import * as THREE from 'three';
import { QuadrantSpec } from '@core/quadtree';
import { CubeFace, ProjectionManager } from '@core/geometry/SphereProjection';
import { TileQuadTree } from '../tectonics/TileQuadTree';
import { Tile } from '../tectonics/data/Plate';
import { getPlateColor } from '../visualization/PlateColors';
import { getGeologicalColor } from '../visualization/GeologyColors';
import { IPatchOperation } from './IPatchOperation';
import { tileVertexShader } from './shaders/tileVert';
import { tileFragmentShader } from './shaders/tileFrag';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * What the LOD view shows.
 *   PLATE / GEOLOGY / LOD  — flat data overlays, rendered by TileShaderPatchOperation
 *   TERRAIN / ELEVATION    — the shader terrain, rendered by TerrainPatchOperation
 */
export enum LODColorMode {
  PLATE      = 'plate',
  GEOLOGY    = 'geology',
  ELEVATION  = 'elevation',
  TERRAIN    = 'terrain',
  LOD        = 'lod',
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum tiles encoded in the per-patch DataTexture. */
const MAX_TILES = 256;

/** Maximum polygon vertices per tile (dual icosahedron tiles have 5–6). */
const MAX_VERTS = 8;

/** Radial offset above the dual mesh to prevent z-fighting. */
export const SURFACE_OFFSET = 1.003;

// ── TileShaderPatchOperation ──────────────────────────────────────────────────

export class TileShaderPatchOperation implements IPatchOperation {
  private tileTree: TileQuadTree | null = null;
  private colorMode: LODColorMode = LODColorMode.PLATE;
  private subdivisionFactor = 8;

  /**
   * Radius of the rendered surface in the given direction.  Tile patches are
   * flat, so this is the sphere offset everywhere.
   */
  sampleSurfaceRadiusAt(_normalizedDir: THREE.Vector3): number {
    return SURFACE_OFFSET;
  }

  dispose(): void {
    // nothing to dispose (no GPU textures owned here)
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  setTileTree(tree: TileQuadTree | null): void {
    this.tileTree = tree;
  }

  setColorMode(mode: LODColorMode): void {
    this.colorMode = mode;
  }

  getColorMode(): LODColorMode {
    return this.colorMode;
  }

  setSubdivisionFactor(n: number): void {
    this.subdivisionFactor = n;
  }

  // ── IPatchOperation ────────────────────────────────────────────────────────

  createPatch(spec: QuadrantSpec, wireframe: boolean): THREE.Object3D | null {
    if (!this.tileTree) return null;

    const n = this.subdivisionFactor;
    if (n <= 0) return null;

    // ── 1. Collect all tiles overlapping this patch ────────────────────────────
    const tileLevel = this.tileTree.level;
    const gridSize  = 1 << tileLevel;

    const xMin = Math.max(0,            Math.floor((spec.u0 + 1) * gridSize / 2) - 1);
    const xMax = Math.min(gridSize - 1, Math.floor((spec.u1 + 1) * gridSize / 2));
    const yMin = Math.max(0,            Math.floor((spec.v0 + 1) * gridSize / 2) - 1);
    const yMax = Math.min(gridSize - 1, Math.floor((spec.v1 + 1) * gridSize / 2));

    const face = spec.face as CubeFace;
    const seenTileIds = new Set<number>();
    const tiles: Tile[] = [];

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        for (const tile of this.tileTree.queryCell({ face, level: tileLevel, x, y })) {
          if (!seenTileIds.has(tile.id)) {
            seenTileIds.add(tile.id);
            tiles.push(tile);
          }
        }
      }
    }

    if (tiles.length === 0) return null;

    // ── 2. Build per-patch DataTexture ─────────────────────────────────────────
    const numTiles  = Math.min(tiles.length, MAX_TILES);
    const texWidth  = numTiles;
    const texHeight = 1 + MAX_VERTS;
    const texData   = new Float32Array(texWidth * texHeight * 4);

    for (let i = 0; i < numTiles; i++) {
      const tile = tiles[i];
      const [r, g, b] = this.tileColor(tile);

      const verts: THREE.Vector3[] = [];
      for (const he of tile.loop()) {
        verts.push(he.vertex.position);
        if (verts.length >= MAX_VERTS) break;
      }
      const nv = verts.length;

      // Row 0: (r, g, b, nv)
      const r0 = (0 * texWidth + i) * 4;
      texData[r0 + 0] = r;
      texData[r0 + 1] = g;
      texData[r0 + 2] = b;
      texData[r0 + 3] = nv;

      for (let j = 0; j < MAX_VERTS; j++) {
        const rj = ((1 + j) * texWidth + i) * 4;
        if (j < nv) {
          texData[rj + 0] = verts[j].x;
          texData[rj + 1] = verts[j].y;
          texData[rj + 2] = verts[j].z;
          texData[rj + 3] = 0;
        } else {
          texData[rj + 0] = 0; texData[rj + 1] = 0; texData[rj + 2] = 0; texData[rj + 3] = 0;
        }
      }
    }

    const tileData = new THREE.DataTexture(
      texData, texWidth, texHeight,
      THREE.RGBAFormat, THREE.FloatType
    );
    tileData.minFilter     = THREE.NearestFilter;
    tileData.magFilter     = THREE.NearestFilter;
    tileData.generateMipmaps = false;
    tileData.needsUpdate   = true;

    // ── 3. Build sphere grid geometry ─────────────────────────────────────────
    const positions: number[] = [];

    for (let i = 0; i <= n; i++) {
      const u = spec.u0 + (spec.u1 - spec.u0) * (i / n);
      for (let j = 0; j <= n; j++) {
        const v = spec.v0 + (spec.v1 - spec.v0) * (j / n);
        const p = ProjectionManager.cubeToSphere(face, u, v);
        positions.push(p.x, p.y, p.z);
      }
    }

    const reverseWinding = spec.face === 2 || spec.face === 3;
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const tl = i * (n + 1) + j;
        const tr = tl + 1;
        const bl = (i + 1) * (n + 1) + j;
        const br = bl + 1;
        if (reverseWinding) {
          indices.push(tl, tr, bl, tr, br, bl);
        } else {
          indices.push(tl, bl, tr, tr, bl, br);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);

    // ── 4. Create ShaderMaterial ──────────────────────────────────────────────
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uTileData:     { value: tileData },
        uNumTiles:     { value: numTiles },
        uSphereOffset: { value: SURFACE_OFFSET },
        uColorMode:    { value: this.colorMode === LODColorMode.LOD ? 3 : 0 },
        uLodColor:     { value: this.levelColor(spec.level) },
      },
      vertexShader:   tileVertexShader,
      fragmentShader: tileFragmentShader,
      side:      THREE.FrontSide,
      wireframe,
    });

    return new THREE.Mesh(geo, mat);
  }

  disposePatch(_key: string, object: THREE.Object3D): void {
    const mesh = object as THREE.Mesh;
    mesh.geometry.dispose();
    const mat = mesh.material as THREE.ShaderMaterial;
    (mat.uniforms.uTileData.value as THREE.DataTexture).dispose();
    mat.dispose();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private static readonly LEVEL_COLORS: readonly number[] = [
    0xff0000, 0xff8800, 0xffff00, 0x88ff00, 0x00ff00,
    0x00ff88, 0x00ffff, 0x0088ff, 0x0000ff, 0x8800ff,
    0xff00ff, 0xff0088, 0xff4444, 0xffaa44, 0xffff88,
    0xaaffaa, 0x88ffff, 0xaaaaff, 0xffaaff, 0xffffff,
    0xcccccc,
  ];

  private levelColor(level: number): THREE.Vector3 {
    const hex = TileShaderPatchOperation.LEVEL_COLORS[
      Math.min(level, TileShaderPatchOperation.LEVEL_COLORS.length - 1)
    ];
    return new THREE.Vector3(
      ((hex >> 16) & 0xff) / 255,
      ((hex >>  8) & 0xff) / 255,
       (hex        & 0xff) / 255,
    );
  }

  private tileColor(tile: Tile): [number, number, number] {
    if (this.colorMode === LODColorMode.GEOLOGY) {
      return getGeologicalColor(tile.geologicalType, tile.geologicalIntensity);
    }
    if (tile.hasPlate) {
      return getPlateColor(tile.plate);
    }
    return [0.5, 0.5, 0.5];
  }
}
