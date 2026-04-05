import * as THREE from 'three';
import { TabApplication } from '../../tabs/TabManager';
import { SceneManager } from './managers/SceneManager';
import { VisualizationManager } from './managers/VisualizationManager';
import { TectonicManager } from './managers/TectonicManager';
import { NoiseManager } from './managers/NoiseManager';
import { GUIManager } from './managers/GUIManager';
import { InteractionHandler } from './handlers/InteractionHandler';
import { GeometryBuilder } from './builders/GeometryBuilder';
import { FlyCam } from '@core/FlyCam';
import { LODTileRenderer } from './lod/LODTileRenderer';
import { TileShaderPatchOperation } from './lod/TileShaderPatchOperation';

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

  private flyCam: FlyCam | null = null;
  private patchOperation: TileShaderPatchOperation | null = null;
  private lodTileRenderer: LODTileRenderer | null = null;
  private readonly clock = new THREE.Clock();
  private boundOnResize: () => void;

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

    this.boundOnResize = this.onResize.bind(this);
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

    // 5. Push new tile data to the patch operation, then invalidate cached meshes
    this.patchOperation?.setTileTree(this.tectonicManager.getTileQuadTree());
    this.lodTileRenderer?.invalidate();
  }

  private onFlyCamToggle(enabled: boolean): void {
    if (!this.flyCam) return;
    if (enabled) {
      this.flyCam.enable();
      this.sceneManager.setFlyCamera(this.flyCam.camera);
    } else {
      this.flyCam.disable();
      this.sceneManager.setFlyCamera(null);
    }
  }

  private onResize(): void {
    const contentArea = this.getContentArea();
    const aspect = contentArea.clientWidth / contentArea.clientHeight;
    this.flyCam?.updateAspect(aspect);
  }

  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  public activate(): void {
    if (!this.initialized) {
      // Use the content-area element for aspect ratio — the renderer domElement has
      // display:none at this point so its clientWidth/Height would be 0 (NaN aspect).
      const contentArea = this.getContentArea();
      const aspect = contentArea.clientWidth / contentArea.clientHeight;
      this.flyCam = new FlyCam(
        this.sceneManager.getScene(),
        this.sceneManager.getRenderer().domElement,
        aspect,
        { showDebugHelpers: false }
      );

      // Create patch operation and LOD tile renderer
      this.patchOperation = new TileShaderPatchOperation();
      this.lodTileRenderer = new LODTileRenderer(this.sceneManager.getScene(), this.patchOperation);

      // First-time initialization (also builds tectonic system + tile quad tree)
      this.reset();

      // Create GUI when first activated
      this.guiManager = new GUIManager(
        this.visualizationManager,
        this.tectonicManager,
        this.noiseManager,
        this.interactionHandler,
        (degree: number) => this.reset(degree)
      );

      // Wire LOD controls into GUI
      this.guiManager.setupLODFolder(
        this.flyCam,
        this.lodTileRenderer,
        this.patchOperation,
        (enabled) => this.onFlyCamToggle(enabled)
      );

      this.initialized = true;
    }

    // Attach event listeners (re-attach on every activation)
    this.interactionHandler.attachEventListeners();
    window.addEventListener('resize', this.boundOnResize);

    // Show renderer and GUI
    this.sceneManager.getRenderer().domElement.style.display = 'block';
    this.sceneManager.getLabelRenderer().domElement.style.display = 'block';

    if (this.guiManager) {
      this.guiManager.getGUI().domElement.style.display = 'block';
    }

    this.clock.start();
    this.active = true;
  }

  public deactivate(): void {
    // Always exit fly mode when the tab is deactivated
    if (this.flyCam?.isEnabled()) {
      this.onFlyCamToggle(false);
    }

    // Detach event listeners
    this.interactionHandler.detachEventListeners();
    window.removeEventListener('resize', this.boundOnResize);

    // Hide renderer and GUI
    this.sceneManager.getRenderer().domElement.style.display = 'none';
    this.sceneManager.getLabelRenderer().domElement.style.display = 'none';

    if (this.guiManager) {
      this.guiManager.getGUI().domElement.style.display = 'none';
    }

    this.clock.stop();
    this.active = false;
  }

  public update(): void {
    if (!this.active) return;

    const dt = this.clock.getDelta();

    // Advance fly camera
    this.flyCam?.update(dt);

    // Compute LOD camera: fly cam always drives LOD (same pattern as QuadTree tab)
    const lodCamera = this.flyCam?.camera ?? this.sceneManager.getCamera();
    const canvas = this.sceneManager.getRenderer().domElement;
    this.lodTileRenderer?.update(lodCamera, canvas.clientWidth, canvas.clientHeight);

    this.sceneManager.render();
  }

  public dispose(): void {
    this.interactionHandler.detachEventListeners();
    window.removeEventListener('resize', this.boundOnResize);

    if (this.guiManager) {
      this.guiManager.dispose();
    }

    this.flyCam?.dispose();
    this.lodTileRenderer?.dispose();

    this.noiseManager.clear();
    this.tectonicManager.clear();
  }
}
