import { SceneManager } from './managers/SceneManager';
import { VisualizationManager } from './managers/VisualizationManager';
import { TectonicManager } from './managers/TectonicManager';
import { GUIManager } from './managers/GUIManager';
import { InteractionHandler } from './handlers/InteractionHandler';
import { AnimationController } from './controllers/AnimationController';

/**
 * Main application orchestrator that manages all components and their lifecycle.
 */
export class Application {
  private sceneManager: SceneManager;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private interactionHandler: InteractionHandler;
  private animationController: AnimationController;
  private guiManager: GUIManager;

  constructor() {
    // Create managers in dependency order
    this.sceneManager = new SceneManager();
    this.visualizationManager = new VisualizationManager(this.sceneManager);
    this.tectonicManager = new TectonicManager(this.visualizationManager, this.sceneManager);
    this.interactionHandler = new InteractionHandler(
      this.sceneManager,
      this.visualizationManager,
      this.tectonicManager
    );
    this.animationController = new AnimationController(
      this.sceneManager,
      this.visualizationManager
    );
    this.guiManager = new GUIManager(
      this.visualizationManager,
      this.tectonicManager,
      this.interactionHandler,
      (degree: number) => this.reset(degree)
    );
  }

  /**
   * Initializes the application: rebuilds the icosahedron, attaches events, and starts animation.
   */
  public initialize(): void {
    // Initial build
    this.reset();

    // Attach event listeners
    this.interactionHandler.attachEventListeners();

    // Start animation loop
    this.animationController.start();
  }

  /**
   * Resets the visualization by rebuilding the icosahedron at a specific degree (optional).
   * Also rebuilds the tectonic plates since they depend on the underlying geometry.
   */
  public reset(degree?: number): void {
    if (degree !== undefined) {
      this.visualizationManager.getIcoParams().degree = degree;
    }
    this.visualizationManager.rebuildIcosahedronHalfedgeDS();
    this.tectonicManager.rebuildTectonicPlates();
  }

  /**
   * Disposes of all resources and cleans up.
   */
  public dispose(): void {
    this.animationController.stop();
    this.interactionHandler.detachEventListeners();
    this.guiManager.dispose();
    this.tectonicManager.clear();
  }
}
