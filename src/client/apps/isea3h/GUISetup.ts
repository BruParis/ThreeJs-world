import { GUI } from 'dat.gui';
import { OctahedronRenderer, GUIParams } from './OctahedronRenderer';
import { InteractionHandler } from './InteractionHandler';
import {
  ISEA3HCell,
  computeISEA3HCell,
  getParentCell,
  getCentralCellForParent,
  formatCell,
  isCentralChild,
} from './ISEA3HEncoding';

/**
 * Sets up the dat.GUI interface for the ISEA3H application.
 */
export class GUISetup {
  private gui: GUI;
  private octahedronRenderer: OctahedronRenderer;
  private interactionHandler: InteractionHandler | null;

  // Current cell state for go-up functionality
  private currentCell: ISEA3HCell | null = null;

  // Mode state
  private hoverMode: boolean = true;
  private hoverFolder: GUI | null = null;
  private encodingFolder: GUI | null = null;

  constructor(
    contentArea: HTMLElement,
    octahedronRenderer: OctahedronRenderer,
    params: GUIParams,
    interactionHandler: InteractionHandler | null = null
  ) {
    this.gui = new GUI({ autoPlace: false });
    this.octahedronRenderer = octahedronRenderer;
    this.interactionHandler = interactionHandler;
    contentArea.appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0';
    this.gui.domElement.style.right = '0';

    // View folder
    const viewFolder = this.gui.addFolder('View');
    viewFolder
      .add(params, 'sphereMode')
      .name('Sphere Mode')
      .onChange((value: boolean) => {
        octahedronRenderer.updateSphereMode(value);
        // Refresh cell display if there's a current cell
        this.refreshCellDisplay();
      });
    viewFolder
      .add(params, 'showFaces')
      .name('Show Faces')
      .onChange((value: boolean) => {
        octahedronRenderer.setVisibility('faces', value);
      });
    viewFolder
      .add(params, 'showWireframe')
      .name('Show Wireframe')
      .onChange((value: boolean) => {
        octahedronRenderer.setVisibility('wireframe', value);
      });
    viewFolder
      .add(params, 'showVertices')
      .name('Show Vertices')
      .onChange((value: boolean) => {
        octahedronRenderer.setVisibility('vertices', value);
      });
    viewFolder.open();

    // Info folder
    const infoFolder = this.gui.addFolder('Info');
    const info = {
      vertices: octahedronRenderer.vertices.length,
      faces: octahedronRenderer.faces.length,
    };
    infoFolder.add(info, 'vertices').name('Vertices').listen();
    infoFolder.add(info, 'faces').name('Faces').listen();
    infoFolder.open();

    // Mode selection folder
    this.setupModeFolder();

    // Hover settings folder (initially visible)
    this.setupHoverSettingsFolder();

    // ISEA3H Encoding folder (initially hidden)
    this.setupISEA3HEncodingFolder();

    // Apply initial mode
    this.updateModeVisibility();

    // Hide initially
    this.gui.domElement.style.display = 'none';
  }

  /**
   * Sets up the Mode selection folder.
   */
  private setupModeFolder(): void {
    const modeFolder = this.gui.addFolder('Mode');

    const modeState = {
      hoverMode: this.hoverMode,
    };

    modeFolder
      .add(modeState, 'hoverMode')
      .name('Hover Mode')
      .onChange((value: boolean) => {
        this.hoverMode = value;
        this.updateModeVisibility();
      });

    modeFolder.open();
  }

  /**
   * Updates visibility of hover and encoding folders based on mode.
   */
  private updateModeVisibility(): void {
    if (this.hoverMode) {
      // Enable hover mode
      this.interactionHandler?.activate();
      this.octahedronRenderer.clearCellDisplay();

      // Show hover folder, hide encoding folder
      if (this.hoverFolder) {
        this.hoverFolder.domElement.style.display = '';
        this.hoverFolder.open();
      }
      if (this.encodingFolder) {
        this.encodingFolder.domElement.style.display = 'none';
        this.encodingFolder.close();
      }
    } else {
      // Enable encoding mode
      this.interactionHandler?.deactivate();
      this.octahedronRenderer.clearHoverDisplay();

      // Hide hover folder, show encoding folder
      if (this.hoverFolder) {
        this.hoverFolder.domElement.style.display = 'none';
        this.hoverFolder.close();
      }
      if (this.encodingFolder) {
        this.encodingFolder.domElement.style.display = '';
        this.encodingFolder.open();
      }
    }
  }

