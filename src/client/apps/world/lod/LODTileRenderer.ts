/**
 * LOD renderer — pure patch bookkeeper.
 *
 * Drives ViewFrustumLOD to compute the visible set of quadrants each frame,
 * then adds / removes scene objects by delegating to an IPatchOperation.
 * All rendering concerns (shaders, colors, elevation) live in the operation.
 */

import * as THREE from 'three';
import { ViewFrustumLOD } from '@core/quadtree';
import { IPatchOperation } from './IPatchOperation';

export class LODTileRenderer {
  private readonly scene: THREE.Scene;
  private readonly viewFrustumLOD: ViewFrustumLOD;
  private readonly patchOperation: IPatchOperation;
  private readonly patches = new Map<string, THREE.Object3D>();

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

  /**
   * Discard all cached patches so they are rebuilt on the next update.
   * Call after tile data changes (e.g. tectonic rebuild).
   */
  invalidate(): void { this.clearPatches(); }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number,
  ): void {
    if (!this.enabled) return;

    this.viewFrustumLOD.setConfig({
      targetScreenSpaceError: this.targetScreenSpaceError,
      sphereMode: true,
    });
    const result = this.viewFrustumLOD.computeLOD(camera, screenWidth, screenHeight);

    // Remove patches that are no longer visible
    for (const [key, obj] of this.patches) {
      if (!result.quadrants.has(key)) {
        this.scene.remove(obj);
        this.patchOperation.disposePatch(key, obj);
        this.patches.delete(key);
      }
    }

    // Add newly visible patches
    for (const [key, spec] of result.quadrants) {
      if (!this.patches.has(key)) {
        const obj = this.patchOperation.createPatch(spec, this.wireframe);
        if (obj) {
          this.scene.add(obj);
          this.patches.set(key, obj);
        }
      }
    }
  }

  dispose(): void { this.clearPatches(); }

  // ── Internals ──────────────────────────────────────────────────────────────

  private clearPatches(): void {
    for (const [key, obj] of this.patches) {
      this.scene.remove(obj);
      this.patchOperation.disposePatch(key, obj);
    }
    this.patches.clear();
  }
}
