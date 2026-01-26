import { GUI } from 'dat.gui';
import { debounce } from 'lodash';
import { VisualizationManager } from './VisualizationManager';
import { TectonicManager } from './TectonicManager';
import { InteractionHandler, BoundaryDisplayMode } from '../handlers/InteractionHandler';
import { BOUNDARY_LEGEND, boundaryColorToHex } from '../visualization/BoundaryColors';
import { PLATE_CATEGORY_LEGEND, plateCategoryColorToHex, PlateDisplayMode } from '../visualization/PlateColors';

const MIN_DEGREE = 0;
const MAX_DEGREE = 6;

/**
 * Manages the dat.GUI interface and coordinates user input with other managers.
 */
export class GUIManager {
  private gui: GUI;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private interactionHandler: InteractionHandler;
  private onResetCallback: (degree: number) => void;

  constructor(
    visualizationManager: VisualizationManager,
    tectonicManager: TectonicManager,
    interactionHandler: InteractionHandler,
    onResetCallback: (degree: number) => void
  ) {
    this.visualizationManager = visualizationManager;
    this.tectonicManager = tectonicManager;
    this.interactionHandler = interactionHandler;
    this.onResetCallback = onResetCallback;

    this.gui = new GUI();
    this.setupGUI();
  }

  /**
   * Sets up all GUI folders and controls.
   */
  private setupGUI(): void {
    const icoParams = this.visualizationManager.getIcoParams();
    const icoDualParams = this.visualizationManager.getIcoDualParams();
    const icosahedronMaterial = this.visualizationManager.getIcosahedronMaterial();
    const dualMaterial = this.visualizationManager.getDualMaterial();
    const graphLinesMaterial = this.visualizationManager.getGraphLinesMaterial();
    const motionVecLinesMaterial = this.visualizationManager.getMotionVecLinesMaterial();

    // Subdivision degree control with debounce
    this.gui
      .add(icoParams, 'degree', MIN_DEGREE, MAX_DEGREE)
      .step(1)
      .name('Subdivision degree')
      .onChange(debounce((value: number) => this.onResetCallback(value), 300));

    // Selection mode control
    this.gui
      .add({ selectionMode: this.interactionHandler.getSelectionMode() }, 'selectionMode')
      .name('Selection Mode')
      .onChange((value: boolean) => {
        this.interactionHandler.setSelectionMode(value);
      });

    // Geometry folder (contains Icosahedron, Dual Graph, Dual Mesh)
    const geometryGui = this.gui.addFolder('Geometry');

    // Icosahedron subfolder
    const icoGui = geometryGui.addFolder('Icosahedron');
    icoGui.add(icosahedronMaterial, 'visible').name('Visible');
    icoGui.add(icosahedronMaterial, 'wireframe').name('Wireframe');
    icoGui.add(icosahedronMaterial, 'vertexColors').name('Vertex Colors').onChange(() => {
      icosahedronMaterial.needsUpdate = true;
    });
    icoGui.add(icoParams, 'numVertices').name('Num Vertices').listen();
    icoGui.add(icoParams, 'numFaces').name('Num Faces').listen();
    icoGui.add(icoParams, 'numHalfedges').name('Num Halfedges').listen();

    // Dual Graph subfolder
    const dualGui = geometryGui.addFolder('Dual Graph');
    dualGui.add(graphLinesMaterial, 'visible').name('Visible');
    dualGui.add(icoDualParams, 'pentagons').name('Num Pentagons').listen();
    dualGui.add(icoDualParams, 'hexagons').name('Num Hexagons').listen();
    dualGui.add(icoDualParams, 'heptagons').name('Num Heptagons').listen();

    // Dual Mesh subfolder
    const dualMeshGui = geometryGui.addFolder('Dual Mesh');
    dualMeshGui.add(dualMaterial, 'visible').name('Visible');
    dualMeshGui.add(dualMaterial, 'wireframe').name('Wireframe');
    dualMeshGui.open();

    // Tectonic Plates folder
    const tectonicGui = this.gui.addFolder("Tectonic");
    tectonicGui
      .add(
        {
          rebuild: () => {
            this.tectonicManager.rebuildTectonicPlates();
          }
        },
        'rebuild'
      )
      .name('Rebuild Plates');
    tectonicGui
      .add({ showBorderTiles: false }, 'showBorderTiles')
      .name('Show Border Tiles')
      .onChange((value: boolean) => {
        if (value) {
          this.tectonicManager.showBorderTiles();
        } else {
          this.tectonicManager.colorTectonicSystem(false);
        }
      });
    tectonicGui.add(motionVecLinesMaterial, 'visible').name('Show Motion');

    // Plate subfolder with category display
    const plateGui = tectonicGui.addFolder('Plate');

    // Add plate display mode selector
    plateGui
      .add(
        { plateDisplay: this.tectonicManager.getPlateDisplayMode() },
        'plateDisplay',
        {
          'None': PlateDisplayMode.NONE,
          'Category': PlateDisplayMode.CATEGORY
        }
      )
      .name('Display Mode')
      .onChange((value: PlateDisplayMode) => {
        this.tectonicManager.setPlateDisplayMode(value);
      });

    // Add plate category color legend
    const plateLegendColors: Record<string, number> = {};
    for (const entry of PLATE_CATEGORY_LEGEND) {
      plateLegendColors[entry.label] = plateCategoryColorToHex(entry.category);
    }

    for (const entry of PLATE_CATEGORY_LEGEND) {
      const controller = plateGui.addColor(plateLegendColors, entry.label);
      // Make the color read-only by resetting on change
      controller.onChange(() => {
        plateLegendColors[entry.label] = plateCategoryColorToHex(entry.category);
        controller.updateDisplay();
      });
    }

    plateGui.open();
    tectonicGui.open();

    // Boundary Display subfolder with legend
    const boundaryGui = tectonicGui.addFolder('Boundary');

    // Add boundary display mode selector
    boundaryGui
      .add(
        { boundaryDisplay: this.interactionHandler.getBoundaryDisplayMode() },
        'boundaryDisplay',
        {
          'Raw Type': BoundaryDisplayMode.RAW_TYPE,
          'Refined Type': BoundaryDisplayMode.REFINED_TYPE,
          'Iteration': BoundaryDisplayMode.ITERATION
        }
      )
      .name('Display Mode')
      .onChange((value: BoundaryDisplayMode) => {
        this.interactionHandler.setBoundaryDisplayMode(value);
        // Refresh the boundary display with the new mode
        this.visualizationManager.refreshBoundaryDisplay(value);
      });

    // Add color legend entries
    const legendColors: Record<string, number> = {};
    for (const entry of BOUNDARY_LEGEND) {
      legendColors[entry.label] = boundaryColorToHex(entry.type);
    }

    for (const entry of BOUNDARY_LEGEND) {
      const controller = boundaryGui.addColor(legendColors, entry.label);
      // Make the color read-only by resetting on change
      controller.onChange(() => {
        legendColors[entry.label] = boundaryColorToHex(entry.type);
        controller.updateDisplay();
      });
    }

    boundaryGui.open();
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
