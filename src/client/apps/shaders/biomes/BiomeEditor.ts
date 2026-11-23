/**
 * Mouse editing of the Shaders-tab biome layout (direct manipulation).
 *
 * Active only while editing is enabled (setEnabled).  Positions are taken on
 * the sea-level plane under the cursor.
 *
 *   no centre yet            press       → places the centre (keep the button down to drag it)
 *   on the centre (yellow)   drag        → moves the centre, with its rays
 *   on a ray                 drag        → pivots the ray around the centre
 *   on a sector dot          click       → next biome for that sector
 *   on a ray                 right-click → removes the ray
 *   elsewhere                click       → adds a ray from the centre towards the point
 *   elsewhere                drag        → moves the camera, as usual
 *
 * While dragging a handle the camera controls are locked; the layout is
 * updated in 'preview' mode and committed on release (the terrain re-bakes then).
 */

import * as THREE from 'three';
import { BIOME_NAMES } from '@core/terrain/BiomeBoundaries';
import type { BiomeLayout } from './BiomeLayout';
import { rayLength, sectorMarkerRadius } from './BiomeLayoutOverlay';

/** Pointer travel (px) above which a press is a drag, not a click. */
const CLICK_TOLERANCE_PX = 5;
/** Pick radii, px. */
const PICK_CENTER_PX = 12;
const PICK_MARKER_PX = 11;
const PICK_RAY_PX    = 7;

type Hit =
  | { kind: 'none' }
  | { kind: 'center' }
  | { kind: 'marker'; sector: number }
  | { kind: 'ray'; ray: number };

type Gesture =
  | { kind: 'dragCenter' }
  | { kind: 'dragRay'; ray: number }
  | { kind: 'click'; button: number; hit: Hit; x: number; y: number };

