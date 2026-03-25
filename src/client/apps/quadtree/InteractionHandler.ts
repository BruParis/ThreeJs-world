import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CubeRenderer } from './CubeRenderer';
import { SceneSetup } from './SceneSetup';
import {
  QuadTreeCell,
  CubeFace,
  computeDisplayHierarchy,
  formatCell,
  getGridSize,
} from './QuadTreeEncoding';
import { spherePointToCell, computeCellVertices } from './QuadTreeGeometry';
import { cubeToSphere } from '@core/geometry/EverettPraunMapping';

export type DisplayMode = 'hierarchy' | 'distance' | 'lod';

// Colors for quadtree levels (index = level number)
// Level 0 is the coarsest (full face), higher levels are finer subdivisions
const LEVEL_COLORS = [
  0xff0000,  // Level 0 - red (full face)
  0xff8800,  // Level 1 - orange
  0xffff00,  // Level 2 - yellow
  0x88ff00,  // Level 3 - lime
  0x00ff00,  // Level 4 - green
  0x00ff88,  // Level 5 - spring green
  0x00ffff,  // Level 6 - cyan
  0x0088ff,  // Level 7 - sky blue
  0x0000ff,  // Level 8 - blue
  0x8800ff,  // Level 9 - purple
  0xff00ff,  // Level 10 - magenta
];

/**
 * Handles mouse interaction for QuadTree cell hover detection.
 */
export class InteractionHandler {
  private sceneSetup: SceneSetup;
  private cubeRenderer: CubeRenderer;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private resolutionLevel: number = 3;
  private active: boolean = false;

  // Display mode: 'hierarchy' shows parent cells, 'distance' shows nearby cells
  private displayMode: DisplayMode = 'hierarchy';
  // Distance threshold for distance mode (arc length on sphere, euclidean on cube)
  private distanceThreshold: number = 0.15;

  // Hover label
  private hoverLabel: CSS2DObject | null = null;
  private labelDiv: HTMLDivElement | null = null;

  // Last hovered cell (to avoid redundant updates)
  private lastHoveredCell: QuadTreeCell | null = null;

  // Bound event handlers
  private boundOnMouseMove: (event: MouseEvent) => void;

  constructor(sceneSetup: SceneSetup, cubeRenderer: CubeRenderer) {
    this.sceneSetup = sceneSetup;
    this.cubeRenderer = cubeRenderer;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.boundOnMouseMove = this.onMouseMove.bind(this);

    // Create label element
    this.createLabel();
  }

  /**
   * Creates the hover label element.
   */
  private createLabel(): void {
    this.labelDiv = document.createElement('div');
    this.labelDiv.style.cssText = `
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre;
      pointer-events: none;
    `;

    this.hoverLabel = new CSS2DObject(this.labelDiv);
    this.hoverLabel.visible = false;
    this.sceneSetup.scene.add(this.hoverLabel);
  }

  /**
   * Activates the interaction handler.
   */
  activate(): void {
    if (this.active) return;
    this.active = true;

    const canvas = this.sceneSetup.renderer.domElement;
    canvas.addEventListener('mousemove', this.boundOnMouseMove);
  }

  /**
   * Deactivates the interaction handler.
   */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    const canvas = this.sceneSetup.renderer.domElement;
    canvas.removeEventListener('mousemove', this.boundOnMouseMove);

