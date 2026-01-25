import { GUI } from 'dat.gui';
import { debounce } from 'lodash';
import { VisualizationManager } from './VisualizationManager';
import { TectonicManager } from './TectonicManager';
import { InteractionHandler } from '../handlers/InteractionHandler';

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

    // Icosahedron folder
    const icoGui = this.gui.addFolder('Icosahedron');
    icoGui.add(icosahedronMaterial, 'visible').name('Visible');
    icoGui.add(icosahedronMaterial, 'wireframe').name('Wireframe');
    icoGui.add(icosahedronMaterial, 'vertexColors').name('Vertex Colors').onChange(() => {
      icosahedronMaterial.needsUpdate = true;
    });
    icoGui.add(icoParams, 'numVertices').name('Num Vertices').listen();
    icoGui.add(icoParams, 'numFaces').name('Num Faces').listen();
    icoGui.add(icoParams, 'numHalfedges').name('Num Halfedges').listen();

    // Dual Graph folder
    const dualGui = this.gui.addFolder('Dual Graph');
    dualGui.add(graphLinesMaterial, 'visible').name('Visible');
    dualGui.add(icoDualParams, 'pentagons').name('Num Pentagons').listen();
    dualGui.add(icoDualParams, 'hexagons').name('Num Hexagons').listen();
    dualGui.add(icoDualParams, 'heptagons').name('Num Heptagons').listen();

    // Dual Mesh folder
    const dualMeshGui = this.gui.addFolder('Dual Mesh');
    dualMeshGui.add(dualMaterial, 'visible').name('Visible');
    dualMeshGui.add(dualMaterial, 'wireframe').name('Wireframe');
    dualMeshGui.open();

    // Tectonic Plates folder
    const tectonicGui = this.gui.addFolder("Tectonic Plates");
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
    tectonicGui.add(motionVecLinesMaterial, 'visible').name('Show Motion');
    tectonicGui.open();
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
