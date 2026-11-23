/**
 * Biome layout of the Shaders-tab patch — a fan of rays from a centre point.
 *
 * The rays cut the plane into sectors; each sector is assigned a biome.  A ray
 * between two sectors of different biomes is a biome boundary.  Until a centre
 * is placed there is no ray, and the whole patch is of the first sector's biome.
 *
 * Coordinates are those of the Shaders-tab scene: x east, z south, in terrain
 * units, origin at the patch centre.  Ray angles are measured in that plane,
 * angle = atan2(z, x), kept sorted in (-π, π].
 *
 * Sector i starts at ray i and runs (increasing angle) to the next ray.  With
 * fewer than two rays there is a single sector.
 *
 * Changes are notified as 'preview' while an edit is in progress (dragging)
 * and as 'commit' once it is final; listeners can defer costly work to commits.
 */

import * as THREE from 'three';
import {
  BIOME_STANDARD,
  pushBoundaryEdge,
  type BiomeBoundaryEdge,
  type BiomeBoundarySet,
} from '@core/terrain/BiomeBoundaries';
import { tangentPlaneDir, type TangentFrame } from '@core/terrain/PatchDomain';

/** Minimum angle between two rays (radians). */
const MIN_RAY_SEPARATION = THREE.MathUtils.degToRad(2);

export type BiomeLayoutChange = 'preview' | 'commit';

export class BiomeLayout {
  private _center: THREE.Vector2 | null = null;
  private _rays: number[] = [];
  private _sectorBiomes: number[] = [BIOME_STANDARD];

  private readonly listeners = new Set<(change: BiomeLayoutChange) => void>();

  get center(): THREE.Vector2 | null { return this._center; }
  get rays(): readonly number[] { return this._rays; }
  get sectorBiomes(): readonly number[] { return this._sectorBiomes; }
  get sectorCount(): number { return this._sectorBiomes.length; }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /** Angle of the point (x, z) seen from the centre. */
  angleTo(x: number, z: number): number {
    const c = this._center;
    return c ? Math.atan2(z - c.y, x - c.x) : 0;
  }

  /** Index of the sector containing the given angle. */
  sectorAt(angle: number): number {
    const n = this._rays.length;
    if (n < 2) return 0;
    for (let i = n - 1; i >= 0; i--) {
      if (this._rays[i] <= angle) return i;
    }
    return n - 1; // before the first ray: the last sector, which wraps around
  }

  /** Angular extent [start, end] of a sector (end > start, may exceed π). */
  sectorRange(i: number): [number, number] {
    const n = this._rays.length;
    if (n < 2) {
      const start = n === 1 ? this._rays[0] : -Math.PI;
      return [start, start + 2 * Math.PI];
    }
    const start = this._rays[i];
    let end = this._rays[(i + 1) % n];
    if (end <= start) end += 2 * Math.PI;
    return [start, end];
  }

  /**
   * Position (x, z) of the marker of sector i: on its bisector, at `radius`
   * from the centre.  Null without a centre.
   */
  sectorMarker(i: number, radius: number): THREE.Vector2 | null {
    const c = this._center;
    if (!c) return null;
    const [a0, a1] = this.sectorRange(i);
    const mid = 0.5 * (a0 + a1);
    return new THREE.Vector2(c.x + radius * Math.cos(mid), c.y + radius * Math.sin(mid));
  }

  /** True when ray i separates two sectors of different biomes. */
  isBoundary(i: number): boolean {
    const n = this._rays.length;
    if (n < 2) return false;
    return this._sectorBiomes[(i - 1 + n) % n] !== this._sectorBiomes[i];
  }

  // ── Edits ───────────────────────────────────────────────────────────────────

  setCenter(x: number, z: number, change: BiomeLayoutChange = 'commit'): void {
    if (this._center) this._center.set(x, z);
    else this._center = new THREE.Vector2(x, z);
    this.changed(change);
  }

  /** Adds a ray; the sector it splits keeps its biome on both sides.  Returns its index or -1. */
  addRay(angle: number): number {
    if (!this._center) return -1;
    angle = wrapAngle(angle);
    if (this._rays.some((r) => Math.abs(wrapAngle(r - angle)) < MIN_RAY_SEPARATION)) return -1;

    const n = this._rays.length;
    const biome = this._sectorBiomes[this.sectorAt(angle)];
    let k = 0;
    while (k < n && this._rays[k] < angle) k++;
    this._rays.splice(k, 0, angle);
    if (n >= 1) this._sectorBiomes.splice(k, 0, biome);
    this.changed('commit');
    return k;
  }

