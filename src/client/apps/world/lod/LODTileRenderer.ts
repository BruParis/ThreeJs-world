/**
 * LOD renderer — pure patch bookkeeper.
 *
 * Drives ViewFrustumLOD to compute the visible set of quadrants each frame,
 * then adds / removes scene objects by delegating to an IPatchOperation.
 * All rendering concerns (shaders, colors, elevation) live in the operation.
 *
 * When the operation limits how many patches it creates per frame, new patches
 * arrive over several frames.  A patch that left the visible set stays on
 * screen until every visible patch covering the same area has been created, so
 * the surface never shows holes while it refines or coarsens.
 */

import * as THREE from 'three';
import { ViewFrustumLOD, QuadrantSpec } from '@core/quadtree';
import { IPatchOperation } from './IPatchOperation';

interface PatchEntry {
  object: THREE.Object3D;
  spec:   QuadrantSpec;
}

/** Deepest level the LOD system goes to when the operation sets no limit. */
const DEFAULT_MAX_DEPTH = 20;

/** Bounds of the frustum margin, scene units (planet radii). */
const MAX_FRUSTUM_MARGIN = 0.1;
const MIN_FRUSTUM_MARGIN = 0.002;

export class LODTileRenderer {
  private readonly scene: THREE.Scene;
  private readonly viewFrustumLOD: ViewFrustumLOD;
  private patchOperation: IPatchOperation;
  private readonly patches = new Map<string, PatchEntry>();

  private targetScreenSpaceError = 128;
  private wireframe = false;
  private enabled = false;

  constructor(scene: THREE.Scene, patchOperation: IPatchOperation) {
    this.scene = scene;
    this.patchOperation = patchOperation;
    this.viewFrustumLOD = new ViewFrustumLOD({ sphereMode: true });
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  isEnabled(): boolean { return this.enabled; }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.clearPatches();
  }

  isWireframe(): boolean { return this.wireframe; }

  setWireframe(v: boolean): void {
    if (this.wireframe === v) return;
    this.wireframe = v;
    this.clearPatches(); // regenerate patches with new wireframe flag
  }

  setTargetScreenSpaceError(v: number): void {
    this.targetScreenSpaceError = Math.max(8, Math.min(256, v));
  }

  getTargetScreenSpaceError(): number { return this.targetScreenSpaceError; }

  getPatchOperation(): IPatchOperation { return this.patchOperation; }

  /**
   * Switches to another patch operation.  Existing patches are disposed by the
   * operation that created them and rebuilt by the new one on the next update.
   */
  setPatchOperation(operation: IPatchOperation): void {
    if (operation === this.patchOperation) return;
    this.clearPatches();
    this.patchOperation = operation;
  }

  /**
   * Discard all cached patches so they are rebuilt on the next update.
   * Call after the data the patches are built from changes (e.g. tectonic rebuild).
   */
  invalidate(): void { this.clearPatches(); }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number,
  ): void {
    if (!this.enabled) return;

    // The frustum margin (which avoids popping at the screen edges) is an
    // absolute distance: shrink it with the camera altitude, otherwise a camera
    // near the ground keeps hundreds of off-screen patches alive.
    const altitude = Math.max(0, camera.position.length() - 1);
    this.viewFrustumLOD.setConfig({
      targetScreenSpaceError: this.targetScreenSpaceError * (this.patchOperation.screenSizeScale ?? 1),
      sphereMode: true,
      frustumMargin: Math.min(MAX_FRUSTUM_MARGIN, Math.max(MIN_FRUSTUM_MARGIN, altitude * 0.5)),
      maxDepth: Math.min(DEFAULT_MAX_DEPTH, this.patchOperation.maxLevel ?? DEFAULT_MAX_DEPTH),
    });
    const result = this.viewFrustumLOD.computeLOD(camera, screenWidth, screenHeight);

    // Create newly visible patches, within the operation's per-frame budget.
    const budget = this.patchOperation.maxPatchesPerFrame ?? Infinity;
    const pending: QuadrantSpec[] = [];
    let created = 0;
    for (const [key, spec] of result.quadrants) {
      if (this.patches.has(key)) continue;
      if (created >= budget) {
        pending.push(spec);
        continue;
      }
      const object = this.patchOperation.createPatch(spec, this.wireframe);
      if (object) {
        this.scene.add(object);
        this.patches.set(key, { object, spec });
        created++;
      }
    }

    // Remove patches that are no longer visible — except those still standing
    // in for a visible patch that has not been created yet.
    for (const [key, entry] of this.patches) {
      if (result.quadrants.has(key)) continue;
      if (pending.some(spec => overlaps(spec, entry.spec))) continue;
      this.scene.remove(entry.object);
      this.patchOperation.disposePatch(key, entry.object);
      this.patches.delete(key);
    }
  }

  dispose(): void { this.clearPatches(); }

  // ── Internals ──────────────────────────────────────────────────────────────

  private clearPatches(): void {
    for (const [key, entry] of this.patches) {
      this.scene.remove(entry.object);
      this.patchOperation.disposePatch(key, entry.object);
    }
    this.patches.clear();
  }
}

/** True when two quadrants of the same cube face cover a common area. */
function overlaps(a: QuadrantSpec, b: QuadrantSpec): boolean {
  return a.face === b.face
      && a.u0 < b.u1 && b.u0 < a.u1
      && a.v0 < b.v1 && b.v0 < a.v1;
}
