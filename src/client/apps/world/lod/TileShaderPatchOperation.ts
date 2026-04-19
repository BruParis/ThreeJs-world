/**
 * Shader-based LOD patch operation for tectonic tile visualization.
 *
 * For each visible quadrant, this operation:
 *   1. Queries TileQuadTree.queryCell() once to get the small set of tiles
 *      overlapping the patch — O(tiles), not O(vertices).
 *   2. Packs those tiles' polygon vertices and colors into a per-patch
 *      DataTexture that is uploaded to the GPU once.
 *   3. Creates a ShaderMaterial whose vertex shader applies simplex-noise
 *      elevation (via the same terrainGLSL pipeline as the flat Shaders tab)
 *      and whose fragment shader resolves tile membership via exact spherical
 *      polygon containment — all per-fragment work on the GPU.
 *
 * DataTexture layout  (width = numTiles, height = 1 + MAX_VERTS, RGBA Float32)
 *   Row 0 :  (r, g, b, numVertices)
 *   Row 1+j: (vx, vy, vz, 0)  — j-th polygon vertex on the unit sphere
 */

import * as THREE from 'three';
import { QuadrantSpec } from '@core/quadtree';
import { CubeFace, ProjectionManager } from '@core/geometry/SphereProjection';
import { TileQuadTree } from '../tectonics/TileQuadTree';
import { Tile, GeologicalType, PlateCategory } from '../tectonics/data/Plate';
import { getPlateColor } from '../visualization/PlateColors';
import { getGeologicalColor } from '../visualization/GeologyColors';
import { IPatchOperation } from './IPatchOperation';
import { tileVertexShader } from './shaders/tileVert';
import { tileFragmentShader } from './shaders/tileFrag';
import { realElevKmToApparent, apparentElevKmToDistance } from '../../../shared/world/World';
import { PerlinNoise3D } from '@core/noise/PerlinNoise';
import {
  DEFAULT_EROSION_OCTAVES,
  DEFAULT_EROSION_SCALE,
  DEFAULT_EROSION_STRENGTH,
  DEFAULT_EROSION_GULLY_WEIGHT,
  DEFAULT_EROSION_DETAIL,
  DEFAULT_EROSION_LACUNARITY,
  DEFAULT_EROSION_GAIN,
  DEFAULT_EROSION_CELL_SCALE,
  DEFAULT_EROSION_NORMALIZATION,
  DEFAULT_EROSION_RIDGE_ROUNDING,
  DEFAULT_EROSION_CREASE_ROUNDING,
} from '@core/shaders/erosionGLSL';

// ── Public types ──────────────────────────────────────────────────────────────

export enum LODColorMode {
  PLATE      = 'plate',
  GEOLOGY    = 'geology',
  ELEVATION  = 'elevation',
  TERRAIN    = 'terrain',
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum tiles encoded in the per-patch DataTexture. */
const MAX_TILES = 256;

/** Maximum polygon vertices per tile (dual icosahedron tiles have 5–6). */
const MAX_VERTS = 8;

/** Radial offset above the dual mesh to prevent z-fighting. */
export const SURFACE_OFFSET = 1.003;

// ── Default terrain noise parameters ─────────────────────────────────────────

const DEFAULT_TERRAIN_NOISE = { scale: 2.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };

// ── TileShaderPatchOperation ──────────────────────────────────────────────────

export class TileShaderPatchOperation implements IPatchOperation {
  private tileTree: TileQuadTree | null = null;
  private colorMode: LODColorMode = LODColorMode.PLATE;
  private subdivisionFactor = 8;

  // ── Terrain noise state ────────────────────────────────────────────────────
  private noiseScale       = DEFAULT_TERRAIN_NOISE.scale;
  private noiseOctaves     = DEFAULT_TERRAIN_NOISE.octaves;
  private noisePersistence = DEFAULT_TERRAIN_NOISE.persistence;
  private noiseLacunarity  = DEFAULT_TERRAIN_NOISE.lacunarity;

  // ── Elevation amplitude ────────────────────────────────────────────────────
  /** Apparent (visually exaggerated) elevation amplitude in km. */
  private elevationAmplitudeApparentKm = realElevKmToApparent(10); // default: 10 km real → 100 km apparent

