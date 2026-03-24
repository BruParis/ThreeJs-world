import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CubeRenderer } from './CubeRenderer';
import { SceneSetup } from './SceneSetup';
import {
  QuadTreeCell,
  computeDisplayHierarchy,
  formatCell,
} from './QuadTreeEncoding';
import { spherePointToCell } from './QuadTreeGeometry';

// Colors for different hierarchy levels (from child to parent)
const LEVEL_COLORS = [
  0x00ff00,  // Level 0 (current cell) - green
  0xffff00,  // Level 1 - yellow
  0xff8800,  // Level 2 - orange
  0xff0088,  // Level 3 - pink
  0x8800ff,  // Level 4 - purple
  0x0088ff,  // Level 5 - blue
  0x00ffff,  // Level 6 - cyan
  0xff00ff,  // Level 7 - magenta
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
      const color = LEVEL_COLORS[i % LEVEL_COLORS.length];

      // Display the cell outline
      this.cubeRenderer.displayHoverCell(levelInfo, color);

      // Add to label text
      labelText += formatCell(levelInfo.cell) + '\n';
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
