/**
 * Terrain LOD patch operation — the shader terrain on the sphere.
 *
 * Renders each visible quadtree quadrant with the same pipeline, and the same
 * parameters, as the flat patch of the Shaders tab:
 *
 *   QuadrantSpec ──spherePatchDomain──▶ PatchDomain      where the patch lies on the planet
 *                ──TerrainPatchBaker──▶ baked textures   elevation, attributes, trees, bump…
 *                ──TerrainMaterial────▶ mesh             displaced and shaded on the GPU
 *
 * The terrain is a function of the 3D position on the planet, so patches agree
 * along their shared edges whatever their level or cube face.
 *
 * Scene conventions: the planet is centred on the origin with radius
 * SURFACE_OFFSET (scene units ≈ planet radii); relief is added on top, exaggerated
 * by the display scale of the shared parameters.
 */

import * as THREE from 'three';
import { QuadrantSpec } from '@core/quadtree';
import { ProjectionManager } from '@core/geometry/SphereProjection';
import { TerrainPatchBaker, type BakedPatch } from '@core/terrain/TerrainPatchBaker';
import { TerrainMaterial } from '@core/terrain/TerrainMaterial';
import { spherePatchDomain, cubeRectDir } from '@core/terrain/PatchDomain';
import { terrainParams, type TerrainParams, type TerrainChange } from '../../../shared/terrain/TerrainParams';
import type { BiomeBoundarySet } from '@core/terrain/BiomeBoundaries';
import { kmToDistance } from '../../../shared/world/World';
import { IPatchOperation } from './IPatchOperation';
import { SURFACE_OFFSET } from './TileShaderPatchOperation';

interface LivePatch {
  spec:     QuadrantSpec;
  baked:    BakedPatch;
  material: TerrainMaterial;
  mesh:     THREE.Mesh;
  /** CPU copy of the elevation texture, read on demand for camera collision. */
  cpuElevation: Float32Array | null;
}

export class TerrainPatchOperation implements IPatchOperation {
  /** Baking a patch runs several GPU passes — spread the work over frames. */
  readonly maxPatchesPerFrame = 6;

  /**
   * Noise coordinates are 32-bit floats: past this level a texel is smaller
   * than what they can resolve (about a metre at 100 km per terrain unit).
   */
  readonly maxLevel = 14;

  /**
   * A terrain patch holds a 65-texel elevation grid, far more detail than a
   * flat tile patch: let each one cover three times more pixels.
   */
  readonly screenSizeScale = 3;

  /** Grid cells per side of a patch mesh. */
  meshSubdivisions = 32;
  /** Texels per side of the elevation / attribute / tree textures (vertex-centred). */
  elevationResolution = 65;
  /** Texels per side of the bump and detail textures. */
  bumpResolution   = 65;
  detailResolution = 65;

  /** Samples per side of the grid mapping a patch onto the planet. */
  private static readonly DIRECTION_GRID_RES = 33;

  private readonly baker: TerrainPatchBaker;
  private readonly live = new Map<string, LivePatch>();
  private readonly identity = new THREE.Matrix3();
  private debugMode: number | null = null;
  private lastSurfaceRadius = SURFACE_OFFSET;

