/**
 * Shader-based LOD patch operation for tectonic tile visualization.
 *
 * For each visible quadrant, this operation:
 *   1. Queries TileQuadTree.queryCell() once to get the small set of tiles
 *      overlapping the patch — O(tiles), not O(vertices).
 *   2. Packs those tiles' polygon vertices and colors into a per-patch
 *      DataTexture that is uploaded to the GPU once.
 *   3. Creates a ShaderMaterial whose vertex shader applies Perlin-noise
 *      elevation and whose fragment shader resolves tile membership via exact
 *      spherical polygon containment — all per-fragment work on the GPU.
 *
 * DataTexture layout  (width = numTiles, height = 1 + MAX_VERTS, RGBA Float32)
 *   Row 0 :  (r, g, b, numVertices)
 *   Row 1+j: (vx, vy, vz, 0)  — j-th polygon vertex on the unit sphere
 */

import * as THREE from 'three';
import { QuadrantSpec } from '@core/quadtree';
import { CubeFace, ProjectionManager } from '@core/geometry/SphereProjection';
import { Halfedge } from '@core/halfedge/Halfedge';
import { TileQuadTree } from '../tectonics/TileQuadTree';
import { Tile, GeologicalType, PlateCategory } from '../tectonics/data/Plate';
import { getPlateColor } from '../visualization/PlateColors';
import { getGeologicalColor } from '../visualization/GeologyColors';
import { IPatchOperation } from './IPatchOperation';
import { tileVertexShader } from './shaders/tileVert';
import { tileFragmentShader } from './shaders/tileFrag';
import { kmToDistance } from '../../../shared/world/World';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';

// ── Public types ──────────────────────────────────────────────────────────────

export enum LODColorMode {
  PLATE      = 'plate',
  GEOLOGY    = 'geology',
  ELEVATION  = 'elevation',
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum tiles encoded in the per-patch DataTexture. */
const MAX_TILES = 256;

/** Maximum polygon vertices per tile (dual icosahedron tiles have 5–6). */
const MAX_VERTS = 8;

/** Radial offset above the dual mesh to prevent z-fighting. */
export const SURFACE_OFFSET = 1.003;

// ── TileShaderPatchOperation ──────────────────────────────────────────────────

// Default noise parameters — match the GUI initial values
const DEFAULT_NOISE = { seed: 42, scale: 2.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };

export class TileShaderPatchOperation implements IPatchOperation {
  private tileTree: TileQuadTree | null = null;
  private colorMode: LODColorMode = LODColorMode.PLATE;
  private subdivisionFactor = 8;
  private edgeTileMap: Map<Halfedge, Tile> | null = null;

  // ── Noise state ────────────────────────────────────────────────────────────
  private noiseScale       = DEFAULT_NOISE.scale;
  private noiseOctaves     = DEFAULT_NOISE.octaves;
  private noisePersistence = DEFAULT_NOISE.persistence;
  private noiseLacunarity  = DEFAULT_NOISE.lacunarity;
  // Shared 256×1 R32F texture: texel i holds perm[i] as an exact float.
  // All patches reference this single object; updating needsUpdate re-uploads it.
  private permTexture: THREE.DataTexture;

  constructor() {
    this.permTexture = this.buildPermTexture(DEFAULT_NOISE.seed);
  }

  // ── Noise API ──────────────────────────────────────────────────────────────

  /**
   * Update Perlin noise parameters used by the LOD elevation shader.
   * Rebuilds the permutation texture from the new seed and stores the other
   * params so they are included in every subsequent createPatch() call.
   * The caller is responsible for invalidating the LOD renderer afterwards.
   */
  setNoiseParams(
    seed: number,
    scale: number,
    octaves: number,
    persistence: number,
    lacunarity: number
  ): void {
    this.noiseScale       = scale;
    this.noiseOctaves     = octaves;
    this.noisePersistence = persistence;
    this.noiseLacunarity  = lacunarity;
    this.permTexture.dispose();
    this.permTexture = this.buildPermTexture(seed);
  }

  dispose(): void {
    this.permTexture.dispose();
  }

  // Builds a 256×1 R32F DataTexture whose texel i holds perm[i] as a float.
  private buildPermTexture(seed: number): THREE.DataTexture {
    const perm = new PerlinNoise3D(seed).getPermutation256();
    const data = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      data[i] = perm[i]; // exact integer stored as float32
    }
    const tex = new THREE.DataTexture(data, 256, 1, THREE.RedFormat, THREE.FloatType);
    tex.minFilter     = THREE.NearestFilter;
    tex.magFilter     = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate   = true;
    return tex;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  setTileTree(tree: TileQuadTree | null): void {
    this.tileTree = tree;
  }