  /**
   * Pivots ray i around the centre towards `angle`, without crossing its
   * neighbours (the sectors keep their biomes).  Returns the new index of the
   * ray (it changes when the ray crosses the ±π direction).
   */
  setRayAngle(i: number, angle: number, change: BiomeLayoutChange = 'commit'): number {
    const n = this._rays.length;
    if (i < 0 || i >= n) return i;

    let target = wrapAngle(angle);
    if (n >= 2) {
      const prev = this._rays[(i - 1 + n) % n];
      const next = this._rays[(i + 1) % n];
      const span = n === 2 ? 2 * Math.PI : positiveAngle(next - prev);
      const d = THREE.MathUtils.clamp(positiveAngle(target - prev), MIN_RAY_SEPARATION, span - MIN_RAY_SEPARATION);
      target = wrapAngle(prev + d);
    }

    // Re-sort (a cyclic rotation at most), carrying each sector with its starting ray.
    const pairs = this._rays.map((r, k) => ({ r: k === i ? target : r, b: this._sectorBiomes[k] ?? this._sectorBiomes[0], moved: k === i }));
    pairs.sort((p, q) => p.r - q.r);
    this._rays = pairs.map((p) => p.r);
    if (n >= 2) this._sectorBiomes = pairs.map((p) => p.b);
    this.changed(change);
    return pairs.findIndex((p) => p.moved);
  }

  /** Removes ray i; the sector it started merges into the previous one. */
  removeRay(i: number): void {
    const n = this._rays.length;
    if (i < 0 || i >= n) return;
    this._rays.splice(i, 1);
    if (n >= 2) this._sectorBiomes.splice(i, 1);
    this.changed('commit');
  }

  setSectorBiome(i: number, biome: number): void {
    if (i < 0 || i >= this._sectorBiomes.length || this._sectorBiomes[i] === biome) return;
    this._sectorBiomes[i] = biome;
    this.changed('commit');
  }

  /** Removes the centre, the rays and the biome assignments. */
  clear(): void {
    this._center = null;
    this._rays = [];
    this._sectorBiomes = [BIOME_STANDARD];
    this.changed('commit');
  }

  /** Signals the end of a series of 'preview' edits. */
  commit(): void {
    this.changed('commit');
  }

  // ── Conversion ──────────────────────────────────────────────────────────────

  /**
   * Biome boundaries on the planet.  The tangent plane is a gnomonic
   * projection, so each ray is exactly a great-circle arc.
   *
   * @param frame   tangent frame of the patch
   * @param toRadii planet radii per terrain unit
   * @param reach   length of the rays, terrain units (beyond the patch)
   */
  toBoundarySet(frame: TangentFrame, toRadii: number, reach: number): BiomeBoundarySet {
    const edges: BiomeBoundaryEdge[] = [];
    const c = this._center;
    const n = this._rays.length;
    if (!c) return { defaultBiome: this._sectorBiomes[0], edges };

    const a = tangentPlaneDir(frame, c.x * toRadii, c.y * toRadii, new THREE.Vector3());
    const b = new THREE.Vector3();
    const sample = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      if (!this.isBoundary(i)) continue;
      const angle = this._rays[i];
      tangentPlaneDir(
        frame,
        (c.x + reach * Math.cos(angle)) * toRadii,
        (c.y + reach * Math.sin(angle)) * toRadii,
        b,
      );
      // A point just past the ray, inside sector i.
      const sa = angle + 1e-3;
      tangentPlaneDir(
        frame,
        (c.x + 0.5 * reach * Math.cos(sa)) * toRadii,
        (c.y + 0.5 * reach * Math.sin(sa)) * toRadii,
        sample,
      );
      const after  = this._sectorBiomes[i];
      const before = this._sectorBiomes[(i - 1 + n) % n];
      pushBoundaryEdge(edges, a, b, sample, after, before);
    }

    return { defaultBiome: this._sectorBiomes[0], edges };
  }

  // ── Change notification ─────────────────────────────────────────────────────

  onChange(listener: (change: BiomeLayoutChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(change: BiomeLayoutChange): void {
    for (const l of this.listeners) l(change);
  }
}

/** Wraps an angle to (-π, π]. */
function wrapAngle(a: number): number {
  const r = positiveAngle(a + Math.PI) - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}

/** Wraps an angle to [0, 2π). */
function positiveAngle(a: number): number {
  const r = a % (2 * Math.PI);
  return r < 0 ? r + 2 * Math.PI : r;
}
