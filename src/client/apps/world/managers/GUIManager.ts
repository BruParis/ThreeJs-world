import { GUI } from 'dat.gui';
import { debounce } from 'lodash';
import { VisualizationManager } from './VisualizationManager';
import { TectonicManager } from './TectonicManager';
import { NoiseManager } from './NoiseManager';
import { InteractionHandler, BoundaryDisplayMode } from '../handlers/InteractionHandler';
import { PlateDisplayMode, PLATE_VISUALIZATION_LEGEND, rgbToHex } from '../visualization/PlateColors';
import { GEOLOGY_TYPE_LEGEND, geologyTypeColorToHex } from '../visualization/GeologyColors';
import { LODTileRenderer, LODColorMode } from '../lod/LODTileRenderer';
import { FlyCam } from '@core/FlyCam';

const MIN_DEGREE = 0;
const MAX_DEGREE = 7;

/**
 * Manages the dat.GUI interface and coordinates user input with other managers.
 */
export class GUIManager {
  private gui: GUI;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private noiseManager: NoiseManager;
  private interactionHandler: InteractionHandler;
  private onResetCallback: (degree: number) => void;
  private netRotationParams = { x: 0, y: 0, z: 0, magnitude: 0 };
  private lodRenderer: LODTileRenderer | null = null;

  constructor(
    visualizationManager: VisualizationManager,
    tectonicManager: TectonicManager,
    noiseManager: NoiseManager,
    interactionHandler: InteractionHandler,
    onResetCallback: (degree: number) => void
  ) {
    this.visualizationManager = visualizationManager;
    this.tectonicManager = tectonicManager;
    this.noiseManager = noiseManager;
    this.interactionHandler = interactionHandler;
    this.onResetCallback = onResetCallback;

    this.gui = new GUI({ autoPlace: false });
    // Append GUI to content area
    const contentArea = document.getElementById('content-area') || document.body;
    contentArea.appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0';
    this.gui.domElement.style.right = '0';
    this.setupGUI();
  }

