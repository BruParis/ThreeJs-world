import * as THREE from 'three';
import { TerrainPatchBaker, type BakedPatch } from '@core/terrain/TerrainPatchBaker';
import { TerrainMaterial } from '@core/terrain/TerrainMaterial';
import {
  tangentFrameFromLatLon,
  tangentFrameRotation,
  tangentPatchDomain,
  tangentPlaneDir,
  type TangentFrame,
} from '@core/terrain/PatchDomain';
import type { BiomeBoundarySet } from '@core/terrain/BiomeBoundaries';
import { terrainParams, type TerrainParams, type TerrainChange } from '../../../shared/terrain/TerrainParams';
import {
  DEFAULT_SUBDIVISION,
  DEFAULT_NUM_PATCHES,
  DIRECTION_GRID_RES,
  BUMP_TEXTURE_RES,
  DETAIL_TEXTURE_RES,
} from './TerrainConstants';

/**
 * Biome boundaries of the patch, given its tangent frame and the number of
 * planet radii per terrain unit (scene x, z → tangent plane).
 */
export type PatchBiomeSource = (frame: TangentFrame, toRadii: number) => BiomeBoundarySet | null;

/**
 * The flat terrain patch of the Shaders tab.
 *
 * The patch is a square of the plane tangent to the planet at the anchor point
 * of the shared terrain parameters: it shows, flattened, the terrain the planet
 * has around that point.  One scene unit is one terrain unit, so the patch is
 * `params.patchSize` units wide, i.e. `params.patchSizeKm` kilometres.
 *
 * All terrain parameters live in the shared TerrainParams store; this class
 * only owns what is specific to this view (mesh resolution, wireframe…) and
 * reacts to parameter changes.
 */
export class TerrainMesh {
  // ── View-only settings ──────────────────────────────────────────────────────
  subdivisions = DEFAULT_SUBDIVISION;
  numPatches   = DEFAULT_NUM_PATCHES;
  wireframe    = false;
  roughness    = 0.85;

  /**
   * CPU copy of the elevation texture — use for camera collision, pathfinding,
   * physics, or any non-rendering query.
   * RGBA floats, index (row * elevationGridWidth + col) * 4:
   *   R = raw elevation [0, 1] (before the elevation offset), GBA = surface gradient.
   */
  elevationData:       Float32Array | null = null;
  elevationGridWidth   = 0;
  elevationGridHeight  = 0;

  /** Where the biomes are on this patch (null: standard everywhere). */
  biomeSource: PatchBiomeSource | null = null;

  private readonly baker: TerrainPatchBaker;
  private patch:  BakedPatch | null = null;
  private frame:  TangentFrame | null = null;
  private readonly domainToWorld = new THREE.Matrix3();

  private _meshes:    THREE.Mesh[] = [];
  private _materials: TerrainMaterial[] = [];

