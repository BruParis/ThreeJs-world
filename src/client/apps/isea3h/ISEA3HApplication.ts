import { TabApplication } from '../../tabs/TabManager';
import { SceneSetup } from './SceneSetup';
import { OctahedronRenderer, GUIParams } from './OctahedronRenderer';
import { GUISetup } from './GUISetup';
import { InteractionHandler } from './InteractionHandler';

/**
 * ISEA3H (Icosahedral Snyder Equal Area Aperture 3 Hexagonal) grid visualization.
 * Starts with an octahedron base geometry.
 */
export class ISEA3HApplication implements TabApplication {
  private sceneSetup: SceneSetup | null = null;
  private octahedronRenderer: OctahedronRenderer | null = null;
  private guiSetup: GUISetup | null = null;
  private interactionHandler: InteractionHandler | null = null;

  private params: GUIParams = {
    showFaces: true,
    showWireframe: true,
    showVertices: true,
    sphereMode: true,
    projectionMode: 'snyder',
  };

  private initialized = false;
  private active = false;

  private boundOnResize: () => void;

  constructor() {
    this.boundOnResize = this.onResize.bind(this);
  }

  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  private onResize(): void {
    if (this.sceneSetup) {
      this.sceneSetup.updateSize(this.getContentArea());
    }
  }

  public activate(): void {
    if (!this.initialized) {
      this.initialize();
    }

    this.sceneSetup?.show();
    this.guiSetup?.show();
    this.interactionHandler?.activate();

    window.addEventListener('resize', this.boundOnResize);
    this.active = true;
  }

  public deactivate(): void {
    this.sceneSetup?.hide();
    this.guiSetup?.hide();
    this.interactionHandler?.deactivate();

    window.removeEventListener('resize', this.boundOnResize);
    this.active = false;
  }

  public update(): void {
    if (!this.active || !this.sceneSetup) return;
    this.sceneSetup.render();
  }

  public dispose(): void {
    window.removeEventListener('resize', this.boundOnResize);

    this.interactionHandler?.dispose();
    this.guiSetup?.dispose();
    this.octahedronRenderer?.dispose();
    this.sceneSetup?.dispose();

    this.interactionHandler = null;
    this.guiSetup = null;
    this.octahedronRenderer = null;
    this.sceneSetup = null;
    this.initialized = false;
  }

  /**
   * Initializes all components.
   */
  private initialize(): void {
    const contentArea = this.getContentArea();

    // Scene setup
    this.sceneSetup = new SceneSetup(contentArea);

    // Octahedron renderer
    this.octahedronRenderer = new OctahedronRenderer(this.sceneSetup.scene);
    this.octahedronRenderer.build(this.params);

    // Interaction handler for hover detection
    this.interactionHandler = new InteractionHandler(
      this.sceneSetup.scene,
      this.sceneSetup.camera,
      this.sceneSetup.renderer.domElement,
      () => this.getContentArea(),
      this.octahedronRenderer
    );

    // GUI setup
    this.guiSetup = new GUISetup(
      contentArea,
      this.octahedronRenderer,
      this.params,
      this.interactionHandler
    );

    this.initialized = true;
  }
}