    this.clearHover();
  }

  /**
   * Gets the current resolution level.
   */
  getResolutionLevel(): number {
    return this.resolutionLevel;
  }

  /**
   * Sets the resolution level.
   */
  setResolutionLevel(level: number): void {
    this.resolutionLevel = Math.max(0, Math.min(10, Math.floor(level)));
    // Force refresh on next mouse move
    this.lastHoveredCell = null;
  }

  /**
   * Gets the current display mode.
   */
  getDisplayMode(): DisplayMode {
    return this.displayMode;
  }

  /**
   * Sets the display mode.
   */
  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.lastHoveredCell = null;
  }

  /**
   * Gets the distance threshold for distance mode.
   */
  getDistanceThreshold(): number {
    return this.distanceThreshold;
  }

  /**
   * Sets the distance threshold for distance mode.
   */
  setDistanceThreshold(distance: number): void {
    this.distanceThreshold = Math.max(0.01, distance);
    this.lastHoveredCell = null;
  }

  /**
   * Handles mouse move events.
   */
  private onMouseMove(event: MouseEvent): void {
    if (!this.active) return;

    const canvas = this.sceneSetup.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    // Calculate normalized device coordinates
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast
    this.raycaster.setFromCamera(this.mouse, this.sceneSetup.camera);

    // Get the appropriate mesh based on mode
    const mesh = this.cubeRenderer.isSphereMode()
      ? this.cubeRenderer.getSphereMesh()
      : this.cubeRenderer.getCubeMesh();

    if (!mesh) return;

    const intersects = this.raycaster.intersectObject(mesh);

    if (intersects.length > 0) {
      const hitPoint = intersects[0].point;
      this.handleHover(hitPoint);
    } else {
      this.clearHover();
    }
  }

  /**
   * Handles hover over a point on the surface.
   */
  private handleHover(point: THREE.Vector3): void {
    // Display hover point indicator
    this.cubeRenderer.displayHoverPoint(point);

    if (this.displayMode === 'hierarchy') {
      this.handleHierarchyMode(point);
    } else if (this.displayMode === 'distance') {
      this.handleDistanceMode(point);
    } else if (this.displayMode === 'lod') {
      this.handleLODMode(point);
    }
  }

  /**
   * Handles hierarchy display mode - shows parent cells up the quadtree.
   */
  private handleHierarchyMode(point: THREE.Vector3): void {
    // Convert the point to a sphere point (normalize if on cube)
    const spherePoint = point.clone().normalize();

    // Get the cell at the current resolution level
    const cell = spherePointToCell(spherePoint, this.resolutionLevel);

    if (!cell) {
      this.clearHover();
      return;
    }

    // Check if this is the same cell as before
    if (this.lastHoveredCell &&
        this.lastHoveredCell.face === cell.face &&
        this.lastHoveredCell.level === cell.level &&
        this.lastHoveredCell.x === cell.x &&
        this.lastHoveredCell.y === cell.y) {
      return; // Same cell, no update needed
    }

    this.lastHoveredCell = cell;

    // Clear previous display
    this.cubeRenderer.clearHoverDisplay();

    // Compute and display the hierarchy
    const hierarchy = computeDisplayHierarchy(cell);

    // Build label text
    let labelText = '';

    // Display cells from current level up to level 0
    for (let i = 0; i < hierarchy.levels.length; i++) {
      const levelInfo = hierarchy.levels[i];
      const currentCell = levelInfo.cell;
      // Use the actual quadtree level for coloring
      const color = LEVEL_COLORS[currentCell.level % LEVEL_COLORS.length];

      // Display the cell outline
      this.cubeRenderer.displayHoverCell(levelInfo, color);

      // Add to label text
      labelText += formatCell(currentCell) + '\n';

      // Display triangulated quadrants for this cell (except at the deepest level)
      if (i > 0) {
        // Calculate UV bounds for this cell
        const gridSize = getGridSize(currentCell.level);
        const u0 = -1 + (2 * currentCell.x) / gridSize;
        const u1 = -1 + (2 * (currentCell.x + 1)) / gridSize;
        const v0 = -1 + (2 * currentCell.y) / gridSize;
        const v1 = -1 + (2 * (currentCell.y + 1)) / gridSize;

        // Determine which quadrant contains the child cell
        // The child is at hierarchy.levels[i-1]
        const childCell = hierarchy.levels[i - 1].cell;
        // Child's position within parent: x % 2 and y % 2
        const childQuadrantX = childCell.x % 2; // 0 = left, 1 = right
        const childQuadrantY = childCell.y % 2; // 0 = bottom, 1 = top
        // Quadrant index: 0=BL, 1=BR, 2=TR, 3=TL
        const childQuadrant = childQuadrantY === 0
          ? childQuadrantX
          : (childQuadrantX === 0 ? 3 : 2);

        this.cubeRenderer.displayTriangulatedQuadrants(
          { u0, u1, v0, v1 },
          currentCell.face,
          childQuadrant,
          color
        );
      } else {
        // At the deepest level, triangulate all 4 quadrants
        const gridSize = getGridSize(currentCell.level);
        const u0 = -1 + (2 * currentCell.x) / gridSize;
        const u1 = -1 + (2 * (currentCell.x + 1)) / gridSize;
        const v0 = -1 + (2 * currentCell.y) / gridSize;
        const v1 = -1 + (2 * (currentCell.y + 1)) / gridSize;

        this.cubeRenderer.displayTriangulatedQuadrants(
          { u0, u1, v0, v1 },
          currentCell.face,
          -1, // -1 means triangulate all quadrants
          color
        );
      }
    }

    // Update label - offset to the left for readability
    if (this.labelDiv && this.hoverLabel) {
      this.labelDiv.textContent = labelText.trim();
      // Offset the label further to the left of the hover point
      const offset = new THREE.Vector3(-0.8, 0.2, 0);
      this.hoverLabel.position.copy(point).add(offset);
      this.hoverLabel.visible = true;
    }

  }

  /**
   * Handles distance display mode - shows cells within distance threshold and their hierarchy.
   */
  private handleDistanceMode(point: THREE.Vector3): void {
    // Clear previous display (always update in distance mode as we track position, not cell)
    this.cubeRenderer.clearHoverDisplay();
    this.lastHoveredCell = null;

    const isSphereMode = this.cubeRenderer.isSphereMode();
    const spherePoint = point.clone().normalize();

    // Find all cells within the distance threshold at the resolution level
    const nearbyCells = this.findCellsWithinDistance(
      spherePoint,
      this.resolutionLevel,
      this.distanceThreshold,
      isSphereMode
    );

    if (nearbyCells.length === 0) {
      if (this.labelDiv && this.hoverLabel) {
        this.labelDiv.textContent = 'No cells in range';
        const offset = new THREE.Vector3(-0.8, 0.2, 0);
        this.hoverLabel.position.copy(point).add(offset);
        this.hoverLabel.visible = true;
      }
      return;
    }

    // Build the merged hierarchy from all nearby cells
    // Map: level -> Map<cellKey, { cell, childQuadrants: Set<0|1|2|3> }>
    const hierarchyByLevel: Map<number, Map<string, { cell: QuadTreeCell; childQuadrants: Set<number> }>> = new Map();

    // Initialize with the leaf cells (resolution level)
    const leafLevel = this.resolutionLevel;
    hierarchyByLevel.set(leafLevel, new Map());
    for (const cell of nearbyCells) {
      const key = this.cellKey(cell);
      hierarchyByLevel.get(leafLevel)!.set(key, { cell, childQuadrants: new Set() });
    }

    // Build hierarchy going up from leaf level to level 0
    for (let level = leafLevel; level > 0; level--) {
      const currentLevelCells = hierarchyByLevel.get(level);
      if (!currentLevelCells) continue;

      const parentLevel = level - 1;
      if (!hierarchyByLevel.has(parentLevel)) {
        hierarchyByLevel.set(parentLevel, new Map());
      }
      const parentLevelCells = hierarchyByLevel.get(parentLevel)!;

      for (const [, { cell }] of currentLevelCells) {
        const parent = this.getParentCell(cell);
        if (!parent) continue;

        const parentKey = this.cellKey(parent);
        const childQuadrant = this.getQuadrantInParent(cell);

        if (!parentLevelCells.has(parentKey)) {
          parentLevelCells.set(parentKey, { cell: parent, childQuadrants: new Set() });
        }
        parentLevelCells.get(parentKey)!.childQuadrants.add(childQuadrant);
      }
    }

    // Display the hierarchy from leaf level up to level 0
    for (let level = leafLevel; level >= 0; level--) {
      const levelCells = hierarchyByLevel.get(level);
      if (!levelCells || levelCells.size === 0) continue;

      // Use the actual quadtree level for coloring
      const color = LEVEL_COLORS[level % LEVEL_COLORS.length];

      for (const [, { cell, childQuadrants }] of levelCells) {
        // Display the cell outline
        const displayInfo = { cell, isSelected: false };
        this.cubeRenderer.displayHoverCell(displayInfo, color);

        // Calculate UV bounds for this cell
        const gridSize = getGridSize(cell.level);
        const u0 = -1 + (2 * cell.x) / gridSize;
        const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
        const v0 = -1 + (2 * cell.y) / gridSize;
        const v1 = -1 + (2 * (cell.y + 1)) / gridSize;

        // Display triangulated quadrants, excluding those occupied by children
        if (childQuadrants.size === 0) {
          // Leaf cell: triangulate all 4 quadrants
          this.cubeRenderer.displayTriangulatedQuadrants(
            { u0, u1, v0, v1 },
            cell.face,
            -1, // all quadrants
            color
          );
        } else {
          // Parent cell: triangulate only unoccupied quadrants
          for (let q = 0; q < 4; q++) {
            if (!childQuadrants.has(q)) {
              this.displaySingleQuadrant({ u0, u1, v0, v1 }, cell.face, q, color);
            }
          }
        }
      }
    }

    // Update label
    if (this.labelDiv && this.hoverLabel) {
      const distanceStr = this.distanceThreshold.toFixed(2);
      const modeStr = isSphereMode ? 'arc' : 'cube';
      const levelCount = hierarchyByLevel.size;
      this.labelDiv.textContent = `Distance mode (${modeStr})\nThreshold: ${distanceStr}\nLeaf cells: ${nearbyCells.length}\nLevels: ${levelCount}`;
      const offset = new THREE.Vector3(-0.8, 0.2, 0);
      this.hoverLabel.position.copy(point).add(offset);
      this.hoverLabel.visible = true;
    }
  }

  /**
   * Handles LOD (Level of Detail) display mode.
   * Shows quadrants at varying resolution levels based on distance from the hovered point.
   * Closer areas get higher resolution, farther areas get lower resolution.
   */
  private handleLODMode(point: THREE.Vector3): void {
    // Clear previous display
    this.cubeRenderer.clearHoverDisplay();
    this.lastHoveredCell = null;

    const isSphereMode = this.cubeRenderer.isSphereMode();
    const spherePoint = point.clone().normalize();

    // Maximum level (highest detail at the center)
    const maxLevel = this.resolutionLevel;

    // Build LOD structure: for each level, determine which cells to display
    // A cell is displayed at level L if:
    // - It's within the distance threshold for level L
    // - Its children (at level L+1) are NOT all within the threshold for level L+1

    // Distance thresholds for each level (larger distance = lower detail)
    // These are based on the distanceThreshold setting, scaled per level
    const baseDistance = this.distanceThreshold;

    // Track which cells are displayed (to avoid showing both parent and children)
    const displayedCells: Set<string> = new Set();
    // Track cells that have children displayed (so we don't display them)
    const cellsWithChildrenDisplayed: Set<string> = new Set();

    // Process from finest level to coarsest
    for (let level = maxLevel; level >= 0; level--) {
      // Distance threshold for this level
      // Finer levels (higher number) have smaller thresholds
      const levelThreshold = baseDistance * Math.pow(2, maxLevel - level);

      const gridSize = getGridSize(level);
      const color = LEVEL_COLORS[level % LEVEL_COLORS.length];

      // Check all cells at this level across all faces
      for (let face = 0; face < 6; face++) {
        for (let x = 0; x < gridSize; x++) {
          for (let y = 0; y < gridSize; y++) {
            const cell: QuadTreeCell = { face: face as CubeFace, level, x, y };
            const cellKey = this.cellKey(cell);

            // Skip if this cell has children that are already displayed
            if (cellsWithChildrenDisplayed.has(cellKey)) continue;

            // Check if cell is within threshold
            if (!this.isCellWithinDistance(cell, spherePoint, levelThreshold, isSphereMode)) {
              continue;
            }

            // Check if we should display this cell or its children
            // At the finest level, always display
            if (level === maxLevel) {
              displayedCells.add(cellKey);
              this.displayLODCell(cell, color);
            } else {
              // Check if any children are displayed
              const children = this.getChildCells(cell);
              const anyChildDisplayed = children.some(child =>
                displayedCells.has(this.cellKey(child))
              );

              if (anyChildDisplayed) {
                // Mark this cell as having children displayed
                cellsWithChildrenDisplayed.add(cellKey);

                // Display only the quadrants that don't have children
                const childQuadrants = new Set<number>();
                for (const child of children) {
                  if (displayedCells.has(this.cellKey(child))) {
                    childQuadrants.add(this.getQuadrantInParent(child));
                  }
                }

                // Display cell outline
                const displayInfo = { cell, isSelected: false };
                this.cubeRenderer.displayHoverCell(displayInfo, color);

                // Display only unoccupied quadrants
                const cellGridSize = getGridSize(cell.level);
                const u0 = -1 + (2 * cell.x) / cellGridSize;
                const u1 = -1 + (2 * (cell.x + 1)) / cellGridSize;
                const v0 = -1 + (2 * cell.y) / cellGridSize;
                const v1 = -1 + (2 * (cell.y + 1)) / cellGridSize;

                for (let q = 0; q < 4; q++) {
                  if (!childQuadrants.has(q)) {
                    this.displaySingleQuadrant({ u0, u1, v0, v1 }, cell.face, q, color);
                  }
                }
              } else {
                // No children displayed, display this cell fully
                displayedCells.add(cellKey);
                this.displayLODCell(cell, color);
              }
            }
          }
        }
      }
    }

    // Update label
    if (this.labelDiv && this.hoverLabel) {
      const modeStr = isSphereMode ? 'arc' : 'cube';
      this.labelDiv.textContent = `LOD mode (${modeStr})\nMax level: ${maxLevel}\nBase distance: ${baseDistance.toFixed(2)}\nCells: ${displayedCells.size}`;
      const offset = new THREE.Vector3(-0.8, 0.2, 0);
      this.hoverLabel.position.copy(point).add(offset);
      this.hoverLabel.visible = true;
    }
  }

  /**
   * Displays a cell for LOD mode with full quadrant triangulation.
   */
  private displayLODCell(cell: QuadTreeCell, color: number): void {
    const displayInfo = { cell, isSelected: false };
    this.cubeRenderer.displayHoverCell(displayInfo, color);

    const gridSize = getGridSize(cell.level);
    const u0 = -1 + (2 * cell.x) / gridSize;
    const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
    const v0 = -1 + (2 * cell.y) / gridSize;
    const v1 = -1 + (2 * (cell.y + 1)) / gridSize;

    this.cubeRenderer.displayTriangulatedQuadrants(
      { u0, u1, v0, v1 },
      cell.face,
      -1, // all quadrants
      color
    );
  }

  /**
   * Gets the 4 child cells of a parent cell.
   */
  private getChildCells(cell: QuadTreeCell): QuadTreeCell[] {
    const childLevel = cell.level + 1;
    const childX = cell.x * 2;
    const childY = cell.y * 2;

    return [
      { face: cell.face, level: childLevel, x: childX, y: childY },         // BL
      { face: cell.face, level: childLevel, x: childX + 1, y: childY },     // BR
      { face: cell.face, level: childLevel, x: childX + 1, y: childY + 1 }, // TR
      { face: cell.face, level: childLevel, x: childX, y: childY + 1 },     // TL
    ];
  }

  /**
   * Generates a unique key for a cell.
   */
  private cellKey(cell: QuadTreeCell): string {
    return `${cell.face}:${cell.level}:${cell.x}:${cell.y}`;
  }

  /**
   * Gets the parent cell (one level up in the hierarchy).
   */
  private getParentCell(cell: QuadTreeCell): QuadTreeCell | null {
    if (cell.level === 0) return null;

    return {
      face: cell.face,
      level: cell.level - 1,
      x: Math.floor(cell.x / 2),
      y: Math.floor(cell.y / 2),
    };
  }

  /**
   * Gets which quadrant (0-3) the cell occupies within its parent.
   * 0=BL, 1=BR, 2=TR, 3=TL
   */
  private getQuadrantInParent(cell: QuadTreeCell): number {
    const qx = cell.x % 2; // 0 = left, 1 = right
    const qy = cell.y % 2; // 0 = bottom, 1 = top

    if (qy === 0) {
      return qx; // 0=BL, 1=BR
    } else {
      return qx === 0 ? 3 : 2; // 3=TL, 2=TR
    }
  }

  /**
   * Displays a single quadrant of a cell.
   * quadrant: 0=BL, 1=BR, 2=TR, 3=TL
   */
  private displaySingleQuadrant(
    cellUVBounds: { u0: number; u1: number; v0: number; v1: number },
    face: CubeFace,
    quadrant: number,
    color: number
  ): void {
    const { u0, u1, v0, v1 } = cellUVBounds;
    const uMid = (u0 + u1) / 2;
    const vMid = (v0 + v1) / 2;

    // Define quadrant bounds: 0=BL, 1=BR, 2=TR, 3=TL
    const quadrantBounds = [
      { u0: u0, u1: uMid, v0: v0, v1: vMid },   // BL
      { u0: uMid, u1: u1, v0: v0, v1: vMid },   // BR
      { u0: uMid, u1: u1, v0: vMid, v1: v1 },   // TR
      { u0: u0, u1: uMid, v0: vMid, v1: v1 },   // TL
    ];

    const bounds = quadrantBounds[quadrant];

    // Use the CubeRenderer's method but we need to call it for a single quadrant
    // We'll reuse displayTriangulatedQuadrants with a trick: pass the quadrant bounds as the cell bounds
    // and use -1 to triangulate the entire (sub)cell
    this.cubeRenderer.displayTriangulatedQuadrants(bounds, face, -1, color);
  }

  /**
   * Finds all cells at a given level that have at least one vertex within the distance threshold.
   */
  private findCellsWithinDistance(
    referencePoint: THREE.Vector3,
    level: number,
    threshold: number,
    useSphereDistance: boolean
  ): QuadTreeCell[] {
    const result: QuadTreeCell[] = [];
    const gridSize = getGridSize(level);

    // Iterate over all 6 faces
    for (let face = 0; face < 6; face++) {
      for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
          const cell: QuadTreeCell = { face: face as CubeFace, level, x, y };

          if (this.isCellWithinDistance(cell, referencePoint, threshold, useSphereDistance)) {
            result.push(cell);
          }
        }
      }
    }

    return result;
  }

  /**
   * Checks if any vertex of the cell is within the distance threshold.
   */
  private isCellWithinDistance(
    cell: QuadTreeCell,
    referencePoint: THREE.Vector3,
    threshold: number,
    useSphereDistance: boolean
  ): boolean {
    const vertices = computeCellVertices(cell);

    for (const vertex of vertices) {
      const distance = useSphereDistance
        ? this.computeArcDistance(referencePoint, vertex)
        : this.computeCubeDistance(referencePoint, vertex);

      if (distance <= threshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * Computes the arc distance (great circle distance) between two points on the sphere.
   * Both points should be normalized (on the unit sphere).
   */
  private computeArcDistance(p1: THREE.Vector3, p2: THREE.Vector3): number {
    // Project both points to sphere
    const s1 = p1.clone().normalize();
    const s2 = cubeToSphere(
      this.getCubeFaceFromPoint(p2),
      this.getUVFromCubePoint(p2).u,
      this.getUVFromCubePoint(p2).v
    );

    // Arc distance = angle between vectors (for unit sphere, arc length = angle in radians)
    const dot = Math.max(-1, Math.min(1, s1.dot(s2)));
    return Math.acos(dot);
  }

  /**
   * Computes the Euclidean distance between two points on the cube surface.
   */
  private computeCubeDistance(p1: THREE.Vector3, p2: THREE.Vector3): number {
    // Simple Euclidean distance for cube mode
    return p1.distanceTo(p2);
  }

  /**
   * Gets the cube face index from a point on the cube surface.
   */
  private getCubeFaceFromPoint(point: THREE.Vector3): number {
    const ax = Math.abs(point.x);
    const ay = Math.abs(point.y);
    const az = Math.abs(point.z);

    if (ax >= ay && ax >= az) {
      return point.x >= 0 ? CubeFace.PLUS_X : CubeFace.MINUS_X;
    } else if (ay >= ax && ay >= az) {
      return point.y >= 0 ? CubeFace.PLUS_Y : CubeFace.MINUS_Y;
    } else {
      return point.z >= 0 ? CubeFace.PLUS_Z : CubeFace.MINUS_Z;
    }
  }

  /**
   * Gets UV coordinates from a point on the cube surface.
   */
  private getUVFromCubePoint(point: THREE.Vector3): { u: number; v: number } {
    const ax = Math.abs(point.x);
    const ay = Math.abs(point.y);
    const az = Math.abs(point.z);

    if (ax >= ay && ax >= az) {
      // +X or -X face
      if (point.x >= 0) {
        return { u: -point.z, v: point.y };
      } else {
        return { u: point.z, v: point.y };
      }
    } else if (ay >= ax && ay >= az) {
      // +Y or -Y face
      if (point.y >= 0) {
        return { u: point.x, v: point.z };
      } else {
        return { u: point.x, v: -point.z };
      }
    } else {
      // +Z or -Z face
      if (point.z >= 0) {
        return { u: point.x, v: point.y };
      } else {
        return { u: -point.x, v: point.y };
      }
    }
  }

  /**
   * Clears the hover display.
   */
  private clearHover(): void {
    this.cubeRenderer.clearHoverDisplay();
    this.lastHoveredCell = null;

    if (this.hoverLabel) {
      this.hoverLabel.visible = false;
    }
  }

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.deactivate();

    if (this.hoverLabel) {
      this.sceneSetup.scene.remove(this.hoverLabel);
      this.hoverLabel = null;
    }

    if (this.labelDiv && this.labelDiv.parentNode) {
      this.labelDiv.parentNode.removeChild(this.labelDiv);
    }
    this.labelDiv = null;
  }
}