  /** Signature of everything that defines the patch grid; a change means a full rebuild. */
  private gridSignature = '';
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    readonly params: TerrainParams = terrainParams,
  ) {
    this.baker = new TerrainPatchBaker(renderer);
  }

  get meshes(): readonly THREE.Mesh[] { return this._meshes; }

  init(): void {
    this.rebuild();
    this.unsubscribe = this.params.onChange((change) => this.onParamsChanged(change));
  }

  /** Full rebuild: new patch grid, all textures baked, patch meshes recreated. */
  rebuild(): void {
    this.disposeMeshes();
    this.disposePatch();

    const p = this.params;
    const patchesPerSide = Math.round(Math.sqrt(this.numPatches));
    const totalVerts     = patchesPerSide * this.subdivisions + 1;

    this.frame = tangentFrameFromLatLon(p.anchorLatDeg, p.anchorLonDeg);
    tangentFrameRotation(this.frame, this.domainToWorld);

    // Patch size as a fraction of the planet radius — the unit of the tangent plane.
    const sizeInRadii = p.patchSize / p.planetRadiusUnits;
    const domain = tangentPatchDomain(this.frame, sizeInRadii, DIRECTION_GRID_RES);

    this.patch = this.baker.createPatch(domain, {
      elevation: totalVerts,
      bump:      BUMP_TEXTURE_RES,
      detail:    DETAIL_TEXTURE_RES,
    });
    this.applyBiomes();
    this.baker.bakeAll(this.patch, p);
    this.readElevationToCpu();

    this.gridSignature = this.computeGridSignature();
    this.rebuildMeshes();
  }

  /**
   * Re-run the elevation pass (and the tree density pass) with the current
   * parameters.  Rebuilds everything instead when the patch grid itself changed.
   */
  recomputeElevation(): void {
    if (!this.patch || this.computeGridSignature() !== this.gridSignature) {
      this.rebuild();
      return;
    }
    this.baker.bakeElevation(this.patch, this.params);
    this.readElevationToCpu();
    this.syncMaterials();
  }

  /** Re-reads the biome layout from biomeSource and re-bakes the elevation. */
  refreshBiomes(): void {
    if (!this.patch) return;
    this.applyBiomes();
    this.recomputeElevation();
  }

  /**
   * Re-run the tree density pass with the current elevation offset and tree params.
   * Fast — does not re-run the elevation pass.
   */
  recomputeTreeDensity(): void {
    if (!this.patch) return;
    this.baker.bakeTreeDensity(this.patch, this.params);
    this.syncMaterials();
  }

  /** Push every parameter to the materials, plus the view-only display settings. */
  updateUniforms(): void {
    this.syncMaterials();
    for (const mesh of this._meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.wireframe = this.wireframe;
      mat.roughness = this.roughness;
    }
  }

  /** Set surface roughness (PBR) and apply to all patch materials immediately. */
  setRoughness(v: number): void {
    this.roughness = v;
    for (const mesh of this._meshes) {
      (mesh.material as THREE.MeshStandardMaterial).roughness = v;
    }
  }

  /**
   * Height of the displayed terrain above the sea-level plane (y = 0) at the
   * given scene XZ, in scene units.  Uses the CPU elevation copy.
   */
  sampleTerrainHeight(wx: number, wz: number): number {
    if (!this.elevationData) return 0;
    const p = this.params;
    const halfSize = p.patchSize / 2;
    const u = (wx + halfSize) / p.patchSize;
    const v = (wz + halfSize) / p.patchSize;
    const w = this.elevationGridWidth;
    const h = this.elevationGridHeight;
    const col  = Math.max(0, Math.min(w - 1, Math.round(u * (w - 1))));
    const row  = Math.max(0, Math.min(h - 1, Math.round(v * (h - 1))));
    const elev = this.elevationData[(row * w + col) * 4] + p.elevationOffset;
    return (Math.max(elev, p.seaLevel) - p.seaLevel) * p.verticalScale;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.disposeMeshes();
    this.disposePatch();
    this.baker.dispose();
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private onParamsChanged(change: TerrainChange): void {
    if (!this.patch) return;
    switch (change) {
      case 'elevation':
        this.recomputeElevation();
        break;
      case 'trees':
        this.recomputeTreeDensity();
        break;
      case 'bump':
        this.baker.bakeBump(this.patch, this.params);
        this.syncMaterials();
        break;
      case 'detail':
        if (this.params.detailNoiseEnabled) this.baker.bakeDetail(this.patch, this.params);
        this.syncMaterials();
        break;
      case 'display':
        this.syncMaterials();
        break;
    }
  }

  private computeGridSignature(): string {
    const p = this.params;
    return [
      p.patchSize, p.kmPerUnit, p.anchorLatDeg, p.anchorLonDeg,
      this.subdivisions, this.numPatches,
    ].join('|');
  }

  private applyBiomes(): void {
    if (!this.patch || !this.frame) return;
    const set = this.biomeSource?.(this.frame, 1 / this.params.planetRadiusUnits) ?? null;
    this.baker.setBiomes(this.patch, set);
  }

  private readElevationToCpu(): void {
    if (!this.patch) return;
    this.elevationData       = this.baker.readElevation(this.patch);
    this.elevationGridWidth  = this.patch.resolution.elevation;
    this.elevationGridHeight = this.patch.resolution.elevation;
  }

  private syncMaterials(): void {
    for (const m of this._materials) m.sync(this.params);
  }

  private disposePatch(): void {
    if (this.patch) this.baker.disposePatch(this.patch);
    this.patch = null;
    this.elevationData = null;
  }

  private disposeMeshes(): void {
    for (const mesh of this._meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const m of this._materials) m.dispose();
    this._meshes    = [];
    this._materials = [];
  }

  private rebuildMeshes(): void {
    this.disposeMeshes();
    if (!this.patch || !this.frame) return;

    const patchesPerSide = Math.round(Math.sqrt(this.numPatches));
    const size           = this.params.patchSize;
    const cellSize       = size / patchesPerSide;
    const half           = size / 2;

    for (let row = 0; row < patchesPerSide; row++) {
      for (let col = 0; col < patchesPerSide; col++) {
        const originX = -half + col * cellSize;
        const originZ = -half + row * cellSize;

        const material = new TerrainMaterial(
          this.params,
          this.patch,
          {
            unitToLocal:   1,                         // one scene unit = one terrain unit
            flatUp:        new THREE.Vector3(0, 1, 0),
            domainToWorld: this.domainToWorld,
          },
          { wireframe: this.wireframe, roughness: this.roughness },
        );

        const mesh = new THREE.Mesh(
          this.buildPatchGeometry(originX, originZ, cellSize),
          material.material,
        );
        mesh.position.set(originX, 0, originZ);
        this.scene.add(mesh);
        this._meshes.push(mesh);
        this._materials.push(material);
      }
    }
  }

  /**
   * Geometry of one sub-patch.  Follows the terrain geometry contract:
   *   position — flat, on the sea-level plane, relative to the sub-patch origin
   *   normal   — direction on the planet of the point under the vertex
   *   uv       — coordinate in the whole patch, addressing the baked textures
   */
  private buildPatchGeometry(originX: number, originZ: number, cellSize: number): THREE.BufferGeometry {
    const n     = this.subdivisions;
    const size  = this.params.patchSize;
    const half  = size / 2;
    const toRadii = 1 / this.params.planetRadiusUnits;
    const frame = this.frame!;
    const dir   = new THREE.Vector3();

    const count     = (n + 1) * (n + 1);
    const positions = new Float32Array(count * 3);
    const normals   = new Float32Array(count * 3);
    const uvs       = new Float32Array(count * 2);

    let k = 0;
    for (let i = 0; i <= n; i++) {
      const x = cellSize * (i / n);
      for (let j = 0; j <= n; j++) {
        const z  = cellSize * (j / n);
        const wx = originX + x;
        const wz = originZ + z;

        positions[k * 3]     = x;
        positions[k * 3 + 1] = 0;
        positions[k * 3 + 2] = z;

        tangentPlaneDir(frame, wx * toRadii, wz * toRadii, dir);
        normals[k * 3]     = dir.x;
        normals[k * 3 + 1] = dir.y;
        normals[k * 3 + 2] = dir.z;

        uvs[k * 2]     = (wx + half) / size;
        uvs[k * 2 + 1] = (wz + half) / size;
        k++;
      }
    }

    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const tl = i * (n + 1) + j;
        const tr = tl + 1;
        const bl = (i + 1) * (n + 1) + j;
        const br = bl + 1;
        indices.push(tl, tr, bl, tr, br, bl);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }
}
