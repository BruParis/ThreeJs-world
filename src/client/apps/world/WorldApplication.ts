import * as THREE from 'three';
import { TabApplication } from '../../tabs/TabManager';
import { SceneManager } from './managers/SceneManager';
import { VisualizationManager } from './managers/VisualizationManager';
import { TectonicManager } from './managers/TectonicManager';
import { NoiseManager } from './managers/NoiseManager';
import { GUIManager } from './managers/GUIManager';
import { TerrainGUIManager } from './managers/TerrainGUIManager';
import { InteractionHandler } from './handlers/InteractionHandler';
import { GeometryBuilder } from './builders/GeometryBuilder';
import { FlyCam } from '@core/FlyCam';
import { LODTileRenderer } from './lod/LODTileRenderer';
import { TileShaderPatchOperation, LODColorMode, SURFACE_OFFSET } from './lod/TileShaderPatchOperation';
import { TerrainPatchOperation } from './lod/TerrainPatchOperation';
import { TileBiomeBoundaries } from './lod/TileBiomeBoundaries';
import { kmToDistance } from '../../shared/world/World';
import { terrainParams, type TerrainChange } from '../../shared/terrain/TerrainParams';
import { TERRAIN_DEBUG_ELEVATION } from '@core/shaders/terrainSampleGLSL';

/**
 * World application - the main tectonic plate simulation.
 * Wrapped as a TabApplication for use with TabManager.
 */
export class WorldApplication implements TabApplication {
  /**
   * Minimum clearance (km) between the camera eye and the terrain surface.
   * Must be > near_clip (1 km) so the near plane cannot intersect the terrain
   * at shallow viewing angles — the classical "pilot eye height" constraint.
   */
  private static readonly GROUND_CLEARANCE_KM = 2;
  private sceneManager: SceneManager;
  private geometryBuilder: GeometryBuilder;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private noiseManager: NoiseManager;
  private interactionHandler: InteractionHandler;
  private guiManager: GUIManager | null = null;
  private terrainGUIManager: TerrainGUIManager | null = null;

  private flyCam: FlyCam | null = null;
  /** Flat tectonic overlays (plate / geology / LOD level colors). */
  private patchOperation: TileShaderPatchOperation | null = null;
  /** The shader terrain — same pipeline and parameters as the Shaders tab. */
  private terrainPatchOperation: TerrainPatchOperation | null = null;
  private lodTileRenderer: LODTileRenderer | null = null;
  /** Biome boundaries of the terrain patches, from the current plates. */
  private tileBiomes: TileBiomeBoundaries | null = null;
  private unsubscribeTerrainParams: (() => void) | null = null;
  private readonly clock = new THREE.Clock();
  private readonly _footDir = new THREE.Vector3(); // reused each frame for terrain floor query
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

    //    (the patch operations are refreshed by onPlatesChanged)

