/**
 * Tile-colored LOD renderer for the World tab.
 *
 * Uses ViewFrustumLOD to compute which quadrants are visible, then generates a
 * Three.js mesh for each quadrant where every vertex is colored by the
 * tectonic tile it belongs to.  Tile lookup is powered by TileQuadTree.
 *
 * Color modes:
 *   PLATE    — plate category color (continental / oceanic / microplate)
 *   GEOLOGY  — geological type + intensity color
 */

import * as THREE from 'three';
import { ViewFrustumLOD, QuadrantSpec } from '@core/quadtree';
import { CubeFace, ProjectionManager } from '@core/geometry/SphereProjection';
import { TileQuadTree } from '../tectonics/TileQuadTree';
import { Tile } from '../tectonics/data/Plate';
import { getPlateColor } from '../visualization/PlateColors';
import { getGeologicalColor } from '../visualization/GeologyColors';

// ── Public API types ──────────────────────────────────────────────────────────

export enum LODColorMode {
  PLATE = 'plate',
  GEOLOGY = 'geology',
}

// ── LODTileRenderer ───────────────────────────────────────────────────────────

export class LODTileRenderer {
  private readonly scene: THREE.Scene;
  private readonly viewFrustumLOD: ViewFrustumLOD;
  private readonly quadrantMeshes = new Map<string, THREE.Mesh>();

  /**
   * Number of vertex subdivisions per quadrant edge.
   * Higher = smoother sphere surface but more geometry.
   */
  private subdivisionFactor = 8;

  private targetScreenSpaceError = 128;
  private colorMode: LODColorMode = LODColorMode.PLATE;
  private enabled = false; // off by default; user enables via GUI

  /**
   * Small radial offset to push LOD meshes above the dual mesh surface and
   * avoid z-fighting.
   */
  private static readonly SURFACE_OFFSET = 1.003;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.viewFrustumLOD = new ViewFrustumLOD({ sphereMode: true });
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  isEnabled(): boolean { return this.enabled; }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.clearMeshes();
  }

  setColorMode(mode: LODColorMode): void {
    if (this.colorMode === mode) return;
    this.colorMode = mode;
    this.clearMeshes(); // force regeneration with new colors
  }

  getColorMode(): LODColorMode { return this.colorMode; }

  setTargetScreenSpaceError(v: number): void {
    this.targetScreenSpaceError = Math.max(8, Math.min(256, v));
  }

  getTargetScreenSpaceError(): number { return this.targetScreenSpaceError; }

  /**
   * Invalidate all cached meshes.  Call after tectonic rebuild or when
   * the tile data changes so meshes are regenerated with up-to-date colors.
   */
  invalidate(): void { this.clearMeshes(); }

  // ── Per-frame update ──────────────────────────────────────────────────────

  update(
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number,
    tileTree: TileQuadTree | null
  ): void {
    if (!this.enabled || !tileTree) return;

    this.viewFrustumLOD.setConfig({
      targetScreenSpaceError: this.targetScreenSpaceError,
      sphereMode: true,
    });
    const result = this.viewFrustumLOD.computeLOD(camera, screenWidth, screenHeight);

    // Remove obsolete quadrants
    for (const [key, mesh] of this.quadrantMeshes) {
      if (!result.quadrants.has(key)) {
        this.disposeMesh(mesh);
        this.quadrantMeshes.delete(key);
      }
    }

    // Add newly visible quadrants
    for (const [key, spec] of result.quadrants) {
      if (!this.quadrantMeshes.has(key)) {
        const mesh = this.createMesh(spec, tileTree);
        if (mesh) {
          this.scene.add(mesh);
          this.quadrantMeshes.set(key, mesh);
        }
      }
    }
  }

  dispose(): void {
    this.clearMeshes();
  }

  // ── Mesh generation ───────────────────────────────────────────────────────

  /**
   * Creates a triangulated grid mesh for one LOD quadrant, with per-vertex
   * colors derived from the underlying tile.
   */
  private createMesh(spec: QuadrantSpec, tileTree: TileQuadTree): THREE.Mesh | null {
    const n = this.subdivisionFactor;
    if (n <= 0) return null;

    const positions: number[] = [];
    const colorsBuf: number[] = [];
    const indices: number[] = [];
    const face = spec.face as CubeFace;
    const offset = LODTileRenderer.SURFACE_OFFSET;

    for (let i = 0; i <= n; i++) {
      const u = spec.u0 + (spec.u1 - spec.u0) * (i / n);
      for (let j = 0; j <= n; j++) {
        const v = spec.v0 + (spec.v1 - spec.v0) * (j / n);

        // Project cube UV → unit-sphere, then push slightly outward
        const p = ProjectionManager.cubeToSphere(face, u, v).multiplyScalar(offset);
        positions.push(p.x, p.y, p.z);

        const [r, g, b] = this.vertexColor(p, tileTree);
        colorsBuf.push(r, g, b);
      }
    }

    // Faces PLUS_Y (2) and MINUS_Y (3) have opposite UV handedness — reverse winding
    const reverseWinding = spec.face === 2 || spec.face === 3;
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
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colorsBuf, 3));
    geo.setIndex(indices);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
    });

    return new THREE.Mesh(geo, mat);
  }

  // ── Color helpers ─────────────────────────────────────────────────────────

  private vertexColor(spherePoint: THREE.Vector3, tileTree: TileQuadTree): [number, number, number] {
    const tiles = tileTree.queryPoint(spherePoint);
    const tile = closestTile(spherePoint, tiles);
    if (!tile) return [0.3, 0.3, 0.3];
    return this.tileColor(tile);
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

  // ── Mesh lifecycle ────────────────────────────────────────────────────────

  private clearMeshes(): void {
    for (const mesh of this.quadrantMeshes.values()) {
      this.disposeMesh(mesh);
    }
    this.quadrantMeshes.clear();
  }

  private disposeMesh(mesh: THREE.Mesh): void {
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Returns the tile whose centroid is closest to `point` on the sphere.
 * Used to resolve ambiguity when a vertex falls in a cell shared by multiple tiles.
 */
function closestTile(point: THREE.Vector3, tiles: Tile[]): Tile | null {
  if (tiles.length === 0) return null;
  if (tiles.length === 1) return tiles[0];
  let best = tiles[0];
  let bestDist = point.distanceToSquared(tiles[0].centroid);
  for (let i = 1; i < tiles.length; i++) {
    const d = point.distanceToSquared(tiles[i].centroid);
    if (d < bestDist) { bestDist = d; best = tiles[i]; }
  }
  return best;
}
