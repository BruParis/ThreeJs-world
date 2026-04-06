import * as THREE from 'three';

/**
 * Options for FlyCam construction.
 */
export interface FlyCamOptions {
  /**
   * Radius of the sphere the camera flies around.
   * Speed is scaled by altitude above the surface (dist - sphereRadius).
   * Default: 1.0
   */
  sphereRadius?: number;
  /**
   * Whether to add a red marker sphere and frustum helper to the scene.
   * Useful during development; disable for production tabs.
   * Default: true
   */
  showDebugHelpers?: boolean;
  /**
   * Minimum allowed distance from origin (world units).
   * Overrides the default surface-clearance minimum when provided.
   */
  minAltitude?: number;
  /**
   * Camera frustum near clip distance (world units).
   * Default: 0.00001. Should be set proportionally to the minimum altitude
   * to keep the near/far ratio manageable for the depth buffer.
   */
  near?: number;
  /**
   * Camera frustum far clip distance (world units).
   * Default: 100.
   */
  far?: number;
  /**
   * Base movement speed (units/second at 1 unit of altitude).
   * Default: 3.0
   */
  baseSpeed?: number;
  /**
   * Mouse look sensitivity in radians per pixel.
   * Default: 0.002
   */
  sensitivity?: number;
}

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
 * Speed scales linearly with altitude above the sphere surface so movement
 * feels natural both at high altitude and when skimming the surface.
 */
export class FlyCam {
  public readonly camera: THREE.PerspectiveCamera;

  private readonly cameraSphere: THREE.Mesh | null;
  private readonly cameraHelper: THREE.CameraHelper | null;
  private readonly scene: THREE.Scene;
  private readonly domElement: HTMLElement;

  // Input state
  private readonly keys = new Set<string>();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private isPointerLocked = false;
  private flyEnabled = false;

  private readonly sphereRadius: number;
  private readonly BASE_SPEED: number;
  private readonly MIN_DIST = 0.001;
  private readonly MIN_ALTITUDE: number;
  private readonly SENSITIVITY: number;

  // Bound event handlers (stored for clean removal)
  private readonly boundKeyDown:           (e: KeyboardEvent) => void;
  private readonly boundKeyUp:             (e: KeyboardEvent) => void;
  private readonly boundMouseMove:         (e: MouseEvent)    => void;
  private readonly boundPointerLockChange: ()                 => void;
  private readonly boundCanvasClick:       ()                 => void;

  constructor(scene: THREE.Scene, domElement: HTMLElement, aspect: number, options: FlyCamOptions = {}) {
    this.scene      = scene;
    this.domElement = domElement;

    this.sphereRadius  = options.sphereRadius  ?? 1.0;
    this.BASE_SPEED    = options.baseSpeed      ?? 3.0;
    this.SENSITIVITY   = options.sensitivity   ?? 0.002;
    // Use provided minAltitude, or default to just above the sphere surface (0.12% clearance)
    this.MIN_ALTITUDE  = options.minAltitude   ?? this.sphereRadius * 1.0012;

    // ── Camera ────────────────────────────────────────────────────────────────
    const near = options.near ?? 0.00001;
    const far  = options.far  ?? 100;
    this.camera = new THREE.PerspectiveCamera(60, aspect, near, far);
    this.camera.position.set(this.sphereRadius * 2.5, this.sphereRadius * 0.5, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.euler.setFromQuaternion(this.camera.quaternion);

    // ── Optional debug helpers ────────────────────────────────────────────────
    const showHelpers = options.showDebugHelpers ?? true;
    if (showHelpers) {
      const sphereGeo = new THREE.SphereGeometry(0.06, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
      this.cameraSphere = new THREE.Mesh(sphereGeo, sphereMat);
      this.cameraSphere.position.copy(this.camera.position);
      scene.add(this.cameraSphere);

      this.cameraHelper = new THREE.CameraHelper(this.camera);
      scene.add(this.cameraHelper);
    } else {
      this.cameraSphere = null;
      this.cameraHelper = null;
    }

    // ── Event handlers ────────────────────────────────────────────────────────
    this.boundKeyDown = (e) => {
      this.keys.add(e.code);
      if (this.flyEnabled && e.code === 'Space') e.preventDefault();
    };
    this.boundKeyUp = (e) => { this.keys.delete(e.code); };

    this.boundMouseMove = (e) => {
      if (!this.isPointerLocked) return;
      this.euler.y -= e.movementX * this.SENSITIVITY;
      this.euler.x -= e.movementY * this.SENSITIVITY;
      this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    };

    this.boundPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;
    };

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
   * Advance the fly camera by one frame.
   * @param dt  Delta time in seconds.
   */
  update(dt: number): void {
    if (this.flyEnabled && this.isPointerLocked) {
      const dist            = this.camera.position.length();
      const altAboveSurface = dist - this.sphereRadius;
      const speed           = this.BASE_SPEED * Math.max(this.MIN_DIST, altAboveSurface);

      const moveDir = new THREE.Vector3();
      if (this.keys.has('KeyW')) moveDir.z -= 1;
      if (this.keys.has('KeyS')) moveDir.z += 1;
      if (this.keys.has('KeyA')) moveDir.x -= 1;
      if (this.keys.has('KeyD')) moveDir.x += 1;
      if (this.keys.has('Space')     || this.keys.has('KeyE'))  moveDir.y += 1;
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ||
          this.keys.has('KeyQ'))                                moveDir.y -= 1;

      if (moveDir.lengthSq() > 0) {
        moveDir.normalize().applyQuaternion(this.camera.quaternion);
        this.camera.position.addScaledVector(moveDir, speed * dt);
      }

      if (this.camera.position.length() < this.MIN_ALTITUDE) {
        this.camera.position.setLength(this.MIN_ALTITUDE);
      }

      if (this.cameraSphere) {
        this.cameraSphere.position.copy(this.camera.position);
      }
    }

    if (this.cameraHelper) {
      this.cameraHelper.update();
    }
  }

  dispose(): void {
    this.disable();
    document.removeEventListener('pointerlockchange', this.boundPointerLockChange);

    if (this.cameraSphere) {
      this.scene.remove(this.cameraSphere);
      (this.cameraSphere.material as THREE.Material).dispose();
      this.cameraSphere.geometry.dispose();
    }
    if (this.cameraHelper) {
      this.scene.remove(this.cameraHelper);
      this.cameraHelper.dispose();
    }
  }
}
