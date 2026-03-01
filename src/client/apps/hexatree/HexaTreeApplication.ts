import { TabApplication } from '../../tabs/TabManager';
import { SceneSetup } from './SceneSetup';
import { MapRenderer } from './MapRenderer';
import { InteractionHandler } from './InteractionHandler';
import { GUISetup, GUIParams } from './GUISetup';

/**
 * Icosahedral net visualization application.
 * Displays a 2D map with equilateral triangles arranged in strips.
 */
export class HexaTreeApplication implements TabApplication {
  private sceneSetup: SceneSetup | null = null;
  private mapRenderer: MapRenderer | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private guiSetup: GUISetup | null = null;

  private params: GUIParams = {
    showFaces: true,
    showWireframe: true,
    showVertices: true,
    showHexagons: true,
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

    this.guiSetup?.dispose();
    this.interactionHandler?.dispose();
    this.mapRenderer?.dispose();
    this.sceneSetup?.dispose();

    this.guiSetup = null;
    this.interactionHandler = null;
    this.mapRenderer = null;
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

    // Map renderer
    this.mapRenderer = new MapRenderer(this.sceneSetup.scene);
    this.mapRenderer.build(this.params);

    // Interaction handler
    this.interactionHandler = new InteractionHandler(
      this.sceneSetup.scene,
      this.sceneSetup.camera,
      this.sceneSetup.renderer.domElement,
      () => this.getContentArea(),
      this.mapRenderer
    );
    this.interactionHandler.createHoverLabel();

    // GUI setup
    this.guiSetup = new GUISetup(
      contentArea,
      this.mapRenderer,
      this.interactionHandler,
      this.params
    );

    this.initialized = true;
  }
}
