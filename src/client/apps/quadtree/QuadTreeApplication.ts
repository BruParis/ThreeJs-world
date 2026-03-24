import { TabApplication } from '../../tabs/TabManager';
import { SceneSetup } from './SceneSetup';
import { CubeRenderer, GUIParams } from './CubeRenderer';
import { GUISetup } from './GUISetup';
import { InteractionHandler } from './InteractionHandler';

/**
 * QuadTree grid visualization based on a cube.
 * Similar to ISEA3H but uses a cube instead of an octahedron.
 */
export class QuadTreeApplication implements TabApplication {
  private sceneSetup: SceneSetup | null = null;
  private cubeRenderer: CubeRenderer | null = null;
  private guiSetup: GUISetup | null = null;
  private interactionHandler: InteractionHandler | null = null;

  private params: GUIParams = {
    showFaces: true,
    showWireframe: true,
    showVertices: true,
    sphereMode: true,
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
    if (this.active && this.sceneSetup) {
      this.sceneSetup.render();
    }
  }

  public dispose(): void {
    this.interactionHandler?.dispose();
    this.guiSetup?.dispose();
    this.cubeRenderer?.dispose();
    this.sceneSetup?.dispose();

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

    // Create cube renderer
    this.cubeRenderer = new CubeRenderer(this.sceneSetup.scene);
    this.cubeRenderer.build(this.params);

    // Create interaction handler
    this.interactionHandler = new InteractionHandler(this.sceneSetup, this.cubeRenderer);

    // Create GUI
    this.guiSetup = new GUISetup(contentArea, this.cubeRenderer, this.params, this.interactionHandler);

    this.initialized = true;
  }
}