  /**
   * Sets up the Hover settings folder.
   */
  private setupHoverSettingsFolder(): void {
    this.hoverFolder = this.gui.addFolder('Hover Settings');

    if (!this.interactionHandler) {
      this.hoverFolder.domElement.style.display = 'none';
      return;
    }

    const hoverState = {
      resolutionLevel: this.interactionHandler.getResolutionLevel(),
    };

    this.hoverFolder
      .add(hoverState, 'resolutionLevel', 1, 6, 1)
      .name('Resolution Level')
      .onChange((value: number) => {
        this.interactionHandler?.setResolutionLevel(value);
      });

    this.hoverFolder.open();
  }

  /**
   * Sets up the ISEA3H Encoding folder for cell coordinate encoding.
   */
  private setupISEA3HEncodingFolder(): void {
    this.encodingFolder = this.gui.addFolder('ISEA3H Encoding');

    const encodingState = {
      n: 1,
      abc: '1, 1, 1',  // Single text input for a, b, c
      // Display fields (read-only)
      status: '',
      cellType: '',
      neighborCount: 0,
      isCentral: '',
      parentInfo: '',
      // Actions
      compute: () => this.computeAndDisplayCell(encodingState),
      goUpLevel: () => this.goUpLevel(encodingState),
      clear: () => this.clearCellDisplay(),
    };

    // Input controls
    this.encodingFolder.add(encodingState, 'n', 1, 6, 1).name('Level (n)');
    this.encodingFolder.add(encodingState, 'abc').name('a, b, c');

    // Action buttons
    this.encodingFolder.add(encodingState, 'compute').name('Compute & Display');
    this.encodingFolder.add(encodingState, 'goUpLevel').name('Go Up Level');
    this.encodingFolder.add(encodingState, 'clear').name('Clear');

    // Status display (read-only)
    const statusFolder = this.encodingFolder.addFolder('Status');
    statusFolder.add(encodingState, 'status').name('Validation').listen();
    statusFolder.add(encodingState, 'cellType').name('Cell Type').listen();
    statusFolder.add(encodingState, 'neighborCount').name('Neighbors').listen();
    statusFolder.add(encodingState, 'isCentral').name('Is Central').listen();
    statusFolder.add(encodingState, 'parentInfo').name('Parent').listen();
    statusFolder.open();

    // Initially closed (will be shown when encoding mode is enabled)
    this.encodingFolder.close();
  }

  /**
   * Parses the a,b,c string into three integers.
   * Accepts formats like "1,1,1" or "1, 1, 1" or "1 1 1".
   */
  private parseABC(abcString: string): { a: number; b: number; c: number } | null {
    // Split by comma, space, or both
    const parts = abcString.split(/[\s,]+/).filter(s => s.length > 0);

    if (parts.length !== 3) {
      return null;
    }

    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    const c = parseInt(parts[2], 10);

    if (isNaN(a) || isNaN(b) || isNaN(c)) {
      return null;
    }

    return { a, b, c };
  }

  // Colors for different hierarchy levels (from child to parent)
  private static readonly LEVEL_COLORS = [
    0x00ff00,  // Level 0 (current cell) - green
    0xffff00,  // Level 1 - yellow
    0xff8800,  // Level 2 - orange
    0xff0088,  // Level 3 - pink
    0x8800ff,  // Level 4 - purple
    0x0088ff,  // Level 5 - blue
    0x00ffff,  // Level 6 - cyan
  ];

  /**
   * Computes and displays the cell based on current encoding state.
   * Also displays the full hierarchy of enclosing hexagons up to level 0.
   */
  private computeAndDisplayCell(state: {
    n: number;
    abc: string;
    status: string;
    cellType: string;
    neighborCount: number;
    isCentral: string;
    parentInfo: string;
  }): void {
    // Parse the abc string
    const coords = this.parseABC(state.abc);
    if (!coords) {
      state.status = 'Invalid format: use "a, b, c"';
      return;
    }

    const cell: ISEA3HCell = {
      n: Math.round(state.n),
      a: coords.a,
      b: coords.b,
      c: coords.c,
    };

    const result = computeISEA3HCell(cell);

    // Update status fields
    state.status = result.isValid ? 'Valid' : result.validationMessage;
    state.cellType = result.isSquareCell ? 'Square (4 sides)' : 'Hexagon (6 sides)';
    state.neighborCount = result.neighbors.length;
    state.isCentral = isCentralChild(cell) ? 'Yes' : 'No';

    // Compute parent info (level 1 is minimum displayable level)
    const parent = getParentCell(cell);
    if (parent && parent.n >= 1) {
      state.parentInfo = formatCell(parent);
    } else if (cell.n <= 1) {
      state.parentInfo = 'Minimum level';
    } else {
      const centralForParent = getCentralCellForParent(cell);
      state.parentInfo = `Via ${formatCell(centralForParent)}`;
    }

    if (!result.isValid) {
      console.error('Invalid cell:', result.validationMessage);
      return;
    }

    // Store current cell for go-up functionality
    this.currentCell = cell;

    // Display the cell
    this.octahedronRenderer.displayCell(result);

    // Display the full hierarchy of enclosing hexagons up to level 0
    this.displayHierarchy(cell);

    console.log('ISEA3H Cell:', {
      cell: formatCell(cell),
      barycenter: result.barycenter,
      isSquare: result.isSquareCell,
      neighbors: result.neighbors.map(n => formatCell(n)),
      isCentral: isCentralChild(cell),
    });
  }