  // ── Elevation offset ───────────────────────────────────────────────────────
  /** Uniform shift applied to elevation [0,1] before the sea-level test. */
  private elevOffset = 0.0;

  // ── Erosion parameters ─────────────────────────────────────────────────────
  private erosionEnabled        = 0;
  private erosionOctaves        = DEFAULT_EROSION_OCTAVES;
  private erosionScale          = DEFAULT_EROSION_SCALE;
  private erosionStrength       = DEFAULT_EROSION_STRENGTH;
  private erosionGullyWeight    = DEFAULT_EROSION_GULLY_WEIGHT;
  private erosionDetail         = DEFAULT_EROSION_DETAIL;
  private erosionLacunarity     = DEFAULT_EROSION_LACUNARITY;
  private erosionGain           = DEFAULT_EROSION_GAIN;
  private erosionCellScale      = DEFAULT_EROSION_CELL_SCALE;
  private erosionNormalization  = DEFAULT_EROSION_NORMALIZATION;
  private erosionRidgeRounding  = DEFAULT_EROSION_RIDGE_ROUNDING;
  private erosionCreaseRounding = DEFAULT_EROSION_CREASE_ROUNDING;

  // CPU-side Perlin noise for approximate terrain floor queries (sampleSurfaceRadiusAt).
  // Uses a fixed seed — the visual uses simplex noise but this approximation is
  // close enough to floor the fly camera above the terrain.
  private readonly cpuNoise = new PerlinNoise3D(42);

  // ── Terrain noise API ──────────────────────────────────────────────────────

  /**
   * Update terrain simplex noise parameters used by the LOD elevation shader.
   * The caller is responsible for invalidating the LOD renderer afterwards.
   */
  setTerrainNoiseParams(
    scale: number,
    octaves: number,
    persistence: number,
    lacunarity: number
  ): void {
    this.noiseScale       = scale;
    this.noiseOctaves     = octaves;
    this.noisePersistence = persistence;
    this.noiseLacunarity  = lacunarity;
  }

  // ── Elevation amplitude API ────────────────────────────────────────────────

  /**
   * Set the apparent (visually exaggerated) elevation amplitude in km.
   * The caller is responsible for invalidating the LOD renderer afterwards.
   */
  setElevationAmplitudeApparentKm(apparentKm: number): void {
    this.elevationAmplitudeApparentKm = apparentKm;
  }

  getElevationAmplitudeApparentKm(): number {
    return this.elevationAmplitudeApparentKm;
  }

  /** Set the elevation offset (uniform shift before sea-level test). */
  setElevOffset(v: number): void {
    this.elevOffset = v;
  }

  getElevOffset(): number {
    return this.elevOffset;
  }

  // ── Erosion API ────────────────────────────────────────────────────────────

  /**
   * Update erosion parameters used by the LOD elevation shader.
   * The caller is responsible for invalidating the LOD renderer afterwards.
   */
  setErosionParams(
    enabled: boolean,
    octaves: number,
    scale: number,
    strength: number,
    gullyWeight: number,
    detail: number,
    lacunarity: number,
    gain: number,
    cellScale: number,
    normalization: number,
    ridgeRounding: number,
    creaseRounding: number,
  ): void {
    this.erosionEnabled        = enabled ? 1 : 0;
    this.erosionOctaves        = octaves;
    this.erosionScale          = scale;
    this.erosionStrength       = strength;
    this.erosionGullyWeight    = gullyWeight;
    this.erosionDetail         = detail;
    this.erosionLacunarity     = lacunarity;
    this.erosionGain           = gain;
    this.erosionCellScale      = cellScale;
    this.erosionNormalization  = normalization;
    this.erosionRidgeRounding  = ridgeRounding;
    this.erosionCreaseRounding = creaseRounding;
  }

  getErosionEnabled(): boolean { return this.erosionEnabled === 1; }

