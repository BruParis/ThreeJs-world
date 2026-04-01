import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TAB_BAR_HEIGHT } from '../../tabs/TabManager';

/**
 * Handles Three.js scene setup for the QuadTree visualization.
 */
export class SceneSetup {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly labelRenderer: CSS2DRenderer;
  public readonly controls: OrbitControls;

  private contentArea: HTMLElement;
  // When non-null, the scene is rendered from this camera instead of the orbit camera
  private flyCamera: THREE.PerspectiveCamera | null = null;

  constructor(contentArea: HTMLElement) {
    this.contentArea = contentArea;

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111122);

    // Create camera
    const width = contentArea.clientWidth;
    const height = contentArea.clientHeight;
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.set(3, 2, 3);
    this.camera.lookAt(0, 0, 0);

    // Create WebGL renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.display = 'none'; // Hidden by default until tab is activated
    contentArea.appendChild(this.renderer.domElement);

    // Create CSS2D renderer for labels
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(width, height);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = `${TAB_BAR_HEIGHT}px`;
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.labelRenderer.domElement.style.display = 'none'; // Hidden by default until tab is activated
    contentArea.appendChild(this.labelRenderer.domElement);

    // Create controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.3;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(1.5);
    this.scene.add(axesHelper);
  }

  /**
   * Switches the scene to render from a fly camera.
   * Pass null to revert to the orbit camera.
   */
  setFlyCamera(camera: THREE.PerspectiveCamera | null): void {
    this.flyCamera = camera;
    // Orbit controls should not fight with fly mode
    this.controls.enabled = (camera === null);
  }

  /**
   * Updates the renderer and camera size.
   */
  updateSize(contentArea: HTMLElement): void {
    const width  = contentArea.clientWidth;
    const height = contentArea.clientHeight;
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  /**
   * Renders the scene.
   */
  render(): void {
    const activeCamera = this.flyCamera ?? this.camera;
    if (!this.flyCamera) {
      this.controls.update();
    }
    this.renderer.render(this.scene, activeCamera);
    this.labelRenderer.render(this.scene, activeCamera);
  }

  /**
   * Shows the renderer.
   */
  show(): void {
    this.renderer.domElement.style.display = '';
    this.labelRenderer.domElement.style.display = '';
  }

  /**
   * Hides the renderer.
   */
  hide(): void {
    this.renderer.domElement.style.display = 'none';
    this.labelRenderer.domElement.style.display = 'none';
  }

  /**
   * Disposes of Three.js resources.
   */
  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.contentArea.removeChild(this.renderer.domElement);
    this.contentArea.removeChild(this.labelRenderer.domElement);
  }
}
