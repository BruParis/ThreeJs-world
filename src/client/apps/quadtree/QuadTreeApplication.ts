import * as THREE from 'three';
import { TabApplication } from '../../tabs/TabManager';
import { SceneSetup } from './SceneSetup';
import { CubeRenderer, GUIParams } from './CubeRenderer';
import { GUISetup } from './GUISetup';
import { InteractionHandler } from './InteractionHandler';
import { FlyCam } from '@core/FlyCam';

/**
 * QuadTree grid visualization based on a cube.
 * Similar to ISEA3H but uses a cube instead of an octahedron.
 */
export class QuadTreeApplication implements TabApplication {
  private sceneSetup: SceneSetup | null = null;
  private cubeRenderer: CubeRenderer | null = null;
  private guiSetup: GUISetup | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private flyCam: FlyCam | null = null;

  private params: GUIParams = {
    showFaces: false,
    showWireframe: true,
    showVertices: false,
    baseShape: 'none',
  };

  private initialized = false;
  private active = false;

  private readonly clock = new THREE.Clock();
  private boundOnResize: () => void;

  constructor() {
    this.boundOnResize = this.onResize.bind(this);
  }

  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  private onResize(): void {
    if (!this.sceneSetup) return;
    const contentArea = this.getContentArea();
    this.sceneSetup.updateSize(contentArea);
    // Keep fly cam aspect in sync
    const aspect = contentArea.clientWidth / contentArea.clientHeight;
    this.flyCam?.updateAspect(aspect);
  }

  private onFlyCamToggle(enabled: boolean): void {
    if (!this.flyCam || !this.sceneSetup) return;
    if (enabled) {
      this.flyCam.enable();
      this.sceneSetup.setFlyCamera(this.flyCam.camera);
    } else {
      this.flyCam.disable();
      this.sceneSetup.setFlyCamera(null);
    }
  }

  public activate(): void {
    if (!this.initialized) {
      this.initialize();
    }

    this.sceneSetup?.show();
    this.guiSetup?.show();
    this.interactionHandler?.activate();
    this.clock.start();

    window.addEventListener('resize', this.boundOnResize);
    this.active = true;
  }

  public deactivate(): void {
    // Always exit fly mode when the tab is deactivated
    if (this.flyCam?.isEnabled()) {
      this.onFlyCamToggle(false);
    }

    this.sceneSetup?.hide();
    this.guiSetup?.hide();
    this.interactionHandler?.deactivate();
    this.clock.stop();

    window.removeEventListener('resize', this.boundOnResize);
    this.active = false;
  }

  public update(): void {
    if (!this.active || !this.sceneSetup) return;

    const dt = this.clock.getDelta();

    // Advance fly camera
    this.flyCam?.update(dt);

    // Update LOD display
    this.interactionHandler?.updateLOD();

    this.sceneSetup.render();
  }

  public dispose(): void {
    this.flyCam?.dispose();
    this.interactionHandler?.dispose();
    this.guiSetup?.dispose();
    this.cubeRenderer?.dispose();
    this.sceneSetup?.dispose();

    this.flyCam = null;
    this.interactionHandler = null;
    this.guiSetup = null;
    this.cubeRenderer = null;
    this.sceneSetup = null;
    this.initialized = false;
  }

  private initialize(): void {
    const contentArea = this.getContentArea();

    // Create scene setup
    this.sceneSetup = new SceneSetup(contentArea);

    // Create fly camera (permanent – also drives frustum LOD computation)
    const aspect = contentArea.clientWidth / contentArea.clientHeight;
    this.flyCam = new FlyCam(
      this.sceneSetup.scene,
      this.sceneSetup.renderer.domElement,
      aspect
    );

    // Create cube renderer
    this.cubeRenderer = new CubeRenderer(this.sceneSetup.scene);
    this.cubeRenderer.build(this.params);

    // Create interaction handler and wire the fly cam
    this.interactionHandler = new InteractionHandler(this.sceneSetup, this.cubeRenderer);
    this.interactionHandler.setFlyCam(this.flyCam);

    // Create GUI
    this.guiSetup = new GUISetup(
      contentArea,
      this.cubeRenderer,
      this.params,
      this.interactionHandler,
      this.flyCam,
      (enabled) => this.onFlyCamToggle(enabled)
    );

    this.initialized = true;
  }
}
