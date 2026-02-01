import { SceneManager } from './managers/SceneManager';
import { VisualizationManager } from './managers/VisualizationManager';
import { TectonicManager } from './managers/TectonicManager';
import { GUIManager } from './managers/GUIManager';
import { InteractionHandler } from './handlers/InteractionHandler';
import { AnimationController } from './controllers/AnimationController';
import { GeometryBuilder } from './builders/GeometryBuilder';

/**
 * Main application orchestrator that manages all components and their lifecycle.
 */
export class Application {
  private sceneManager: SceneManager;
  private geometryBuilder: GeometryBuilder;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private interactionHandler: InteractionHandler;
  private animationController: AnimationController;
  private guiManager: GUIManager;

  constructor() {
    // Create managers in dependency order
    this.sceneManager = new SceneManager();
    this.geometryBuilder = new GeometryBuilder();
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
    const currentDegree = degree ?? this.visualizationManager.getIcoParams().degree;

    const start_time = performance.now();

    // 1. Build graphs (GeometryBuilder)
    const result = this.geometryBuilder.buildIcosahedronGraphs(currentDegree);
    const ico_build_time = performance.now();

    // 2. Set graphs and stats on VisualizationManager
    this.visualizationManager.setGraphs(result.primalGraph, result.dualGraph);
    this.visualizationManager.setStats(result.stats);
    this.visualizationManager.getIcoParams().degree = currentDegree;

    // 3. Rebuild meshes (visualization)
    this.visualizationManager.rebuildVisualMeshesFromGraphs();
    const meshes_build_time = performance.now();

    // 4. Rebuild tectonics
    this.tectonicManager.rebuildTectonicPlates();
    const end_time = performance.now();

    console.log("Ico build time:", (ico_build_time - start_time).toFixed(2), "ms");
    console.log("Meshes build time:", (meshes_build_time - ico_build_time).toFixed(2), "ms");
    console.log("Tectonic build time:", (end_time - meshes_build_time).toFixed(2), "ms");
    console.log("Total time:", (end_time - start_time).toFixed(2), "ms");

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
