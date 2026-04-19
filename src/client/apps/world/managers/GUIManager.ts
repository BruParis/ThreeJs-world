import { Pane } from 'tweakpane';
import { VisualizationManager } from './VisualizationManager';
import { TectonicManager } from './TectonicManager';
import { NoiseManager } from './NoiseManager';
import { InteractionHandler, BoundaryDisplayMode } from '../handlers/InteractionHandler';
import { PlateDisplayMode, PLATE_VISUALIZATION_LEGEND, rgbToHex } from '../visualization/PlateColors';
import { GEOLOGY_TYPE_LEGEND, geologyTypeColorToHex } from '../visualization/GeologyColors';
import { LODTileRenderer } from '../lod/LODTileRenderer';
import { TileShaderPatchOperation, LODColorMode } from '../lod/TileShaderPatchOperation';
import { FlyCam } from '@core/FlyCam';

const MIN_DEGREE = 0;
const MAX_DEGREE = 7;

function debounce(fn: (...args: unknown[]) => void, ms: number): (...args: unknown[]) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Manages the Tweakpane interface and coordinates user input with other managers.
 */
export class GUIManager {
  private pane: Pane;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private noiseManager: NoiseManager;
  private interactionHandler: InteractionHandler;
  private onResetCallback: (degree: number) => void;
  private netRotationParams = { x: 0, y: 0, z: 0, magnitude: 0 };
  private lodRenderer: LODTileRenderer | null = null;
  private patchOperation: TileShaderPatchOperation | null = null;

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

    this.pane = new Pane({ title: 'Controls' });
    const contentArea = document.getElementById('content-area') || document.body;
    this.pane.element.style.position = 'absolute';
    this.pane.element.style.top      = '0';
    this.pane.element.style.right    = '0';
    this.pane.element.style.width    = '280px';
    contentArea.appendChild(this.pane.element);