  /**
   * Returns the terrain surface radius (distance from world origin) at the
   * given unit-sphere direction, matching approximately what the GPU vertex
   * shader displaces to.  Used to floor the fly camera above the terrain.
   *
   * Note: uses CPU Perlin noise as an approximation of the GPU simplex noise —
   * sufficient for camera-floor queries.
   *
   * @param normalizedDir - Unit-length direction vector pointing at the surface.
   */
  sampleSurfaceRadiusAt(normalizedDir: THREE.Vector3): number {
    // Resolve tile elevation weight (0 = oceanic/flat, 1 = continental)
    let elevWeight = 1.0; // conservative default: assume raised terrain
    const candidates = this.tileTree?.queryPoint(normalizedDir) ?? [];
    if (candidates.length > 0) {
      let best = candidates[0];
      let bestDot = best.centroid.dot(normalizedDir);
      for (let i = 1; i < candidates.length; i++) {
        const d = candidates[i].centroid.dot(normalizedDir);
        if (d > bestDot) { bestDot = d; best = candidates[i]; }
      }
      elevWeight = this.tileElevWeight(best);
    }

    // Mirror the vertex shader: project to cube-face UV, sample 2D noise
    const ax = Math.abs(normalizedDir.x);
    const ay = Math.abs(normalizedDir.y);
    const az = Math.abs(normalizedDir.z);
    let pu: number, pv: number;
    if (ax >= ay && ax >= az) {
      pu = normalizedDir.y / ax * this.noiseScale;
      pv = normalizedDir.z / ax * this.noiseScale;
    } else if (ay >= ax && ay >= az) {
      pu = normalizedDir.x / ay * this.noiseScale;
      pv = normalizedDir.z / ay * this.noiseScale;
    } else {
      pu = normalizedDir.x / az * this.noiseScale;
      pv = normalizedDir.y / az * this.noiseScale;
    }
    const fbmVal = this.cpuNoise.fbm(pu, 0, pv,
      this.noiseOctaves, this.noisePersistence, this.noiseLacunarity);
    const elevation = fbmVal * 0.5 + 0.5;
    const shiftedElev = Math.min(1, Math.max(0, elevation + this.elevOffset));
    const TERRAIN_SEA = 0.35;
    const displH = Math.max(0, (shiftedElev - TERRAIN_SEA) / (1 - TERRAIN_SEA));
    const elev = displH * apparentElevKmToDistance(this.elevationAmplitudeApparentKm) * elevWeight;

    return SURFACE_OFFSET + elev;
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
      const ownWeight = this.tileElevWeight(tile);

      const verts: THREE.Vector3[] = [];
      for (const he of tile.loop()) {
        verts.push(he.vertex.position);
        if (verts.length >= MAX_VERTS) break;
      }
      const nv = verts.length;

      // Row 0: (r, g, b, nv + ownWeight * 0.1)
      const r0 = (0 * texWidth + i) * 4;
      texData[r0 + 0] = r;
      texData[r0 + 1] = g;
      texData[r0 + 2] = b;
      texData[r0 + 3] = nv + ownWeight * 0.1;

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
        uTileData:             { value: tileData },
        uNumTiles:             { value: numTiles },
        uNoiseScale:           { value: this.noiseScale },
        uNoiseOctaves:         { value: this.noiseOctaves },
        uNoisePersistence:     { value: this.noisePersistence },
        uNoiseLacunarity:      { value: this.noiseLacunarity },
        uElevationAmplitude:   { value: apparentElevKmToDistance(this.elevationAmplitudeApparentKm) },
        uSphereOffset:         { value: SURFACE_OFFSET },
        uElevOffset:           { value: this.elevOffset },
        uColorMode:            { value: this.colorMode === LODColorMode.ELEVATION ? 1
                                         : this.colorMode === LODColorMode.TERRAIN   ? 2
                                         : 0 },
        uErosionEnabled:       { value: this.erosionEnabled },
        uErosionOctaves:       { value: this.erosionOctaves },
        uErosionScale:         { value: this.erosionScale },
        uErosionStrength:      { value: this.erosionStrength },
        uErosionGullyWeight:   { value: this.erosionGullyWeight },
        uErosionDetail:        { value: this.erosionDetail },
        uErosionLacunarity:    { value: this.erosionLacunarity },
        uErosionGain:          { value: this.erosionGain },
        uErosionCellScale:     { value: this.erosionCellScale },
        uErosionNormalization: { value: this.erosionNormalization },
        uErosionRidgeRounding: { value: this.erosionRidgeRounding },
        uErosionCreaseRounding:{ value: this.erosionCreaseRounding },
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
