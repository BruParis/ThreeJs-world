import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * Handles Three.js scene setup for ISEA3H: camera, renderer, controls, and lights.
 * Configured for 3D spherical visualization.
 */
export class SceneSetup {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly labelRenderer: CSS2DRenderer;
  public readonly controls: OrbitControls;

  constructor(contentArea: HTMLElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Camera - positioned for 3D viewing
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(3, 2, 3);
    this.camera.lookAt(0, 0, 0);

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    contentArea.appendChild(this.renderer.domElement);

    // CSS2D Renderer for labels
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    contentArea.appendChild(this.labelRenderer.domElement);

    // Initial size
    this.updateSize(contentArea);
    this.renderer.domElement.style.display = 'none';
    this.labelRenderer.domElement.style.display = 'none';

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    this.scene.add(directionalLight);

    // Axes helper
    const axesHelper = new THREE.AxesHelper(1.5);
    this.scene.add(axesHelper);
  }

  /**
   * Updates renderer size to match the content area.
   */
  updateSize(contentArea: HTMLElement): void {
    const width = contentArea.clientWidth || window.innerWidth;
    const height = contentArea.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  /**
   * Shows the renderers.
   */
  show(): void {
    this.renderer.domElement.style.display = 'block';
    this.labelRenderer.domElement.style.display = 'block';
  }

  /**
   * Hides the renderers.
   */
  hide(): void {
    this.renderer.domElement.style.display = 'none';
    this.labelRenderer.domElement.style.display = 'none';
  }

  /**
   * Renders the scene.
   */
  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /**
   * Disposes of renderer resources.
   */
  dispose(): void {
    this.renderer.dispose();
  }
}
