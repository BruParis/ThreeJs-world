/**
 * Draws the biome layout over the Shaders-tab patch: the rays (white where
 * they are a biome boundary, grey otherwise), the centre (yellow dot), and one
 * dot per sector in the colour of its biome.
 *
 * Drawn on the sea-level plane, on top of the terrain (no depth test).
 */

import * as THREE from 'three';
import { BIOME_COLORS } from '@core/terrain/BiomeBoundaries';
import type { BiomeLayout } from './BiomeLayout';

const BOUNDARY_COLOR = new THREE.Color(1, 1, 1);
const PLAIN_COLOR    = new THREE.Color(0.45, 0.45, 0.45);
const CENTER_COLOR   = new THREE.Color(1, 0.85, 0.2);

export class BiomeLayoutOverlay {
  readonly group = new THREE.Group();
  private readonly lines:  THREE.LineSegments;
  private readonly points: THREE.Points;

  constructor(scene: THREE.Scene, private readonly layout: BiomeLayout) {
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true }),
    );
    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: 14, sizeAttenuation: false, vertexColors: true,
        depthTest: false, depthWrite: false, transparent: true,
      }),
    );
    this.lines.renderOrder  = 1000;
    this.points.renderOrder = 1001;
    this.lines.frustumCulled  = false;
    this.points.frustumCulled = false;
    this.group.add(this.lines, this.points);
    scene.add(this.group);
  }

  set visible(v: boolean) { this.group.visible = v; }
  get visible(): boolean { return this.group.visible; }

  /** Rebuilds the overlay for a patch of the given edge length (terrain units). */
  update(patchSize: number): void {
    const layout = this.layout;
    const c = layout.center;
    if (!c) {
      setAttributes(this.lines.geometry, [], []);
      setAttributes(this.points.geometry, [], []);
      return;
    }
    const y = 0.002;

    // ── Rays, clipped to the patch square ────────────────────────────────────
    const pos: number[] = [];
    const col: number[] = [];
    layout.rays.forEach((angle, i) => {
      const t = rayLength(c.x, c.y, angle, patchSize);
      if (t <= 0) return;
      const k = layout.isBoundary(i) ? BOUNDARY_COLOR : PLAIN_COLOR;
      pos.push(c.x, y, c.y, c.x + Math.cos(angle) * t, y, c.y + Math.sin(angle) * t);
      col.push(k.r, k.g, k.b, k.r, k.g, k.b);
    });
    setAttributes(this.lines.geometry, pos, col);

    // ── Centre handle + one dot per sector, in its biome colour ──────────────
    const ppos: number[] = [c.x, y, c.y];
    const pcol: number[] = [CENTER_COLOR.r, CENTER_COLOR.g, CENTER_COLOR.b];
    if (layout.rays.length > 0) {
      for (let i = 0; i < layout.sectorCount; i++) {
        const m = layout.sectorMarker(i, sectorMarkerRadius(patchSize))!;
        const k = BIOME_COLORS[layout.sectorBiomes[i]] ?? [1, 0, 1];
        ppos.push(m.x, y, m.y);
        pcol.push(k[0], k[1], k[2]);
      }
    }
    setAttributes(this.points.geometry, ppos, pcol);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Distance from the centre at which the sector markers are drawn. */
export function sectorMarkerRadius(patchSize: number): number {
  return patchSize * 0.12;
}

/** Length of a ray from (x, z) in direction `angle`, clipped to the patch square. */
export function rayLength(x: number, z: number, angle: number, patchSize: number): number {
  const half = patchSize / 2;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  let t = Infinity;
  if (Math.abs(dx) > 1e-9) t = Math.min(t, ((dx > 0 ? half : -half) - x) / dx);
  if (Math.abs(dz) > 1e-9) t = Math.min(t, ((dz > 0 ? half : -half) - z) / dz);
  return Number.isFinite(t) ? t : 0;
}

function setAttributes(geo: THREE.BufferGeometry, pos: number[], col: number[]): void {
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
}