  /**
   * Displays the hierarchy of enclosing hexagons from the given cell up to level 1.
   */
  private displayHierarchy(startCell: ISEA3HCell): void {
    let currentCell = startCell;
    let levelIndex = 1; // Start at 1 since the main cell is already displayed

    while (currentCell.n > 1) {
      // Get the central cell if not already central (Rule 6)
      let cellForParent = currentCell;
      if (!isCentralChild(currentCell)) {
        cellForParent = getCentralCellForParent(currentCell);
      }

      // Get parent
      const parentCell = getParentCell(cellForParent);
      if (!parentCell) {
        break;
      }

      // Compute and display the parent cell
      const parentResult = computeISEA3HCell(parentCell);
      if (parentResult.isValid) {
        const color = GUISetup.LEVEL_COLORS[levelIndex % GUISetup.LEVEL_COLORS.length];
        this.octahedronRenderer.displayParentCell(parentResult, color);
      }

      // Move up to the parent for the next iteration
      currentCell = parentCell;
      levelIndex++;
    }
  }

  /**
   * Goes up one level in the hierarchy.
   */
  private goUpLevel(state: {
    n: number;
    abc: string;
    status: string;
    cellType: string;
    neighborCount: number;
    isCentral: string;
    parentInfo: string;
  }): void {
    if (!this.currentCell || this.currentCell.n <= 1) {
      state.status = 'Cannot go up: at minimum level';
      return;
    }

    // Get the central cell for going up (Rule 6)
    let cellToUse = this.currentCell;
    if (!isCentralChild(this.currentCell)) {
      console.log("NOT a central child, using central neighbor for parent:", formatCell(this.currentCell));
      cellToUse = getCentralCellForParent(this.currentCell);
      console.log('Using central neighbor:', formatCell(cellToUse));
    }

    // Get parent
    console.log("is a central child, using current");
    const parent = getParentCell(cellToUse);
    if (!parent) {
      state.status = 'Cannot compute parent';
      return;
    }

    // Display parent cell
    const parentResult = computeISEA3HCell(parent);
    this.octahedronRenderer.displayParentCell(parentResult);

    // Update state to show parent
    state.n = parent.n;
    state.abc = `${parent.a}, ${parent.b}, ${parent.c}`;
    this.currentCell = parent;

    // Update status display
    state.status = 'Valid (parent level)';
    state.cellType = parentResult.isSquareCell ? 'Square (4 sides)' : 'Hexagon (6 sides)';
    state.neighborCount = parentResult.neighbors.length;
    state.isCentral = isCentralChild(parent) ? 'Yes' : 'No';

    const grandParent = getParentCell(parent);
    if (grandParent && grandParent.n >= 1) {
      state.parentInfo = formatCell(grandParent);
    } else if (parent.n <= 1) {
      state.parentInfo = 'Minimum level';
    } else {
      const centralForParent = getCentralCellForParent(parent);
      state.parentInfo = `Via ${formatCell(centralForParent)}`;
    }

    console.log('Went up to parent level:', formatCell(parent));
  }

  /**
   * Clears the cell display.
   */
  private clearCellDisplay(): void {
    this.octahedronRenderer.clearCellDisplay();
    this.currentCell = null;
  }

  /**
   * Refreshes the cell display (e.g., when switching between octahedron and sphere mode).
   */
  private refreshCellDisplay(): void {
    if (this.currentCell) {
      const result = computeISEA3HCell(this.currentCell);
      if (result.isValid) {
        this.octahedronRenderer.displayCell(result);
      }
    }
  }

  /**
   * Shows the GUI.
   */
  show(): void {
    this.gui.domElement.style.display = '';
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
