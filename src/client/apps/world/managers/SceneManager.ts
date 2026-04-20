import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Manages the core Three.js scene, camera, renderers, and controls.
 * This is the foundation for all other managers.
 */
export class SceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private axesHelper: THREE.AxesHelper;
  // When non-null the scene is rendered from this camera instead of the orbit camera
  private flyCamera: THREE.PerspectiveCamera | null = null;

  constructor() {
    // Initialize scene
    this.scene = new THREE.Scene();

    // Add axis helper (x, y, z)
    this.axesHelper = new THREE.AxesHelper(2);
    this.scene.add(this.axesHelper);

    // Initialize camera (aspect ratio will be corrected on first resize)
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / (window.innerHeight - 40), // Account for tab bar
      0.001,
      1000
    );
    this.camera.position.z = 2;

    // Initialize WebGL renderer
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(window.innerWidth, this.getViewportHeight());
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.display = 'none'; // Hidden by default until tab is activated
    this.getContentArea().appendChild(this.renderer.domElement);

    // Initialize label renderer (CSS2D)
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, this.getViewportHeight());
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0px';
    this.labelRenderer.domElement.style.pointerEvents = 'none'; // Let mouse events pass through
    this.labelRenderer.domElement.style.display = 'none'; // Hidden by default until tab is activated
    this.getContentArea().appendChild(this.labelRenderer.domElement);

    // Initialize orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = 1.01; // just above the unit sphere surface

    // Initialize raycaster and mouse vector
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Attach window resize listener
    window.addEventListener('resize', this.onWindowResize.bind(this), false);
  }

  /**
   * Gets the content area element, or falls back to body.
   */
  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  /**
   * Gets the viewport height accounting for tab bar.
   */
  private getViewportHeight(): number {
    const contentArea = document.getElementById('content-area');
    if (contentArea) {
      return contentArea.clientHeight;
    }
    return window.innerHeight;
  }

  /**
   * Handles window resize events.
   */
  private onWindowResize(): void {
    const height = this.getViewportHeight();
    this.camera.aspect = window.innerWidth / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, height);
    this.labelRenderer.setSize(window.innerWidth, height);
    this.render();
  }

  /**
   * Switches the active rendering camera to a fly camera.
   * Pass null to revert to the orbit camera.
   * Orbit controls are disabled while a fly camera is active.
   */
  public setFlyCamera(camera: THREE.PerspectiveCamera | null): void {
    this.flyCamera = camera;
    this.controls.enabled = (camera === null);
  }

  /**
   * Returns the camera that is currently used for rendering
   * (fly camera when active, otherwise the default orbit camera).
   */
  public getActiveCamera(): THREE.PerspectiveCamera {
    return this.flyCamera ?? this.camera;
  }

  /**
   * Renders the scene with both renderers.
   */
  public render(): void {
    const activeCamera = this.flyCamera ?? this.camera;
    if (!this.flyCamera) {
      this.controls.update();
    }
    this.renderer.render(this.scene, activeCamera);
    this.labelRenderer.render(this.scene, activeCamera);
  }

  // Getters for all state
  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public getLabelRenderer(): CSS2DRenderer {
    return this.labelRenderer;
  }

  public getControls(): OrbitControls {
    return this.controls;
  }

  public getRaycaster(): THREE.Raycaster {
    return this.raycaster;
  }

  public getMouse(): THREE.Vector2 {
    return this.mouse;
  }

  public getAxesHelper(): THREE.AxesHelper {
    return this.axesHelper;
  }
}
