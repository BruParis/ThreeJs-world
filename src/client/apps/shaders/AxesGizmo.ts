import * as THREE from 'three';

const GIZMO_SIZE   = 90;  // px — square viewport region
const GIZMO_MARGIN = 14;  // px — distance from bottom-right corner

/**
 * Tiny orientation gizmo rendered in the bottom-right corner.
 * Three arrows (red=X, green=Y, blue=Z) mirror the main scene's AxesHelper
 * and rotate with the camera so the user always knows their orientation.
 */
export class AxesGizmo {
  readonly scene:  THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor() {
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    this.buildArrows();
  }

  /**
   * Call once per frame before render() to sync orientation with the main camera.
   * The gizmo camera is placed along the main camera's view direction at a fixed
   * distance so the arrows reflect the current orbital rotation.
   */
  update(mainCamera: THREE.Camera): void {
    // Place the gizmo camera at (0,0,2.5) rotated by the main camera's quaternion,
    // then copy the quaternion so it looks back toward the origin.
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.camera.position.set(0, 0, 2.5).applyQuaternion(mainCamera.quaternion);
  }

  /**
   * Render the gizmo to the bottom-right corner of the container.
   * Call after the main scene render with autoClear still true.
   */
  render(renderer: THREE.WebGLRenderer, containerW: number, containerH: number): void {
    const s = GIZMO_SIZE;
    const m = GIZMO_MARGIN;
    const x = containerW - s - m;
    const y = m;

    renderer.setViewport(x, y, s, s);
    renderer.setScissor(x, y, s, s);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);

    // Restore full-screen viewport/scissor
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, containerW, containerH);
    renderer.setScissor(0, 0, containerW, containerH);
    renderer.autoClear = true;
  }

  dispose(): void {
    for (const child of [...this.scene.children]) {
      if (child instanceof THREE.ArrowHelper) {
        child.line.geometry.dispose();
        child.cone.geometry.dispose();
        (child.line.material as THREE.Material).dispose();
        (child.cone.material as THREE.Material).dispose();
        this.scene.remove(child);
      }
    }
  }

  private buildArrows(): void {
    const len      = 0.65;
    const headLen  = 0.20;
    const headW    = 0.10;
    const origin   = new THREE.Vector3(0, 0, 0);

    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, len, 0xff3333, headLen, headW));
    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, len, 0x33dd33, headLen, headW));
    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, len, 0x3377ff, headLen, headW));
  }
}