  setEdgeTileMap(map: Map<Halfedge, Tile> | null): void {
    this.edgeTileMap = map;
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
    //
    // Enumerate every cell at tileTree.level whose UV rectangle intersects the
    // patch bounds, then union their tiles.  Scale-invariant: fine patches hit
    // 1–4 cells, coarse patches hit more — always exact, no sampling gaps.
    // A 1-cell outward margin catches tiles whose polygon only partially overlaps
    // the patch boundary.
    const tileLevel = this.tileTree.level;
    const gridSize  = 1 << tileLevel; // cells per face edge at index level

    // UV → cell index: u = -1 + 2*x/gridSize  →  x = (u+1)*gridSize/2
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
    const numTiles = Math.min(tiles.length, MAX_TILES);
    const texWidth  = numTiles;
    const texHeight = 1 + MAX_VERTS;
    const texData   = new Float32Array(texWidth * texHeight * 4);

    for (let i = 0; i < numTiles; i++) {
      const tile = tiles[i];
      const [r, g, b] = this.tileColor(tile);
      const ownWeight = this.tileElevWeight(tile);

      // Collect polygon vertices + halfedges from the halfedge loop
      const verts: THREE.Vector3[] = [];
      const halfedges: Halfedge[] = [];
      for (const he of tile.loop()) {
        verts.push(he.vertex.position);
        halfedges.push(he);
        if (verts.length >= MAX_VERTS) break;
      }
      const nv = verts.length;

      // Row 0: (r, g, b, nv + ownWeight * 0.1)
      //   Fragment decode: int(a + 0.5) still gives nv correctly.
      //   Vertex decode:   fract(a) * 10.0 gives ownWeight (0.0 or 1.0).
      const r0 = (0 * texWidth + i) * 4;
      texData[r0 + 0] = r;
      texData[r0 + 1] = g;
      texData[r0 + 2] = b;
      texData[r0 + 3] = nv + ownWeight * 0.1;

      // Rows 1..MAX_VERTS: (vx, vy, vz, neighborElevWeight)
      //   w = elevation weight of the tile across edge j (halfedge[j] → halfedge[(j+1)%nv]).
      for (let j = 0; j < MAX_VERTS; j++) {
        const rj = ((1 + j) * texWidth + i) * 4;
        if (j < nv) {
          texData[rj + 0] = verts[j].x;
          texData[rj + 1] = verts[j].y;
          texData[rj + 2] = verts[j].z;
          const neighborTile = this.edgeTileMap?.get(halfedges[j].twin) ?? null;
          texData[rj + 3] = neighborTile !== null ? this.tileElevWeight(neighborTile) : 1.0;
        } else {
          texData[rj + 0] = 0;
          texData[rj + 1] = 0;
          texData[rj + 2] = 0;
          texData[rj + 3] = 0;
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

    // ── 3. Build sphere grid geometry (positions only — no CPU color lookup) ──
    const positions: number[] = [];

    for (let i = 0; i <= n; i++) {
      const u = spec.u0 + (spec.u1 - spec.u0) * (i / n);
      for (let j = 0; j <= n; j++) {
        const v = spec.v0 + (spec.v1 - spec.v0) * (j / n);
        const p = ProjectionManager.cubeToSphere(face, u, v);
        positions.push(p.x, p.y, p.z);
      }
    }

    // Faces PLUS_Y (2) and MINUS_Y (3) have opposite UV handedness
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
        uTileData:           { value: tileData },
        uNumTiles:           { value: numTiles },
        uPermTex:            { value: this.permTexture },
        uNoiseScale:         { value: this.noiseScale },
        uNoiseOctaves:       { value: this.noiseOctaves },
        uNoisePersistence:   { value: this.noisePersistence },
        uNoiseLacunarity:    { value: this.noiseLacunarity },
        uElevationAmplitude: { value: kmToDistance(10) },
        uSphereOffset:       { value: SURFACE_OFFSET },
        uElevBlendWidth:     { value: 0.02 },
        uColorMode:          { value: this.colorMode === LODColorMode.ELEVATION ? 1 : 0 },
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

  private tileElevWeight(tile: Tile): number {
    if (!tile.hasPlate) return 1.0;
    if (tile.plate.category === PlateCategory.OCEANIC) return 0.0;
    if (tile.geologicalType === GeologicalType.OCEANIC_CRUST) return 0.0;
    return 1.0;
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
