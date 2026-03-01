import { GUI } from 'dat.gui';
import { HexaCell, decodeHexaTreePath, parsePathString } from '../../core/iconet';
import { MapRenderer, ViewParams } from './MapRenderer';
import { InteractionHandler } from './InteractionHandler';

export interface GUIParams extends ViewParams {}

/**
 * Sets up and manages the dat.GUI interface.
 */
export class GUISetup {
  private gui: GUI;

  constructor(
    contentArea: HTMLElement,
    private mapRenderer: MapRenderer,
    private interactionHandler: InteractionHandler,
    private params: GUIParams
  ) {
    this.gui = new GUI({ autoPlace: false });
    contentArea.appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0';
    this.gui.domElement.style.right = '0';

    this.setupViewFolder();
    this.setupInfoFolder();
    this.setupHexagonSelectionFolder();
    this.setupHexaTreeEncodingFolder();
    this.setupHoverInfoFolder();
  }

  /**
   * Sets up the View folder with visibility toggles.
   */
  private setupViewFolder(): void {
    const viewFolder = this.gui.addFolder('View');

    viewFolder
      .add(this.params, 'showFaces')
      .name('Show Faces')
      .onChange((value: boolean) => {
        this.mapRenderer.setVisibility('showFaces', value);
      });

    viewFolder
      .add(this.params, 'showWireframe')
      .name('Show Wireframe')
      .onChange((value: boolean) => {
        this.mapRenderer.setVisibility('showWireframe', value);
      });

    viewFolder
      .add(this.params, 'showVertices')
      .name('Show Vertices')
      .onChange((value: boolean) => {
        this.mapRenderer.setVisibility('showVertices', value);
      });

    viewFolder
      .add(this.params, 'showHexagons')
      .name('Show Hexagons')
      .onChange((value: boolean) => {
        this.mapRenderer.setVisibility('showHexagons', value);
      });

    viewFolder.open();
  }

  /**
   * Sets up the Info folder with geometry statistics.
   */
  private setupInfoFolder(): void {
    const { geometry, subdivision } = this.mapRenderer;
    const infoFolder = this.gui.addFolder('Info');

    infoFolder.add({ vertices: geometry?.vertexCount ?? 0 }, 'vertices').name('Vertices');
    infoFolder.add({ faces: geometry?.faceCount ?? 0 }, 'faces').name('Faces');

    const completeCount = subdivision?.hexaCells.filter((c: HexaCell) => c.isComplete).length ?? 0;
    const incompleteCount = subdivision?.hexaCells.filter((c: HexaCell) => !c.isComplete).length ?? 0;

    infoFolder.add({ hexagons: subdivision?.hexaCells.length ?? 0 }, 'hexagons').name('Total Hexagons');
    infoFolder.add({ complete: completeCount }, 'complete').name('Complete');
    infoFolder.add({ incomplete: incompleteCount }, 'incomplete').name('Incomplete');
  }

  /**
   * Sets up the Hexagon Selection folder with hexagon ID input.
   */
  private setupHexagonSelectionFolder(): void {
    const selectionFolder = this.gui.addFolder('Hexagon Selection');
    const selectionState = { hexagonId: -1 };

    selectionFolder
      .add(selectionState, 'hexagonId', -1, (this.mapRenderer.subdivision?.hexaCells.length ?? 1) - 1, 1)
      .name('Select by ID')
      .onChange((value: number) => {
        const id = Math.round(value);
        if (id < 0) {
          this.mapRenderer.selectHexagon(null);
          return;
        }

        const cell = this.mapRenderer.subdivision?.hexaCells.find((c: HexaCell) => c.id === id);
        if (cell) {
          this.mapRenderer.selectHexagon(cell);
        } else {
          this.mapRenderer.selectHexagon(null);
        }
      });

    selectionFolder.open();
  }

  /**
   * Sets up the HexaTree Encoding folder for coordinate conversion.
   */
  private setupHexaTreeEncodingFolder(): void {
    const encodingFolder = this.gui.addFolder('HexaTree Encoding');

    const encodingState = {
      rootHexagonId: 0,
      pathString: '0,1,2',
      compute: () => this.computeHexaTreeEncoding(encodingState),
      clear: () => this.mapRenderer.displayHexaTreeEncoding(null),
    };

    // Root hexagon selector
    const maxId = (this.mapRenderer.subdivision?.hexaCells.length ?? 1) - 1;
    encodingFolder
      .add(encodingState, 'rootHexagonId', 0, maxId, 1)
      .name('Root Hexagon ID');

    // Path input
    encodingFolder
      .add(encodingState, 'pathString')
      .name('Path (0-3)');

    // Compute button
    encodingFolder
      .add(encodingState, 'compute')
      .name('Compute & Display');

    // Clear button
    encodingFolder
      .add(encodingState, 'clear')
      .name('Clear');

    encodingFolder.open();
  }

  /**
   * Computes and displays the HexaTree encoding.
   */
  private computeHexaTreeEncoding(state: { rootHexagonId: number; pathString: string }): void {
    const { rootHexagonId, pathString } = state;

    // Find the root hexagon
    const rootCell = this.mapRenderer.subdivision?.hexaCells.find(
      (c: HexaCell) => c.id === rootHexagonId
    );

    if (!rootCell) {
      console.error(`Root hexagon with ID ${rootHexagonId} not found`);
      return;
    }

    // Parse the path string
    let path: number[];
    try {
      path = parsePathString(pathString);
    } catch (e) {
      console.error('Invalid path string:', e);
      return;
    }

    // Get the root centroid and compute a reasonable side length
    // For complete hexagons, use the distance from center to a vertex
    // For incomplete hexagons, use a default based on triangle size
    const rootCentroid = rootCell.center;
    const rootSideLength = this.mapRenderer.geometry?.triangleSize ?? 1.0;

    // Decode the path
    try {
      const result = decodeHexaTreePath(rootCentroid, path, rootSideLength);

      console.log('HexaTree Decode Result:', {
        position: result.position,
        intermediateCoords: result.intermediateCoords,
        levels: result.parentCentroids.length,
      });

      // Display the result
      this.mapRenderer.displayHexaTreeEncoding(result);
    } catch (e) {
      console.error('Error decoding HexaTree path:', e);
    }
  }

  /**
   * Sets up the Hover Info folder with live data.
   */
  private setupHoverInfoFolder(): void {
    const hoverInfo = this.interactionHandler.hoverInfo;
    const hoverFolder = this.gui.addFolder('Hover Info');

    hoverFolder.add(hoverInfo, 'triangleId').name('Triangle ID').listen();
    hoverFolder.add(hoverInfo, 'hexagonId').name('Hexagon ID').listen();
    hoverFolder.add(hoverInfo, 'nearbyVertexId').name('Vertex ID').listen();
    hoverFolder.add(hoverInfo, 'latDisplay').name('Latitude').listen();
    hoverFolder.add(hoverInfo, 'lonDisplay').name('Longitude').listen();

    hoverFolder.open();
  }

  /**
   * Shows the GUI.
   */
  show(): void {
    this.gui.domElement.style.display = 'block';
  }

  /**
   * Hides the GUI.
   */
  hide(): void {
    this.gui.domElement.style.display = 'none';
  }

  /**
   * Disposes of the GUI.
   */
  dispose(): void {
    this.gui.destroy();
  }
}