  /**
   * Sets up all GUI folders and controls.
   */
  private setupGUI(): void {
    const icoParams = this.visualizationManager.getIcoParams();
    const icosahedronMaterial = this.visualizationManager.getIcosahedronMaterial();
    const dualMaterial = this.visualizationManager.getDualMaterial();
    const graphLinesMaterial = this.visualizationManager.getGraphLinesMaterial();
    const motionVecLinesMaterial = this.visualizationManager.getMotionVecLinesMaterial();
    const neighborTilesLinesMaterial = this.visualizationManager.getNeighborTilesLinesMaterial();

    // Top-level controls
    this.gui
      .add(icoParams, 'degree', MIN_DEGREE, MAX_DEGREE)
      .step(1)
      .name('Subdivision')
      .onChange(debounce((value: number) => this.onResetCallback(value), 300));

    this.gui
      .add({ selectionMode: this.interactionHandler.getSelectionMode() }, 'selectionMode')
      .name('Selection')
      .onChange((value: boolean) => this.interactionHandler.setSelectionMode(value));

    // View - consolidated visibility toggles
    // Some elements are lazy-loaded when first enabled
    const viewGui = this.gui.addFolder('View');
    viewGui.add(dualMaterial, 'visible').name('Dual Mesh');
    viewGui.add(dualMaterial, 'wireframe').name('Wireframe');
    viewGui.add(icosahedronMaterial, 'visible').name('Icosahedron');
    viewGui
      .add(graphLinesMaterial, 'visible')
      .name('Graph Lines')
      .onChange((value: boolean) => {
        if (value) {
          // Lazy load graph lines when first enabled
          this.visualizationManager.computeHalfedgeGraphLines();
        }
      });
    viewGui
      .add(motionVecLinesMaterial, 'visible')
      .name('Motion Vectors')
      .onChange((value: boolean) => {
        if (value) {
          // Lazy load motion vectors when first enabled
          this.tectonicManager.computeMotionVecLines();
        }
      });
    viewGui.add(neighborTilesLinesMaterial, 'visible').name('Neighbor Tiles');

    // Perlin Noise
    const noiseParams = { seed: 42, scale: 2.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };
    const noiseGui = this.gui.addFolder('Perlin Noise');

    const regenerateNoise = debounce(() => {
      this.noiseManager.generatePerlinNoise(
        noiseParams.seed,
        noiseParams.scale,
        noiseParams.octaves,
        noiseParams.persistence,
        noiseParams.lacunarity
      );
    }, 150);

    noiseGui
      .add({ visible: this.noiseManager.isNoiseDisplayEnabled() }, 'visible')
      .name('Show')
      .onChange((value: boolean) => this.noiseManager.setNoiseDisplayEnabled(value));
    noiseGui
      .add({ gradient: this.noiseManager.isGradientDisplayEnabled() }, 'gradient')
      .name('Gradient')
      .onChange((value: boolean) => this.noiseManager.setGradientDisplayEnabled(value));
    noiseGui.add(noiseParams, 'seed', 0, 1000).step(1).name('Seed').onChange(regenerateNoise);
    noiseGui.add(noiseParams, 'scale', 0.5, 10.0).step(0.1).name('Scale').onChange(regenerateNoise);
    noiseGui.add(noiseParams, 'octaves', 1, 8).step(1).name('Octaves').onChange(regenerateNoise);
    noiseGui.add(noiseParams, 'persistence', 0.1, 1.0).step(0.05).name('Persist.').onChange(regenerateNoise);
    noiseGui.add(noiseParams, 'lacunarity', 1.0, 4.0).step(0.1).name('Lacunar.').onChange(regenerateNoise);

    // Tectonic
    const tectonicGui = this.gui.addFolder('Tectonic');
    tectonicGui
      .add({ rebuild: () => { this.tectonicManager.rebuildTectonicPlates(); this.updateNetRotationDisplay(); } }, 'rebuild')
      .name('Rebuild');
    tectonicGui
      .add({ plateDisplay: this.tectonicManager.getPlateDisplayMode() }, 'plateDisplay',
        { 'None': PlateDisplayMode.NONE, 'Category': PlateDisplayMode.CATEGORY })
      .name('Plate Display')
      .onChange((value: PlateDisplayMode) => this.tectonicManager.setPlateDisplayMode(value));
    tectonicGui
      .add({ boundaryDisplay: this.interactionHandler.getBoundaryDisplayMode() }, 'boundaryDisplay',
        { 'Raw': BoundaryDisplayMode.RAW_TYPE, 'Refined': BoundaryDisplayMode.REFINED_TYPE, 'Edge Order': BoundaryDisplayMode.EDGE_ORDER })
      .name('Boundary')
      .onChange((value: BoundaryDisplayMode) => {
        this.interactionHandler.setBoundaryDisplayMode(value);
        this.tectonicManager.refreshAllBoundariesDisplay(value);
        this.visualizationManager.refreshBoundaryDisplay(value);
      });
    tectonicGui
      .add({ showBorder: false }, 'showBorder')
      .name('Border Tiles')
      .onChange((value: boolean) => {
        if (value) this.tectonicManager.showBorderTiles();
        else this.tectonicManager.colorTectonicSystem(false);
      });

    // Plate visualization color legend subfolder (includes categories + microplate)
    const tectonicLegendGui = tectonicGui.addFolder('Legend');
    for (const entry of PLATE_VISUALIZATION_LEGEND) {
      const colorHex = rgbToHex(entry.color);
      const colorObj = { color: colorHex };
      tectonicLegendGui.addColor(colorObj, 'color').name(entry.label).listen();
    }

    tectonicGui.open();

    // Geology
    const geologyGui = this.gui.addFolder('Geology');
    geologyGui
      .add({ show: this.tectonicManager.isGeologyDisplayEnabled() }, 'show')
      .name('Show')
      .onChange((value: boolean) => {
        this.tectonicManager.setGeologyDisplayEnabled(value);
        this.lodRenderer?.setColorMode(value ? LODColorMode.GEOLOGY : LODColorMode.PLATE);
      });
    geologyGui
      .add({ reset: this.tectonicManager.isRecomputeOrogenyMode() }, 'reset')
      .name('Reset Orogeny')
      .onChange((value: boolean) => this.tectonicManager.setRecomputeOrogenyMode(value));

    // Color legend subfolder
    const legendGui = geologyGui.addFolder('Legend');
    for (const entry of GEOLOGY_TYPE_LEGEND) {
      const colorHex = geologyTypeColorToHex(entry.type);
      const colorObj = { color: colorHex };
      legendGui.addColor(colorObj, 'color').name(entry.label).listen();
    }

    // Debug/Stats (collapsed by default)
    const statsGui = this.gui.addFolder('Stats');
    statsGui.add(icoParams, 'numVertices').name('Vertices').listen();
    statsGui.add(icoParams, 'numFaces').name('Primal Faces').listen();
    statsGui.add(this.netRotationParams, 'magnitude').name('Net Rotation').listen();

    // Face distribution subfolder
    const icoDualParams = this.visualizationManager.getIcoDualParams();
    const faceDistGui = statsGui.addFolder('Face distribution');
    faceDistGui.add(icoDualParams, 'dualFaces').name('Dual Faces').listen();
    faceDistGui.add(icoDualParams, 'pentagons').name('Pentagons').listen();
    faceDistGui.add(icoDualParams, 'hexagons').name('Hexagons').listen();
    faceDistGui.add(icoDualParams, 'heptagons').name('Heptagons').listen();
  }