    // 5. Refresh stats display in the GUI
    this.guiManager?.refresh();
  }

  /**
   * Plates were rebuilt or edited: push the new tile data to the patch
   * operations and drop the cached patches.
   */
  private onPlatesChanged(): void {
    const tree   = this.tectonicManager.getTileQuadTree();
    const system = this.tectonicManager.getTectonicSystem();
    this.patchOperation?.setTileTree(tree);
    this.tileBiomes = tree && system ? new TileBiomeBoundaries(tree, system, terrainParams) : null;
    this.lodTileRenderer?.invalidate();
  }

  /** True when the LOD view currently shows the shader terrain. */
  private isTerrainActive(): boolean {
    return this.terrainPatchOperation !== null
        && this.lodTileRenderer?.getPatchOperation() === this.terrainPatchOperation;
  }

  /**
   * Selects what the LOD view shows.  Terrain and Elevation are rendered by the
   * terrain operation (Elevation being its grayscale debug view); the other
   * modes are flat tectonic overlays rendered by the tile operation.
   */
  private onColorModeChange(mode: LODColorMode): void {
    if (!this.lodTileRenderer || !this.patchOperation || !this.terrainPatchOperation) return;

    if (mode === LODColorMode.TERRAIN || mode === LODColorMode.ELEVATION) {
      this.terrainPatchOperation.setDebugMode(mode === LODColorMode.ELEVATION ? TERRAIN_DEBUG_ELEVATION : null);
      this.lodTileRenderer.setPatchOperation(this.terrainPatchOperation);
    } else {
      this.patchOperation.setColorMode(mode);
      this.lodTileRenderer.setPatchOperation(this.patchOperation);
      this.lodTileRenderer.invalidate();
    }
  }

  /** Reacts to edits of the shared terrain parameters (made in either tab). */
  private onTerrainParamsChanged(change: TerrainChange): void {
    if (!this.isTerrainActive()) return;
    const applied = this.terrainPatchOperation!.applyParamsChange(change);
    if (!applied) this.lodTileRenderer!.invalidate();
  }

  /** Lights for the terrain material; the other materials of this scene are unlit. */
  private addTerrainLights(): void {
    const scene = this.sceneManager.getScene();
    const sun = new THREE.DirectionalLight(0xfff5e6, 2.0);
    sun.position.set(1.0, 0.6, 0.8);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x334d80, 0.8));
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
        {
          showDebugHelpers: false,
          minAltitude: SURFACE_OFFSET, // hard floor at the bare sphere surface; terrain sampler provides the real floor
          near: kmToDistance(1),       // 1 km — avoids near-clip artifacts
          far:  10,                    // ~63 700 km — covers the whole planet from any orbit
        }
      );

      // Create patch operations and LOD tile renderer
      this.patchOperation = new TileShaderPatchOperation();
      this.terrainPatchOperation = new TerrainPatchOperation(this.sceneManager.getRenderer(), terrainParams);
      this.terrainPatchOperation.biomeSource = (spec) => this.tileBiomes?.forQuadrant(spec) ?? null;
      this.tectonicManager.setOnPlatesChanged(() => this.onPlatesChanged());
      this.lodTileRenderer = new LODTileRenderer(this.sceneManager.getScene(), this.patchOperation);
      this.addTerrainLights();
      this.unsubscribeTerrainParams = terrainParams.onChange((change) => this.onTerrainParamsChanged(change));

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
        (mode) => this.onColorModeChange(mode),
        (enabled) => this.onFlyCamToggle(enabled)
      );

      // Terrain GUI (separate pane; the terrain itself is edited in the Shaders tab)
      this.terrainGUIManager = new TerrainGUIManager(terrainParams, contentArea);

      this.initialized = true;
    }

    // Attach event listeners (re-attach on every activation)
    this.interactionHandler.attachEventListeners();
    window.addEventListener('resize', this.boundOnResize);

    // Show renderer and GUI
    this.sceneManager.getRenderer().domElement.style.display = 'block';
    this.sceneManager.getLabelRenderer().domElement.style.display = 'block';

    this.guiManager?.show();
    this.terrainGUIManager?.show();

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

    this.guiManager?.hide();
    this.terrainGUIManager?.hide();

    this.clock.stop();
    this.active = false;
  }

  public update(): void {
    if (!this.active) return;

    const dt = this.clock.getDelta();

    // Advance fly camera
    this.flyCam?.update(dt);

    // Clamp fly camera above the terrain surface.
    // The camera eye must sit at least GROUND_CLEARANCE above the terrain so
    // the near-clip plane cannot intersect the surface at any viewing angle.
    // This is the classical "pilot eye height" technique used in terrain engines.
    if (this.flyCam && this.patchOperation && this.terrainPatchOperation) {
      const cam = this.flyCam.camera;
      this._footDir.copy(cam.position).normalize();
      const terrainRadius  = this.isTerrainActive()
        ? this.terrainPatchOperation.sampleSurfaceRadiusAt(this._footDir)
        : this.patchOperation.sampleSurfaceRadiusAt(this._footDir);
      const floorRadius    = terrainRadius + kmToDistance(WorldApplication.GROUND_CLEARANCE_KM);
      if (cam.position.length() < floorRadius) {
        cam.position.setLength(floorRadius);
      }
    }

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

    this.unsubscribeTerrainParams?.();
    this.unsubscribeTerrainParams = null;
    this.terrainGUIManager?.dispose();

    this.flyCam?.dispose();
    this.lodTileRenderer?.dispose();
    this.terrainPatchOperation?.dispose();

    this.noiseManager.clear();
    this.tectonicManager.clear();
  }
}
