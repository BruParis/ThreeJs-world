import * as THREE from 'three';

/**
 * Fly camera with classic FPS-style controls.
 *
 * Controls (when fly mode is active):
 *   Click canvas  → capture mouse (pointer lock)
 *   Mouse move    → look around (pitch / yaw)
 *   W / S         → forward / backward
 *   A / D         → strafe left / right
 *   Space / E     → move up
 *   Shift / Q     → move down
 *   Escape        → release mouse (browser default)
 *
 * Speed scales linearly with distance from the unit-sphere centre so movement
 * feels natural both at high altitude and when skimming the surface.
 */
export class FlyCam {
  public readonly camera: THREE.PerspectiveCamera;

  private readonly cameraSphere: THREE.Mesh;
  private readonly cameraHelper: THREE.CameraHelper;
  private readonly scene: THREE.Scene;
  private readonly domElement: HTMLElement;

  // Input state
  private readonly keys = new Set<string>();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ'); // standard FPS order
  private isPointerLocked = false;
  private flyEnabled = false;

  // Speed: at altitude h above the sphere surface → speed = BASE_SPEED * max(MIN_DIST, h)
  // This gives strong natural dampening near the surface without any abrupt cutoff.
  private readonly BASE_SPEED   = 3.0;   // units / second at 1 unit of altitude
  private readonly MIN_DIST     = 0.001; // minimum altitude factor (prevents freezing at the surface)
  // Minimum distance from centre allowed (sphere radius = 1; 1.001 ≈ 0.1% above surface)
  private readonly MIN_ALTITUDE = 1.0012;

  // Mouse sensitivity (radians per pixel)
  private readonly SENSITIVITY = 0.002;

  // Bound handlers (stored so we can remove them later)
  private readonly boundKeyDown:          (e: KeyboardEvent) => void;
  private readonly boundKeyUp:            (e: KeyboardEvent) => void;
  private readonly boundMouseMove:        (e: MouseEvent)    => void;
  private readonly boundPointerLockChange: ()                => void;
  private readonly boundCanvasClick:      ()                 => void;

  constructor(scene: THREE.Scene, domElement: HTMLElement, aspect: number) {
    this.scene      = scene;
    this.domElement = domElement;

    // ── Camera ────────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.00001, 100);
    this.camera.position.set(2.5, 0.5, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    // Sync euler from the initial rotation so mouse-look is coherent on first use
    this.euler.setFromQuaternion(this.camera.quaternion);

    // ── Visual indicators ─────────────────────────────────────────────────────
    const sphereGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    this.cameraSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this.cameraSphere.position.copy(this.camera.position);
    scene.add(this.cameraSphere);

    this.cameraHelper = new THREE.CameraHelper(this.camera);
    scene.add(this.cameraHelper);

    // ── Event handlers ────────────────────────────────────────────────────────
    this.boundKeyDown = (e) => {
      this.keys.add(e.code);
      // Prevent Space from scrolling the page while flying
      if (this.flyEnabled && e.code === 'Space') e.preventDefault();
    };
    this.boundKeyUp = (e) => { this.keys.delete(e.code); };

    this.boundMouseMove = (e) => {
      if (!this.isPointerLocked) return;
      this.euler.y -= e.movementX * this.SENSITIVITY;
      this.euler.x -= e.movementY * this.SENSITIVITY;
      // Clamp pitch so the camera never flips over
      this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    };

    this.boundPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;
    };

    // Clicking the canvas requests pointer lock (user gesture required by browser)
    this.boundCanvasClick = () => {
      if (this.flyEnabled && !this.isPointerLocked) {
        this.domElement.requestPointerLock();
      }
    };

    document.addEventListener('pointerlockchange', this.boundPointerLockChange);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Start fly mode: listen to keyboard/mouse, allow pointer lock on click. */
  enable(): void {
    if (this.flyEnabled) return;
    this.flyEnabled = true;
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup',   this.boundKeyUp);
    this.domElement.addEventListener('mousemove', this.boundMouseMove);
    this.domElement.addEventListener('click',     this.boundCanvasClick);
  }

  /** Stop fly mode: release all input listeners and pointer lock. */
  disable(): void {
    if (!this.flyEnabled) return;
    this.flyEnabled = false;
    this.keys.clear();
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup',   this.boundKeyUp);
    this.domElement.removeEventListener('mousemove', this.boundMouseMove);
    this.domElement.removeEventListener('click',     this.boundCanvasClick);
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }

  isEnabled(): boolean { return this.flyEnabled; }

  /** Keep the camera aspect ratio in sync when the canvas is resized. */
  updateAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Must be called every frame.
   * @param dt  Delta time in seconds.
   */
  update(dt: number): void {
    if (this.flyEnabled && this.isPointerLocked) {
      // Speed = BASE_SPEED * altitude_above_surface.
      // Using altitude (dist - 1) instead of dist gives strong dampening near the sphere:
      // at 10× lower altitude the camera moves 10× slower, making close-surface
      // navigation precise without an abrupt speed clamp.
      const dist            = this.camera.position.length();
      const altAboveSurface = dist - 1.0; // sphere radius = 1
      const speed           = this.BASE_SPEED * Math.max(this.MIN_DIST, altAboveSurface);

      const moveDir = new THREE.Vector3();
      if (this.keys.has('KeyW')) moveDir.z -= 1;
      if (this.keys.has('KeyS')) moveDir.z += 1;
      if (this.keys.has('KeyA')) moveDir.x -= 1;
      if (this.keys.has('KeyD')) moveDir.x += 1;
      if (this.keys.has('Space')      || this.keys.has('KeyE')) moveDir.y += 1;
      if (this.keys.has('ShiftLeft')  || this.keys.has('ShiftRight') ||
          this.keys.has('KeyQ'))                                moveDir.y -= 1;

      if (moveDir.lengthSq() > 0) {
        moveDir.normalize().applyQuaternion(this.camera.quaternion);
        this.camera.position.addScaledVector(moveDir, speed * dt);
      }

      // Clamp to minimum altitude above the unit sphere
      const distFromCentre = this.camera.position.length();
      if (distFromCentre < this.MIN_ALTITUDE) {
        this.camera.position.setLength(this.MIN_ALTITUDE);
      }

      this.cameraSphere.position.copy(this.camera.position);
    }

    // Always keep the frustum helper in sync
    this.cameraHelper.update();
  }

  dispose(): void {
    this.disable();
    document.removeEventListener('pointerlockchange', this.boundPointerLockChange);
    this.scene.remove(this.cameraSphere);
    this.scene.remove(this.cameraHelper);
    (this.cameraSphere.material as THREE.Material).dispose();
    this.cameraSphere.geometry.dispose();
    this.cameraHelper.dispose();
  }
}