export class BiomeEditor {
  private _enabled = false;
  private gesture: Gesture | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly dom: HTMLElement,
    private readonly getCamera: () => THREE.Camera,
    private readonly getPatchSize: () => number,
    /** Locks / unlocks the camera controls while a handle is dragged. */
    private readonly lockCamera: (locked: boolean) => void,
    private readonly layout: BiomeLayout,
  ) {
    // Capture phase: runs before the camera controls see the press.
    dom.addEventListener('pointerdown', this.onDown, true);
    dom.addEventListener('pointermove', this.onMove, true);
    dom.addEventListener('pointerup', this.onUp, true);
  }

  get enabled(): boolean { return this._enabled; }

  setEnabled(v: boolean): void {
    this.endGesture();
    this._enabled = v;
    this.dom.style.cursor = v ? 'crosshair' : '';
  }

  dispose(): void {
    this.setEnabled(false);
    this.dom.removeEventListener('pointerdown', this.onDown, true);
    this.dom.removeEventListener('pointermove', this.onMove, true);
    this.dom.removeEventListener('pointerup', this.onUp, true);
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  private readonly onDown = (e: PointerEvent) => {
    if (!this._enabled) return;
    const layout = this.layout;

    if (e.button === 0 && !layout.center) {
      const p = this.planePoint(e);
      if (!p) return;
      layout.setCenter(p.x, p.z, 'preview');
      this.startDrag({ kind: 'dragCenter' }, e);
      return;
    }

    const hit = this.pick(e);
    if (e.button === 0 && hit.kind === 'center') {
      this.startDrag({ kind: 'dragCenter' }, e);
    } else if (e.button === 0 && hit.kind === 'ray') {
      this.startDrag({ kind: 'dragRay', ray: hit.ray }, e);
    } else if (e.button === 0 || e.button === 2) {
      // Possibly a click; a drag goes on to the camera controls.
      this.gesture = { kind: 'click', button: e.button, hit, x: e.clientX, y: e.clientY };
    }
  };

  private readonly onMove = (e: PointerEvent) => {
    if (!this._enabled) return;
    const g = this.gesture;
    if (!g) {
      this.dom.style.cursor = this.cursorFor(this.pick(e));
      return;
    }
    if (g.kind === 'click') return;

    const p = this.planePoint(e);
    if (!p) return;
    if (g.kind === 'dragCenter') {
      this.layout.setCenter(p.x, p.z, 'preview');
    } else {
      g.ray = this.layout.setRayAngle(g.ray, this.layout.angleTo(p.x, p.z), 'preview');
    }
  };

  private readonly onUp = (e: PointerEvent) => {
    const g = this.gesture;
    if (!this._enabled || !g) return;

    if (g.kind !== 'click') {
      this.endGesture();
      this.layout.commit();
      return;
    }

    this.gesture = null;
    if (e.button !== g.button) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > CLICK_TOLERANCE_PX) return;
    this.click(g.button, g.hit, e);
  };

  // ── Actions ─────────────────────────────────────────────────────────────────

  private click(button: number, hit: Hit, e: PointerEvent): void {
    const layout = this.layout;
    if (button === 2) {
      if (hit.kind === 'ray') layout.removeRay(hit.ray);
      return;
    }
    if (hit.kind === 'marker') {
      const ids = Object.keys(BIOME_NAMES).map(Number).sort((a, b) => a - b);
      const current = layout.sectorBiomes[hit.sector];
      const next = ids[(ids.indexOf(current) + 1) % ids.length];
      layout.setSectorBiome(hit.sector, next);
      return;
    }
    const c = layout.center;
    if (hit.kind === 'none' && c) {
      const p = this.planePoint(e);
      if (p && Math.hypot(p.x - c.x, p.z - c.y) > 1e-6) layout.addRay(layout.angleTo(p.x, p.z));
    }
  }

  private startDrag(gesture: Gesture, e: PointerEvent): void {
    this.gesture = gesture;
    this.lockCamera(true);
    this.dom.setPointerCapture(e.pointerId);
    this.dom.style.cursor = 'grabbing';
  }

  private endGesture(): void {
    if (this.gesture && this.gesture.kind !== 'click') this.lockCamera(false);
    this.gesture = null;
    if (this._enabled) this.dom.style.cursor = 'crosshair';
  }

  // ── Picking ─────────────────────────────────────────────────────────────────

  private cursorFor(hit: Hit): string {
    switch (hit.kind) {
      case 'center': return 'move';
      case 'ray':    return 'grab';
      case 'marker': return 'pointer';
      default:       return 'crosshair';
    }
  }

  /** What is under the cursor, in screen space (centre > sector dot > ray). */
  private pick(e: PointerEvent): Hit {
    const layout = this.layout;
    const c = layout.center;
    if (!c) return { kind: 'none' };

    const m = this.toScreen(c.x, c.y);
    if (!m) return { kind: 'none' };
    const mx = e.clientX;
    const my = e.clientY;
    if (Math.hypot(mx - m.x, my - m.y) <= PICK_CENTER_PX) return { kind: 'center' };

    const size = this.getPatchSize();
    if (layout.rays.length > 0) {
      for (let i = 0; i < layout.sectorCount; i++) {
        const w = layout.sectorMarker(i, sectorMarkerRadius(size))!;
        const s = this.toScreen(w.x, w.y);
        if (s && Math.hypot(mx - s.x, my - s.y) <= PICK_MARKER_PX) return { kind: 'marker', sector: i };
      }
    }

    let best = -1;
    let bestD = PICK_RAY_PX;
    layout.rays.forEach((angle, i) => {
      const t = rayLength(c.x, c.y, angle, size);
      if (t <= 0) return;
      const end = this.toScreen(c.x + Math.cos(angle) * t, c.y + Math.sin(angle) * t);
      if (!end) return;
      const d = distToSegment(mx, my, m.x, m.y, end.x, end.y);
      if (d <= bestD) { bestD = d; best = i; }
    });
    return best >= 0 ? { kind: 'ray', ray: best } : { kind: 'none' };
  }

  /** Client-space position of the sea-level point (x, z), or null when behind the camera. */
  private toScreen(x: number, z: number): { x: number; y: number } | null {
    const v = this.tmp.set(x, 0, z).project(this.getCamera());
    if (v.z > 1) return null;
    const rect = this.dom.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top  + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  /** Point of the sea-level plane under the cursor. */
  private planePoint(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.getCamera());
    return this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
  }
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
