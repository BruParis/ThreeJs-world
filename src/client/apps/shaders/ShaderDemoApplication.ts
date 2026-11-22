/**
 * Shader Demo tab — flat heightfield terrain.
 *
 * The patch shows, flattened, the terrain the planet has around an anchor point;
 * one scene unit is one terrain unit (see shared/terrain/TerrainParams).
 * Elevation is baked on the GPU by TerrainPatchBaker into textures the terrain
 * material reads for displacement and shading; the plane y = 0 is sea level.
 *
 * Camera: OrbitControls by default; switch to free FlyCam via the GUI.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TabApplication } from '../../tabs/TabManager';
import { FlyCam } from '@core/FlyCam';
import { TerrainMesh } from './terrain/TerrainMesh';
import { buildShaderDemoGUI, ShaderDemoGUIHandle } from './gui/ShaderDemoGUI';

export class ShaderDemoApplication implements TabApplication {
  private renderer:    THREE.WebGLRenderer | null = null;
  private orbitCamera: THREE.PerspectiveCamera | null = null;
  private scene:       THREE.Scene | null = null;
  private controls:    OrbitControls | null = null;
  private flyCam:      FlyCam | null = null;
  private gui:         ShaderDemoGUIHandle | null = null;

  private terrain:      TerrainMesh  | null = null;
  private sunLight:     THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  private readonly clock = new THREE.Clock();
  private rendererReady = false; // renderer + camera are set up
  private terrainReady  = false; // terrain init complete
  private active        = false;
  private readonly boundOnResize: () => void;

  constructor() {
    this.boundOnResize = this.onResize.bind(this);
  }

  // ── TabApplication ──────────────────────────────────────────────────────────

  public activate(): void {
    if (!this.rendererReady) {
      this.initRenderer();
      this.initTerrain();
    }
    if (this.renderer) this.renderer.domElement.style.display = 'block';
    this.gui?.show();
    window.addEventListener('resize', this.boundOnResize);
    this.clock.start();
    this.active = true;
  }

  public deactivate(): void {
    if (this.flyCam?.isEnabled()) this.flyCam.disable();
    if (this.renderer) this.renderer.domElement.style.display = 'none';
    this.gui?.hide();
    window.removeEventListener('resize', this.boundOnResize);
    this.clock.stop();
    this.active = false;
  }

  public update(): void {
    if (!this.active || !this.renderer || !this.scene) return;
    // Skip rendering until the async terrain + GUI are ready.
    if (!this.terrainReady || !this.terrain) return;

    const dt = this.clock.getDelta();

    let renderCam: THREE.PerspectiveCamera;
    if (this.flyCam?.isEnabled()) {
      this.flyCam.update(dt);
      const cam   = this.flyCam.camera;
      const floor = this.terrain.sampleTerrainHeight(cam.position.x, cam.position.z) + 0.03;
      if (cam.position.y < floor) cam.position.y = floor;
      renderCam = this.flyCam.camera;
    } else {
      this.controls?.update();
      renderCam = this.orbitCamera!;
    }

    this.renderer.render(this.scene, renderCam);
  }

  public dispose(): void {
    window.removeEventListener('resize', this.boundOnResize);
    this.flyCam?.dispose();
    this.flyCam = null;
    this.terrain?.dispose();
    this.terrain = null;
    this.controls?.dispose();
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer = null;
    }
    this.gui?.destroy();
    this.gui = null;
    this.rendererReady = false;
    this.terrainReady  = false;
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  /** Synchronous part — renderer, camera, scene, controls (no WebGPU yet). */
  private initRenderer(): void {
    const contentArea = this.getContentArea();
    const w = contentArea.clientWidth;
    const h = contentArea.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    // Sea level is the plane y = 0; keep the grid just below it so the two do not z-fight.
    const grid = new THREE.GridHelper(4, 16, 0x333355, 0x222244);
    grid.position.y = -0.002;
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(1.2));

    // Lights — off by default; the Lighting GUI folder enables/configures them.
    this.sunLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
    this.sunLight.position.set(1.0, 1.4, 0.8); // azimuth≈52°, elevation≈45°
    this.scene.add(this.sunLight);

    this.ambientLight = new THREE.AmbientLight(0x334d80, 0.5);
    this.scene.add(this.ambientLight);

    this.orbitCamera = new THREE.PerspectiveCamera(60, w / h, 0.01, 200);
    this.orbitCamera.position.set(0, 2.0, 2.5);
    this.orbitCamera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top      = '0';
    this.renderer.domElement.style.left     = '0';
    this.renderer.domElement.style.display  = 'none';
    contentArea.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.orbitCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.2;
    this.controls.target.set(0, 0, 0);

    this.flyCam = new FlyCam(this.scene, this.renderer.domElement, w / h, {
      showDebugHelpers: false,
      sphereRadius:     0,
      minY:             0,
      near:             0.02,
      far:              200,
      baseSpeed:        1.5,
    });
    this.flyCam.camera.position.set(0, 1.5, 2.5);
    this.flyCam.camera.lookAt(0, 0, 0);
    this.flyCam.camera.updateMatrixWorld();

    this.rendererReady = true;
  }

  private initTerrain(): void {
    const contentArea = this.getContentArea();

    this.terrain = new TerrainMesh(this.scene!, this.renderer!);
    this.terrain.init();

    this.gui = buildShaderDemoGUI(
      contentArea,
      this.terrain,
      this.controls!,
      this.flyCam!,
      this.sunLight!,
      this.ambientLight!,
    );
    if (this.active) this.gui!.show();

    this.terrainReady = true;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  private onResize(): void {
    if (!this.renderer || !this.orbitCamera) return;
    const contentArea = this.getContentArea();
    const w = contentArea.clientWidth;
    const h = contentArea.clientHeight;
    this.renderer.setSize(w, h);
    this.orbitCamera.aspect = w / h;
    this.orbitCamera.updateProjectionMatrix();
    this.flyCam?.updateAspect(w / h);
  }
}