  /**
   * Adds an "LOD View" folder to the GUI.
   * Call once after constructing both the FlyCam and LODTileRenderer.
   *
   * @param flyCam        - fly camera instance
   * @param lodRenderer   - tile-colored LOD renderer
   * @param onFlyCamToggle - callback to enable/disable fly camera on the scene
   */
  public setupLODFolder(
    flyCam: FlyCam,
    lodRenderer: LODTileRenderer,
    onFlyCamToggle: (enabled: boolean) => void
  ): void {
    this.lodRenderer = lodRenderer;
    const lodGui = this.gui.addFolder('LOD View');

    // Grab legacy-view materials so we can hide/show them when LOD is toggled
    const dualMaterial = this.visualizationManager.getDualMaterial();
    const icosahedronMaterial = this.visualizationManager.getIcosahedronMaterial();
    const graphLinesMaterial = this.visualizationManager.getGraphLinesMaterial();
    const motionVecLinesMaterial = this.visualizationManager.getMotionVecLinesMaterial();
    const neighborTilesLinesMaterial = this.visualizationManager.getNeighborTilesLinesMaterial();

    // Saved state so we can restore when LOD is disabled
    let savedVisible = {
      dual: dualMaterial.visible,
      ico: icosahedronMaterial.visible,
      graphLines: graphLinesMaterial.visible,
      motionVec: motionVecLinesMaterial.visible,
      neighborTiles: neighborTilesLinesMaterial.visible,
    };

    // Fly Camera toggle
    const flyParams = { enabled: flyCam.isEnabled() };
    lodGui
      .add(flyParams, 'enabled')
      .name('Fly Camera')
      .onChange((value: boolean) => onFlyCamToggle(value));

    // Frustum LOD toggle — hides legacy view while active
    const lodParams = { enabled: lodRenderer.isEnabled() };
    lodGui
      .add(lodParams, 'enabled')
      .name('Frustum LOD')
      .onChange((value: boolean) => {
        if (value) {
          savedVisible = {
            dual: dualMaterial.visible,
            ico: icosahedronMaterial.visible,
            graphLines: graphLinesMaterial.visible,
            motionVec: motionVecLinesMaterial.visible,
            neighborTiles: neighborTilesLinesMaterial.visible,
          };
          dualMaterial.visible = false;
          icosahedronMaterial.visible = false;
          graphLinesMaterial.visible = false;
          motionVecLinesMaterial.visible = false;
          neighborTilesLinesMaterial.visible = false;
        } else {
          dualMaterial.visible = savedVisible.dual;
          icosahedronMaterial.visible = savedVisible.ico;
          graphLinesMaterial.visible = savedVisible.graphLines;
          motionVecLinesMaterial.visible = savedVisible.motionVec;
          neighborTilesLinesMaterial.visible = savedVisible.neighborTiles;
        }
        lodRenderer.setEnabled(value);
      });

    // Screen-space error slider (lower = more detail)
    const errorParams = { error: lodRenderer.getTargetScreenSpaceError() };
    lodGui
      .add(errorParams, 'error', 8, 256)
      .step(8)
      .name('Screen Error')
      .onChange((value: number) => lodRenderer.setTargetScreenSpaceError(value));

    lodGui.open();
  }

  /**
   * Updates the net rotation display from the tectonic manager.
   */
  private updateNetRotationDisplay(): void {
    const netRotation = this.tectonicManager.getNetRotation();
    this.netRotationParams.x = netRotation.x;
    this.netRotationParams.y = netRotation.y;
    this.netRotationParams.z = netRotation.z;
    this.netRotationParams.magnitude = netRotation.length();
  }

  /**
   * Disposes of the GUI.
   */
  public dispose(): void {
    this.gui.destroy();
  }

  /**
   * Gets the GUI instance.
   */
  public getGUI(): GUI {
    return this.gui;
  }
}
