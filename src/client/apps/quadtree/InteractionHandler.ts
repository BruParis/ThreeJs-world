import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CubeRenderer } from './CubeRenderer';
import { SceneSetup } from './SceneSetup';
import { FlyCam } from '@core/FlyCam';
import {
  QuadTreeCell,
  computeDisplayHierarchy,
  formatCell,
  getGridSize,
} from './QuadTreeEncoding';
import { spherePointToCell } from './QuadTreeGeometry';
import { ProjectionManager } from '@core/geometry/SphereProjection';
import {
  ViewFrustumLOD,
  computeCameraDistanceToSphere,
  suggestMaxDepthFromDistance,
} from './ViewFrustumLOD';

export type DisplayMode = 'hierarchy' | 'frustumLOD';

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

  private displayMode: DisplayMode = 'frustumLOD';

  // View frustum LOD system
  private viewFrustumLOD!: ViewFrustumLOD;
  // Whether to auto-adjust max depth based on camera distance
  private autoAdjustDepth: boolean = true;
  // Target screen-space error for frustum LOD (in pixels)
  private targetScreenSpaceError: number = 64;

  // Fly camera used for frustum LOD computation (always active)
  private flyCam: FlyCam | null = null;

  // Hover label
  private hoverLabel: CSS2DObject | null = null;
  private labelDiv: HTMLDivElement | null = null;

  // Last hovered cell (to avoid redundant updates)
  private lastHoveredCell: QuadTreeCell | null = null;

  // Bound event handlers
  private boundOnMouseMove: (event: MouseEvent) => void;

  // Unsubscribe function for projection changes
  private unsubscribeProjection: (() => void) | null = null;

  constructor(sceneSetup: SceneSetup, cubeRenderer: CubeRenderer) {
    this.sceneSetup = sceneSetup;
    this.cubeRenderer = cubeRenderer;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.boundOnMouseMove = this.onMouseMove.bind(this);

    // Create label element
    this.createLabel();

    // Initialize view frustum LOD system
    this.viewFrustumLOD = new ViewFrustumLOD({
      maxDepth: this.resolutionLevel,
      targetScreenSpaceError: this.targetScreenSpaceError,
      sphereMode: this.cubeRenderer.isSphereMode(),
    });

    // Subscribe to projection changes to force LOD rebuild
    this.unsubscribeProjection = ProjectionManager.onProjectionChange(() => {
      this.onProjectionChanged();
    });
  }

  /**
   * Sets the fly camera used for frustum LOD computation.
   * Must be called before frustumLOD mode is used.
   */
  setFlyCam(flyCam: FlyCam): void {
    this.flyCam = flyCam;
  }

  /**
   * Handles projection type changes by forcing a LOD rebuild.
   */
  private onProjectionChanged(): void {
    this.lastHoveredCell = null;
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
    if (this.displayMode === 'frustumLOD') return;

    // Display hover point indicator
    this.cubeRenderer.displayHoverPoint(point);

    if (this.displayMode === 'hierarchy') {
      this.handleHierarchyMode(point);
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

      // Calculate UV bounds for this cell
      const gridSize = getGridSize(currentCell.level);
      const u0 = -1 + (2 * currentCell.x) / gridSize;
      const u1 = -1 + (2 * (currentCell.x + 1)) / gridSize;
      const v0 = -1 + (2 * currentCell.y) / gridSize;
      const v1 = -1 + (2 * (currentCell.y + 1)) / gridSize;

      // Determine which quadrants contain children (only the one leading to the leaf)
      let childQuadrants: Set<number> | undefined;
      if (i > 0) {
        // The child is at hierarchy.levels[i-1]
        const childCell = hierarchy.levels[i - 1].cell;
        const childQuadrant = this.getQuadrantInParent(childCell);
        childQuadrants = new Set([childQuadrant]);
      }
      // At the deepest level (i === 0), childQuadrants remains undefined (render all)

      this.cubeRenderer.displayTriangulatedQuadrants(
        { u0, u1, v0, v1 },
        currentCell.face,
        childQuadrants,
        color
      );
    }

    // Update label - offset to the left for readability
    if (this.labelDiv && this.hoverLabel) {
      this.labelDiv.textContent = labelText.trim();
      // Offset the label further to the left of the hover point
      const offset = new THREE.Vector3(-0.8, 0.2, 0);
      this.hoverLabel.position.copy(point).add(offset);
      this.hoverLabel.visible = true;
    }

    // Flush pending worker requests if using web workers
    this.cubeRenderer.flushQuadrantRequests();
  }

  /**
   * Updates the LOD display. Should be called from the animation loop.
   */
  public updateLOD(): void {
    if (!this.active) return;
    if (this.displayMode === 'frustumLOD') {
      this.renderFrustumLOD();
    }
  }

  /**
   * Renders LOD using view frustum culling and screen-space error.
   * Only renders cells that are visible to the camera.
   */
  private renderFrustumLOD(): void {

    // Fly cam always drives LOD computation; fall back to orbit cam if not set yet
    const lodCamera = this.flyCam?.camera ?? this.sceneSetup.camera;

    const canvas = this.sceneSetup.renderer.domElement;
    const screenWidth = canvas.clientWidth;
    const screenHeight = canvas.clientHeight;

    // Update LOD config based on current settings
    const cameraDistToSphere = computeCameraDistanceToSphere(lodCamera);

    // Auto-adjust max depth based on camera distance
    let maxDepth = this.resolutionLevel;
    if (this.autoAdjustDepth) {
      maxDepth = suggestMaxDepthFromDistance(cameraDistToSphere, this.resolutionLevel, 20);
    }

    this.viewFrustumLOD.setConfig({
      maxDepth,
      targetScreenSpaceError: this.targetScreenSpaceError,
      sphereMode: this.cubeRenderer.isSphereMode(),
    });

    // Compute LOD using the fly camera
    const result = this.viewFrustumLOD.computeLOD(lodCamera, screenWidth, screenHeight);

    // Update quadrant meshes incrementally (no cell outlines in frustumLOD mode)
    this.cubeRenderer.updateLODQuadrants(result.quadrants);

    // Update label with stats
    if (this.labelDiv && this.hoverLabel) {
      const modeStr = this.cubeRenderer.isSphereMode() ? 'sphere' : 'cube';
      const levelStats: string[] = [];
      for (const [level, count] of result.stats.cellsPerLevel) {
        levelStats.push(`L${level}: ${count}`);
      }
      this.labelDiv.textContent =
        `Frustum LOD (${modeStr}) [fly cam]\n` +
        `Camera dist: ${cameraDistToSphere.toFixed(2)}\n` +
        `Max depth: ${maxDepth}\n` +
        `Target error: ${this.targetScreenSpaceError}px\n` +
        `Quadrants: ${result.quadrants.size}\n` +
        `Max level: ${result.stats.maxLevelReached}\n` +
        `Cells: ${levelStats.slice(0, 4).join(', ')}`;

      // Position label near the fly camera
      if (this.flyCam) {
        const labelPos = this.flyCam.camera.position.clone();
        labelPos.y += 0.15;
        this.hoverLabel.position.copy(labelPos);
      } else {
        this.hoverLabel.position.set(-0.8, 0.8, 0);
      }
      this.hoverLabel.visible = true;
    }
  }

  /**
   * Gets the target screen-space error for frustum LOD.
   */
  getTargetScreenSpaceError(): number {
    return this.targetScreenSpaceError;
  }

  /**
   * Sets the target screen-space error for frustum LOD.
   * Smaller values = more detail (more subdivisions).
   */
  setTargetScreenSpaceError(value: number): void {
    this.targetScreenSpaceError = Math.max(8, Math.min(256, value));
  }

  /**
   * Gets whether auto-adjust depth is enabled.
   */
  getAutoAdjustDepth(): boolean {
    return this.autoAdjustDepth;
  }

  /**
   * Sets whether to auto-adjust max depth based on camera distance.
   */
  setAutoAdjustDepth(enabled: boolean): void {
    this.autoAdjustDepth = enabled;
  }

  /**
   * Gets which quadrant (0-3) the cell occupies within its parent.
   * 0=BL, 1=BR, 2=TR, 3=TL
   */
  private getQuadrantInParent(cell: QuadTreeCell): number {
    const qx = cell.x % 2;
    const qy = cell.y % 2;
    if (qy === 0) return qx;
    return qx === 0 ? 3 : 2;
  }

  /**
   * Clears the hover display.
   */
  private clearHover(): void {
    if (this.displayMode === 'frustumLOD') return;

    // Clear immediately (no deferred removal) since we're not transitioning to new meshes
    this.cubeRenderer.clearHoverDisplay(false);
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

    // Unsubscribe from projection changes
    if (this.unsubscribeProjection) {
      this.unsubscribeProjection();
      this.unsubscribeProjection = null;
    }

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
