import { TabApplication } from '../../tabs/TabManager';
import { SceneManager } from './managers/SceneManager';
import { VisualizationManager } from './managers/VisualizationManager';
import { TectonicManager } from './managers/TectonicManager';
import { NoiseManager } from './managers/NoiseManager';
import { GUIManager } from './managers/GUIManager';
import { InteractionHandler } from './handlers/InteractionHandler';
import { GeometryBuilder } from './builders/GeometryBuilder';

/**
 * World application - the main tectonic plate simulation.
 * Wrapped as a TabApplication for use with TabManager.
 */
export class WorldApplication implements TabApplication {
  private sceneManager: SceneManager;
  private geometryBuilder: GeometryBuilder;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private noiseManager: NoiseManager;
  private interactionHandler: InteractionHandler;
  private guiManager: GUIManager | null = null;

  private initialized = false;
  private active = false;

  constructor() {
    // Create managers in dependency order
    this.sceneManager = new SceneManager();
    this.geometryBuilder = new GeometryBuilder();
    this.visualizationManager = new VisualizationManager(this.sceneManager);
    this.tectonicManager = new TectonicManager(this.visualizationManager, this.sceneManager);
    this.noiseManager = new NoiseManager(this.visualizationManager, this.sceneManager);

    // Wire up NoiseManager with TectonicManager
    this.noiseManager.setOnNoiseDisplayChange(() => this.tectonicManager.refreshPlateDisplay());
    this.noiseManager.setGetTiles(() => this.getAllTiles());
    this.tectonicManager.setNoiseCallbacks(
      () => this.noiseManager.isNoiseDisplayEnabled(),
      () => this.noiseManager.colorByNoise()
    );

    this.interactionHandler = new InteractionHandler(
      this.sceneManager,
      this.visualizationManager,
      this.tectonicManager
    );
  }

  /**
   * Returns an iterable of all tiles from the tectonic system.
   */
  private *getAllTiles() {
    const tectonicSystem = this.tectonicManager.getTectonicSystem();
    if (!tectonicSystem) return;
    for (const plate of tectonicSystem.plates) {
      for (const tile of plate.tiles) {
        yield tile;
      }
    }
  }

  /**
   * Resets the visualization by rebuilding the icosahedron.
   */
  private reset(degree?: number): void {
    const currentDegree = degree ?? this.visualizationManager.getIcoParams().degree;

    // 1. Build graphs
    const result = this.geometryBuilder.buildIcosahedronGraphs(currentDegree);

    // 2. Set graphs and stats
    this.visualizationManager.setGraphs(result.primalGraph, result.dualGraph);
    this.visualizationManager.setStats(result.stats);
    this.visualizationManager.getIcoParams().degree = currentDegree;

    // 3. Rebuild meshes
    this.visualizationManager.rebuildVisualMeshesFromGraphs();

    // 4. Rebuild tectonics
    this.tectonicManager.rebuildTectonicPlates();
  }

  public activate(): void {
    if (!this.initialized) {
      // First-time initialization
      this.reset();
      this.interactionHandler.attachEventListeners();

      // Create GUI when first activated
      this.guiManager = new GUIManager(
        this.visualizationManager,
        this.tectonicManager,
        this.noiseManager,
        this.interactionHandler,
        (degree: number) => this.reset(degree)
      );

      this.initialized = true;
    }

    // Show renderer and GUI
    this.sceneManager.getRenderer().domElement.style.display = 'block';
    this.sceneManager.getLabelRenderer().domElement.style.display = 'block';

    if (this.guiManager) {
      this.guiManager.getGUI().domElement.style.display = 'block';
    }

    this.active = true;
  }

  public deactivate(): void {
    // Hide renderer and GUI
    this.sceneManager.getRenderer().domElement.style.display = 'none';
    this.sceneManager.getLabelRenderer().domElement.style.display = 'none';

    if (this.guiManager) {
      this.guiManager.getGUI().domElement.style.display = 'none';
    }

    this.active = false;
  }

  public update(): void {
    if (this.active) {
      this.sceneManager.render();
    }
  }

  public dispose(): void {
    this.interactionHandler.detachEventListeners();
    if (this.guiManager) {
      this.guiManager.dispose();
    }
    this.noiseManager.clear();
    this.tectonicManager.clear();
  }
}