    this.setupGUI();
  }

  private setupGUI(): void {
    const icoParams = this.visualizationManager.getIcoParams();
    const icosahedronMaterial = this.visualizationManager.getIcosahedronMaterial();
    const dualMaterial        = this.visualizationManager.getDualMaterial();
    const graphLinesMaterial  = this.visualizationManager.getGraphLinesMaterial();
    const motionVecLinesMaterial    = this.visualizationManager.getMotionVecLinesMaterial();
    const neighborTilesLinesMaterial = this.visualizationManager.getNeighborTilesLinesMaterial();

    // ── Top-level controls ────────────────────────────────────────────────────

    const degreeState = { degree: icoParams.degree };
    const onDegreeChange = debounce((value: unknown) => this.onResetCallback(value as number), 300);
    this.pane.addBinding(degreeState, 'degree', {
      label: 'Subdivision', min: MIN_DEGREE, max: MAX_DEGREE, step: 1,
    }).on('change', ({ value }) => onDegreeChange(value));

    const selectionState = { selectionMode: this.interactionHandler.getSelectionMode() };
    this.pane.addBinding(selectionState, 'selectionMode', { label: 'Selection' })
      .on('change', ({ value }) => this.interactionHandler.setSelectionMode(value));

    const colorModeState = { mode: LODColorMode.PLATE };
    this.pane.addBinding(colorModeState, 'mode', {
      label: 'Color Mode',
      options: {
        Plate:     LODColorMode.PLATE,
        Geology:   LODColorMode.GEOLOGY,
        Elevation: LODColorMode.ELEVATION,
        Terrain:   LODColorMode.TERRAIN,
      },
    }).on('change', ({ value }) => {
      const isGeology = value === LODColorMode.GEOLOGY;
      const isTerrain = value === LODColorMode.TERRAIN;
      this.tectonicManager.setGeologyDisplayEnabled(isGeology);
      // In terrain mode suppress the plate overlay (dual mesh is hidden anyway in LOD,
      // but keeping the state consistent avoids surprises when toggling modes).
      this.tectonicManager.setPlateDisplayMode(
        (isGeology || isTerrain) ? PlateDisplayMode.NONE : PlateDisplayMode.CATEGORY,
      );
      this.patchOperation?.setColorMode(value);
      this.lodRenderer?.invalidate();
    });

    // ── View ──────────────────────────────────────────────────────────────────

    const viewFolder = this.pane.addFolder({ title: 'View', expanded: false });
    viewFolder.addBinding(dualMaterial,        'visible',   { label: 'Dual Mesh'    });
    viewFolder.addBinding(dualMaterial,        'wireframe', { label: 'Wireframe'    });
    viewFolder.addBinding(icosahedronMaterial, 'visible',   { label: 'Icosahedron'  });
    viewFolder.addBinding(graphLinesMaterial,  'visible',   { label: 'Graph Lines'  })
      .on('change', ({ value }) => {
        if (value) this.visualizationManager.computeHalfedgeGraphLines();
      });
    viewFolder.addBinding(motionVecLinesMaterial, 'visible', { label: 'Motion Vectors' })
      .on('change', ({ value }) => {
        if (value) this.tectonicManager.computeMotionVecLines();
      });
    viewFolder.addBinding(neighborTilesLinesMaterial, 'visible', { label: 'Neighbor Tiles' });

    // ── Perlin Noise ──────────────────────────────────────────────────────────

    const noiseParams = { seed: 42, scale: 2.0, octaves: 4, persistence: 0.5, lacunarity: 2.0 };
    const noiseFolder = this.pane.addFolder({ title: 'Perlin Noise', expanded: false });

    const regenerateNoise = debounce(() => {
      this.noiseManager.generatePerlinNoise(
        noiseParams.seed,
        noiseParams.scale,
        noiseParams.octaves,
        noiseParams.persistence,
        noiseParams.lacunarity
      );
    }, 150);

    const noiseVisState    = { visible:  this.noiseManager.isNoiseDisplayEnabled() };
    const noiseGradState   = { gradient: this.noiseManager.isGradientDisplayEnabled() };
    noiseFolder.addBinding(noiseVisState,  'visible',  { label: 'Show'     })
      .on('change', ({ value }) => this.noiseManager.setNoiseDisplayEnabled(value));
    noiseFolder.addBinding(noiseGradState, 'gradient', { label: 'Gradient' })
      .on('change', ({ value }) => this.noiseManager.setGradientDisplayEnabled(value));
    noiseFolder.addBinding(noiseParams, 'seed',        { label: 'Seed',        min: 0,   max: 1000, step: 1    }).on('change', regenerateNoise);
    noiseFolder.addBinding(noiseParams, 'scale',       { label: 'Scale',       min: 0.5, max: 10.0, step: 0.1  }).on('change', regenerateNoise);
    noiseFolder.addBinding(noiseParams, 'octaves',     { label: 'Octaves',     min: 1,   max: 8,    step: 1    }).on('change', regenerateNoise);
    noiseFolder.addBinding(noiseParams, 'persistence', { label: 'Persist.',    min: 0.1, max: 1.0,  step: 0.05 }).on('change', regenerateNoise);
    noiseFolder.addBinding(noiseParams, 'lacunarity',  { label: 'Lacunar.',    min: 1.0, max: 4.0,  step: 0.1  }).on('change', regenerateNoise);

    // ── Tectonic ──────────────────────────────────────────────────────────────

    const tectonicFolder = this.pane.addFolder({ title: 'Tectonic', expanded: true });
    tectonicFolder.addButton({ title: 'Rebuild' }).on('click', () => {
      this.tectonicManager.rebuildTectonicPlates();
      this.updateNetRotationDisplay();
    });

    const boundaryState = { mode: this.interactionHandler.getBoundaryDisplayMode() };
    tectonicFolder.addBinding(boundaryState, 'mode', {
      label: 'Boundary',
      options: {
        'Raw':        BoundaryDisplayMode.RAW_TYPE,
        'Refined':    BoundaryDisplayMode.REFINED_TYPE,
        'Edge Order': BoundaryDisplayMode.EDGE_ORDER,
      },
    }).on('change', ({ value }) => {
      this.interactionHandler.setBoundaryDisplayMode(value as BoundaryDisplayMode);
      this.tectonicManager.refreshAllBoundariesDisplay(value as BoundaryDisplayMode);
      this.visualizationManager.refreshBoundaryDisplay(value as BoundaryDisplayMode);
    });

    const borderState = { showBorder: false };
    tectonicFolder.addBinding(borderState, 'showBorder', { label: 'Border Tiles' })
      .on('change', ({ value }) => {
        if (value) this.tectonicManager.showBorderTiles();
        else       this.tectonicManager.colorTectonicSystem(false);
      });

    const tectonicLegendFolder = tectonicFolder.addFolder({ title: 'Legend', expanded: false });
    for (const entry of PLATE_VISUALIZATION_LEGEND) {
      const colorObj = { color: rgbToHex(entry.color) };
      tectonicLegendFolder.addBinding(colorObj, 'color', { label: entry.label });
    }

    // ── Geology ───────────────────────────────────────────────────────────────

    const geologyFolder = this.pane.addFolder({ title: 'Geology', expanded: false });
    const orogenyState = { reset: this.tectonicManager.isRecomputeOrogenyMode() };
    geologyFolder.addBinding(orogenyState, 'reset', { label: 'Reset Orogeny' })
      .on('change', ({ value }) => this.tectonicManager.setRecomputeOrogenyMode(value));

    const geologyLegendFolder = geologyFolder.addFolder({ title: 'Legend', expanded: false });
    for (const entry of GEOLOGY_TYPE_LEGEND) {
      const colorObj = { color: geologyTypeColorToHex(entry.type) };
      geologyLegendFolder.addBinding(colorObj, 'color', { label: entry.label });
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    const statsFolder = this.pane.addFolder({ title: 'Stats', expanded: false });
    statsFolder.addBinding(icoParams,             'numVertices',  { label: 'Vertices',     readonly: true });
    statsFolder.addBinding(icoParams,             'numFaces',     { label: 'Primal Faces', readonly: true });
    statsFolder.addBinding(this.netRotationParams, 'magnitude',   { label: 'Net Rotation', readonly: true });

    const icoDualParams   = this.visualizationManager.getIcoDualParams();
    const faceDistFolder  = statsFolder.addFolder({ title: 'Face distribution', expanded: false });
    faceDistFolder.addBinding(icoDualParams, 'dualFaces',  { label: 'Dual Faces', readonly: true });
    faceDistFolder.addBinding(icoDualParams, 'pentagons',  { label: 'Pentagons',  readonly: true });
    faceDistFolder.addBinding(icoDualParams, 'hexagons',   { label: 'Hexagons',   readonly: true });
    faceDistFolder.addBinding(icoDualParams, 'heptagons',  { label: 'Heptagons',  readonly: true });
  }

  /**
   * Adds an "LOD View" folder to the pane.
   * Call once after constructing both the FlyCam and LODTileRenderer.
   */
  public setupLODFolder(
    flyCam: FlyCam,
    lodRenderer: LODTileRenderer,
    patchOperation: TileShaderPatchOperation,
    onFlyCamToggle: (enabled: boolean) => void
  ): void {
    this.lodRenderer   = lodRenderer;
    this.patchOperation = patchOperation;

    const lodFolder = this.pane.addFolder({ title: 'LOD View', expanded: true });

    const legacyMaterials = [
      this.visualizationManager.getDualMaterial(),
      this.visualizationManager.getIcosahedronMaterial(),
      this.visualizationManager.getGraphLinesMaterial(),
      this.visualizationManager.getTileLinesMaterial(),
      this.visualizationManager.getPlateLinesMaterial(),
      this.visualizationManager.getMotionVecLinesMaterial(),
      this.visualizationManager.getBoundaryLinesMaterial(),
      this.visualizationManager.getAllBoundariesLinesMaterial(),
      this.visualizationManager.getDominanceIndicatorsLinesMaterial(),
      this.visualizationManager.getTransformSlideLinesMaterial(),
      this.visualizationManager.getNeighborTilesLinesMaterial(),
      this.visualizationManager.getNoiseGradientLinesMaterial(),
    ];
    let savedVisible: boolean[] = legacyMaterials.map(m => m.visible);

    const flyParams = { enabled: flyCam.isEnabled() };
    lodFolder.addBinding(flyParams, 'enabled', { label: 'Fly Camera' })
      .on('change', ({ value }) => onFlyCamToggle(value));

    const lodParams = { enabled: lodRenderer.isEnabled() };
    lodFolder.addBinding(lodParams, 'enabled', { label: 'Frustum LOD' })
      .on('change', ({ value }) => {
        if (value) {
          savedVisible = legacyMaterials.map(m => m.visible);
          for (const m of legacyMaterials) m.visible = false;
        } else {
          legacyMaterials.forEach((m, i) => { m.visible = savedVisible[i]; });
        }
        lodRenderer.setEnabled(value);
      });

    const wireframeParams = { enabled: lodRenderer.isWireframe() };
    lodFolder.addBinding(wireframeParams, 'enabled', { label: 'Wireframe' })
      .on('change', ({ value }) => lodRenderer.setWireframe(value));

    const errorParams = { error: lodRenderer.getTargetScreenSpaceError() };
    lodFolder.addBinding(errorParams, 'error', {
      label: 'Screen Error', min: 8, max: 256, step: 8,
    }).on('change', ({ value }) => lodRenderer.setTargetScreenSpaceError(value));
  }

  /** Refreshes all read-only stat bindings from their source objects. */
  public refresh(): void {
    this.pane.refresh();
  }

  private updateNetRotationDisplay(): void {
    const netRotation = this.tectonicManager.getNetRotation();
    this.netRotationParams.x         = netRotation.x;
    this.netRotationParams.y         = netRotation.y;
    this.netRotationParams.z         = netRotation.z;
    this.netRotationParams.magnitude = netRotation.length();
  }

  public show(): void {
    this.pane.element.style.display = 'block';
  }

  public hide(): void {
    this.pane.element.style.display = 'none';
  }

  public dispose(): void {
    this.pane.dispose();
    this.pane.element.remove();
  }
}
