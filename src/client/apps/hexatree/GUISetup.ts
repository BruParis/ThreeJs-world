import { GUI } from 'dat.gui';
import { HexaCell, decodeIcoTreePath, parseIcoTreePathString } from '../../core/iconet';
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
    this.setupIcoTreeEncodingFolder();
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
   * Sets up the IcoTree Encoding folder for triangle-based coordinate encoding.
   */
  private setupIcoTreeEncodingFolder(): void {
    const encodingFolder = this.gui.addFolder('IcoTree Encoding');

    const encodingState = {
      pathString: '0:123',
      compute: () => this.computeIcoTreeEncoding(encodingState),
      clear: () => this.mapRenderer.displayIcoTreeEncoding(null),
    };

    // Path input in format "rootId:path"
    encodingFolder
      .add(encodingState, 'pathString')
      .name('Path (rootId:codes)');

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
   * Computes and displays the IcoTree encoding.
   */
  private computeIcoTreeEncoding(state: { pathString: string }): void {
    const { pathString } = state;

    // Parse the path string
    let rootId: number;
    let path: number[];
    try {
      const parsed = parseIcoTreePathString(pathString);
      rootId = parsed.rootId;
      path = parsed.path;
    } catch (e) {
      console.error('Invalid path string:', e);
      return;
    }

    // Find the root triangle
    const rootTriangle = this.mapRenderer.triangles[rootId];
    if (!rootTriangle) {
      console.error(`Root triangle with ID ${rootId} not found`);
      return;
    }

    if (path.length === 0) {
      console.log('Empty path - showing root triangle only');
      this.mapRenderer.displayIcoTreeEncoding(null);
      return;
    }

    // Decode the path
    try {
      const result = decodeIcoTreePath(rootTriangle, path);

      console.log('IcoTree Decode Result:', {
        rootTriangleId: rootId,
        levels: result.levels.length,
        finalCentroid: result.levels[result.levels.length - 1].centroid,
        finalOrientation: result.levels[result.levels.length - 1].isUpPointing ? 'up' : 'down',
      });

      this.mapRenderer.displayIcoTreeEncoding(result);
    } catch (e) {
      console.error('Error decoding IcoTree path:', e);
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
