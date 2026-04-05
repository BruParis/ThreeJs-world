import * as THREE from 'three';
import { QuadrantSpec } from '@core/quadtree';

/**
 * Strategy interface for LOD patch creation.
 *
 * The LODTileRenderer is agnostic about how patches look — it only manages
 * which QuadrantSpecs are visible and delegates creation / disposal to this
 * interface.  Any rendering technique (per-vertex colors, shaders, etc.) can
 * be plugged in by implementing these two methods.
 */
export interface IPatchOperation {
  /**
   * Create a renderable Object3D for the given quadrant spec.
   * Returns null if the patch cannot be created yet (e.g. data not ready).
   *
   * @param spec      - spatial description of the patch (face, level, UV bounds)
   * @param wireframe - whether to render in wireframe mode
   */
  createPatch(spec: QuadrantSpec, wireframe: boolean): THREE.Object3D | null;

  /**
   * Dispose of all GPU resources owned by the patch object.
   * Called when the patch leaves the visible set.
   *
   * @param key    - the QuadrantSpec key (for bookkeeping if needed)
   * @param object - the Object3D previously returned by createPatch
   */
  disposePatch(key: string, object: THREE.Object3D): void;
}