  /**
   * Biome boundaries around a patch (null: standard biome everywhere).
   * Changing what it returns requires invalidating the LOD renderer.
   */
  biomeSource: ((spec: QuadrantSpec) => BiomeBoundarySet | null) | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly params: TerrainParams = terrainParams,
  ) {
    this.baker = new TerrainPatchBaker(renderer);
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  /**
   * Overrides the debug view of every patch (TERRAIN_DEBUG_*).
   * null follows the debug view selected in the shared parameters.
   */
  setDebugMode(mode: number | null): void {
    this.debugMode = mode;
    for (const patch of this.live.values()) patch.material.setDebugMode(mode, this.params);
  }

  /**
   * Applies a change of the shared parameters to the live patches.
   * Returns false when the patches must be rebuilt from scratch (the caller
   * then invalidates the LOD renderer).
   */
  applyParamsChange(change: TerrainChange): boolean {
    if (change === 'elevation') return false;

    for (const patch of this.live.values()) {
      switch (change) {
        case 'trees':
          this.baker.bakeTreeDensity(patch.baked, this.params);
          break;
        case 'bump':
          this.baker.bakeBump(patch.baked, this.params);
          break;
        case 'detail':
          if (this.params.detailNoiseEnabled) this.baker.bakeDetail(patch.baked, this.params);
          break;
        case 'display':
          break;
      }
      patch.material.sync(this.params);
    }
    return true;
  }

  // ── IPatchOperation ────────────────────────────────────────────────────────

  createPatch(spec: QuadrantSpec, wireframe: boolean): THREE.Object3D | null {
    const params = this.params;

    const domain = spherePatchDomain(spec, TerrainPatchOperation.DIRECTION_GRID_RES);
    const baked  = this.baker.createPatch(domain, {
      elevation: this.elevationResolution,
      bump:      this.bumpResolution,
      detail:    this.detailResolution,
    });
    this.baker.setBiomes(baked, this.biomeSource?.(spec) ?? null);
    this.baker.bakeAll(baked, params);

    const material = new TerrainMaterial(
      params,
      baked,
      {
        unitToLocal:   kmToDistance(params.kmPerUnit),
        flatUp:        null,           // sphere patch: displace along the planet direction
        domainToWorld: this.identity,  // the scene frame is the planet frame
      },
      { wireframe, debugMode: this.debugMode },
    );

    const mesh = new THREE.Mesh(this.buildGeometry(spec, domain.center), material.material);
    mesh.position.copy(domain.center).multiplyScalar(SURFACE_OFFSET);
    // Vertices are displaced on the GPU, so the geometry bounds are not the
    // rendered bounds; visibility is already decided by the LOD system.
    mesh.frustumCulled = false;

    this.live.set(spec.key, { spec, baked, material, mesh, cpuElevation: null });
    return mesh;
  }

  disposePatch(key: string, object: THREE.Object3D): void {
    const patch = this.live.get(key);
    if (!patch) return;
    (object as THREE.Mesh).geometry.dispose();
    patch.material.dispose();
    this.baker.disposePatch(patch.baked);
    this.live.delete(key);
  }

  dispose(): void {
    for (const patch of this.live.values()) {
      patch.mesh.geometry.dispose();
      patch.material.dispose();
      this.baker.disposePatch(patch.baked);
    }
    this.live.clear();
    this.baker.dispose();
  }

  // ── Surface queries ────────────────────────────────────────────────────────

  /**
   * Radius of the displayed terrain surface (distance from the world origin)
   * in the given unit direction — used to keep the fly camera above ground.
   *
   * Reads the baked elevation of the finest live patch under the direction.
   * When no patch covers it (the ground under the camera is outside the view
   * frustum, or not baked yet) the last known radius is returned, so the
   * camera neither sinks nor jumps.
   */
  sampleSurfaceRadiusAt(normalizedDir: THREE.Vector3): number {
    const params = this.params;
    const reliefKm = (elev: number) =>
      (Math.max(elev, params.seaLevel) - params.seaLevel) * params.elevationAmplitudeApparentKm;

    const { face, u, v } = ProjectionManager.sphereToCube(normalizedDir);

    let best: LivePatch | null = null;
    for (const patch of this.live.values()) {
      const s = patch.spec;
      if (s.face !== face || u < s.u0 || u > s.u1 || v < s.v0 || v > s.v1) continue;
      if (!best || s.level > best.spec.level) best = patch;
    }
    if (!best) return this.lastSurfaceRadius;

    if (!best.cpuElevation) best.cpuElevation = this.baker.readElevation(best.baked);

    // Bilinear sample of the raw elevation (R channel) at the patch coordinate.
    const n  = best.baked.resolution.elevation;
    const fs = ((u - best.spec.u0) / (best.spec.u1 - best.spec.u0)) * (n - 1);
    const ft = ((v - best.spec.v0) / (best.spec.v1 - best.spec.v0)) * (n - 1);
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(fs)));
    const j0 = Math.max(0, Math.min(n - 2, Math.floor(ft)));
    const a  = Math.max(0, Math.min(1, fs - i0));
    const b  = Math.max(0, Math.min(1, ft - j0));
    const e  = best.cpuElevation;
    const at = (i: number, j: number) => e[(j * n + i) * 4];
    const raw = (at(i0, j0)     * (1 - a) + at(i0 + 1, j0)     * a) * (1 - b)
              + (at(i0, j0 + 1) * (1 - a) + at(i0 + 1, j0 + 1) * a) * b;

    this.lastSurfaceRadius = SURFACE_OFFSET + kmToDistance(reliefKm(raw + params.elevationOffset));
    return this.lastSurfaceRadius;
  }

  // ── private ────────────────────────────────────────────────────────────────

  /**
   * Geometry of a sphere patch.  Follows the terrain geometry contract:
   *   position — point of the undisplaced sphere, relative to the patch centre
   *              (computed in double precision, so deep patches stay accurate)
   *   normal   — unit direction of the vertex on the planet
   *   uv       — patch coordinate: u along the cube-face u axis, v along its v axis
   */
  private buildGeometry(spec: QuadrantSpec, center: THREE.Vector3): THREE.BufferGeometry {
    const n = this.meshSubdivisions;
    const count     = (n + 1) * (n + 1);
    const positions = new Float32Array(count * 3);
    const normals   = new Float32Array(count * 3);
    const uvs       = new Float32Array(count * 2);
    const dir = new THREE.Vector3();

    let k = 0;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        cubeRectDir(spec, s, t, dir);

        positions[k * 3]     = (dir.x - center.x) * SURFACE_OFFSET;
        positions[k * 3 + 1] = (dir.y - center.y) * SURFACE_OFFSET;
        positions[k * 3 + 2] = (dir.z - center.z) * SURFACE_OFFSET;

        normals[k * 3]     = dir.x;
        normals[k * 3 + 1] = dir.y;
        normals[k * 3 + 2] = dir.z;

        uvs[k * 2]     = s;
        uvs[k * 2 + 1] = t;
        k++;
      }
    }

    // Faces ±Y map (u, v) with the opposite handedness: flip the winding there.
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
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }
}
