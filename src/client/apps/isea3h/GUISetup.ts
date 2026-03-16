import { GUI } from 'dat.gui';
import { OctahedronRenderer, GUIParams } from './OctahedronRenderer';
import { InteractionHandler } from './InteractionHandler';
import { ProjectionMode } from './ISEA3HSnyderProjection';
import {
  ISEA3HCell,
  computeISEA3HCell,
  computeDisplayHierarchy,
  getParentCell,
  getCentralCellForParent,
  getCentralChild,
  getNeighbors,
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
        // Clear hover display and refresh cell display
        octahedronRenderer.clearHoverDisplay();
        this.refreshCellDisplay();
      });

    // Projection mode dropdown
    const projectionModeState = { projectionMode: params.projectionMode };
    viewFolder
      .add(projectionModeState, 'projectionMode', ['snyder', 'normalization'] as ProjectionMode[])
      .name('Projection')
      .onChange((value: ProjectionMode) => {
        params.projectionMode = value;
        octahedronRenderer.updateProjectionMode(value);
        // Clear hover display and refresh cell display
        octahedronRenderer.clearHoverDisplay();
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

    // Info folder
    const infoFolder = this.gui.addFolder('Info');
    const info = {
      vertices: octahedronRenderer.vertices.length,
      faces: octahedronRenderer.faces.length,
    };
    infoFolder.add(info, 'vertices').name('Vertices').listen();
    infoFolder.add(info, 'faces').name('Faces').listen();

    // Mode selection folder
    this.setupModeFolder();

    // Hover settings folder (initially visible)
    this.setupHoverSettingsFolder();

    // ISEA3H Encoding folder (initially hidden)
    this.setupISEA3HEncodingFolder();

    // Debug folder
    this.setupDebugFolder();

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
      .add(hoverState, 'resolutionLevel', 1, 9, 1)
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
    this.encodingFolder.add(encodingState, 'n', 1, 9, 1).name('Level (n)');
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
   * Sets up the Debug folder for projection visualization.
   */
  private setupDebugFolder(): void {
    const debugFolder = this.gui.addFolder('Debug');

    const debugState = {
      showProjectionDebug: false,
      projectionSubdivisions: 10,
    };

    debugFolder
      .add(debugState, 'showProjectionDebug')
      .name('Projection Debug')
      .onChange((value: boolean) => {
        if (value) {
          this.octahedronRenderer.displayProjectionDebug(debugState.projectionSubdivisions);
        } else {
          this.octahedronRenderer.clearProjectionDebug();
        }
      });

    debugFolder
      .add(debugState, 'projectionSubdivisions', 2, 30, 1)
      .name('Subdivisions')
      .onChange((value: number) => {
        if (debugState.showProjectionDebug) {
          this.octahedronRenderer.displayProjectionDebug(value);
        }
      });

    debugFolder.open();
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

  // Dimmer colors for alternative (non-enclosing) parent cells
  private static readonly ALTERNATIVE_COLORS = [
    0x006600,  // Level 0 - dim green
    0x666600,  // Level 1 - dim yellow
    0x664400,  // Level 2 - dim orange
    0x660044,  // Level 3 - dim pink
    0x440066,  // Level 4 - dim purple
    0x004466,  // Level 5 - dim blue
    0x006666,  // Level 6 - dim cyan
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

    // Get neighbor count from central child's neighbors
    console.log("cell: ", formatCell(cell));
    const centralChild = getCentralChild(cell);
    console.log("central child:", formatCell(centralChild));
    const centralChildNeighbors = getNeighbors(centralChild);
    for (const neighbor of centralChildNeighbors) {
      console.log('   central child Neighbor:', formatCell(neighbor));
    }

    state.neighborCount = centralChildNeighbors.length;
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

    // Compute and display the full hierarchy
    const displayHierarchy = computeDisplayHierarchy(cell);

    // Display the main cell (first in hierarchy)
    if (displayHierarchy.levels.length > 0) {
      this.octahedronRenderer.displayCell(displayHierarchy.levels[0]);
    }

    // First pass: display alternative cells (so they render behind selected cells)
    for (let i = 1; i < displayHierarchy.levels.length; i++) {
      const level = displayHierarchy.levels[i];
      if (level.alternativeCells) {
        const altColor = GUISetup.ALTERNATIVE_COLORS[i % GUISetup.ALTERNATIVE_COLORS.length];
        for (const altCell of level.alternativeCells) {
          this.octahedronRenderer.displayParentCell(altCell, altColor);
        }
      }
    }

    // Second pass: display selected parent cells (so they render on top)
    for (let i = 1; i < displayHierarchy.levels.length; i++) {
      const level = displayHierarchy.levels[i];
      const color = GUISetup.LEVEL_COLORS[i % GUISetup.LEVEL_COLORS.length];
      this.octahedronRenderer.displayParentCell(level, color);
    }

    console.log('ISEA3H Cell:', {
      cell: formatCell(cell),
      barycenter: result.barycenter,
      isSquare: result.isSquareCell,
      centralChildNeighborCount: centralChildNeighbors.length,
      isCentral: isCentralChild(cell),
    });
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

    // Compute display hierarchy for parent
    const displayHierarchy = computeDisplayHierarchy(parent);
    if (displayHierarchy.levels.length === 0) {
      state.status = 'Cannot display parent';
      return;
    }

    // Display parent cell
    this.octahedronRenderer.clearCellDisplay();
    this.octahedronRenderer.displayCell(displayHierarchy.levels[0]);

    // First pass: display alternative cells (so they render behind selected cells)
    for (let i = 1; i < displayHierarchy.levels.length; i++) {
      const level = displayHierarchy.levels[i];
      if (level.alternativeCells) {
        const altColor = GUISetup.ALTERNATIVE_COLORS[i % GUISetup.ALTERNATIVE_COLORS.length];
        for (const altCell of level.alternativeCells) {
          this.octahedronRenderer.displayParentCell(altCell, altColor);
        }
      }
    }

    // Second pass: display selected parent cells (so they render on top)
    for (let i = 1; i < displayHierarchy.levels.length; i++) {
      const level = displayHierarchy.levels[i];
      const color = GUISetup.LEVEL_COLORS[i % GUISetup.LEVEL_COLORS.length];
      this.octahedronRenderer.displayParentCell(level, color);
    }

    // Update state to show parent
    state.n = parent.n;
    state.abc = `${parent.a}, ${parent.b}, ${parent.c}`;
    this.currentCell = parent;

    // Update status display
    const parentResult = computeISEA3HCell(parent);
    state.status = 'Valid (parent level)';
    state.cellType = parentResult.isSquareCell ? 'Square (4 sides)' : 'Hexagon (6 sides)';

    // Get neighbor count from central child's neighbors
    const centralChild = getCentralChild(parent);
    const centralChildNeighbors = getNeighbors(centralChild);
    state.neighborCount = centralChildNeighbors.length;
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
        // Compute display hierarchy and redisplay
        const displayHierarchy = computeDisplayHierarchy(this.currentCell);
        if (displayHierarchy.levels.length > 0) {
          this.octahedronRenderer.clearCellDisplay();
          this.octahedronRenderer.displayCell(displayHierarchy.levels[0]);

          // First pass: display alternative cells (so they render behind selected cells)
          for (let i = 1; i < displayHierarchy.levels.length; i++) {
            const level = displayHierarchy.levels[i];
            if (level.alternativeCells) {
              const altColor = GUISetup.ALTERNATIVE_COLORS[i % GUISetup.ALTERNATIVE_COLORS.length];
              for (const altCell of level.alternativeCells) {
                this.octahedronRenderer.displayParentCell(altCell, altColor);
              }
            }
          }

          // Second pass: display selected parent cells (so they render on top)
          for (let i = 1; i < displayHierarchy.levels.length; i++) {
            const level = displayHierarchy.levels[i];
            const color = GUISetup.LEVEL_COLORS[i % GUISetup.LEVEL_COLORS.length];
            this.octahedronRenderer.displayParentCell(level, color);
          }
        }
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
