import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { OctahedronRenderer } from './OctahedronRenderer';
import { sphereToOctahedron } from './ISEA3HSnyderProjection';
import {
  ISEA3HCell,
  computeDisplayHierarchy,
  ISEA3HDisplayHierarchy,
  getNormalizationFactor,
  isCentralChild,
} from './ISEA3HEncoding';

/**
 * Converts an octahedron point to ISEA3H cell coordinates at a given resolution level.
 */
function octahedronPointToCell(octPoint: THREE.Vector3, n: number): ISEA3HCell {
  const normFactor = getNormalizationFactor(n);

  // The octahedron point has |x| + |y| + |z| = 1
  // Scale to get coordinates where |a| + |b| + |c| = normFactor
  const a = Math.round(octPoint.x * normFactor);
  const b = Math.round(octPoint.y * normFactor);
  const c = Math.round(octPoint.z * normFactor);

  // Adjust to ensure |a| + |b| + |c| = normFactor exactly
  const absSum = Math.abs(a) + Math.abs(b) + Math.abs(c);
  if (absSum !== normFactor) {
    // Find the coordinate with the smallest absolute value and adjust it
    const coords = [
      { key: 'a', val: a, abs: Math.abs(a) },
      { key: 'b', val: b, abs: Math.abs(b) },
      { key: 'c', val: c, abs: Math.abs(c) },
    ];
    coords.sort((x, y) => y.abs - x.abs); // Sort by abs descending

    const diff = absSum - normFactor;
    const adjustCoord = coords[2]; // Smallest absolute value

    if (adjustCoord.key === 'a') {
      return { n, a: a - Math.sign(a || 1) * diff, b, c };
    } else if (adjustCoord.key === 'b') {
      return { n, a, b: b - Math.sign(b || 1) * diff, c };
    } else {
      return { n, a, b, c: c - Math.sign(c || 1) * diff };
    }
  }

  return { n, a, b, c };
}

/**
 * Formats a cell for display.
 */
function formatCellShort(cell: ISEA3HCell): string {
  return `n${cell.n}: (${cell.a},${cell.b},${cell.c})`;
}

/**
 * Handles mouse interaction for ISEA3H sphere hovering.
 */
export class InteractionHandler {
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  // Label for displaying cell info
  private label: CSS2DObject | null = null;
  private labelDiv: HTMLDivElement | null = null;

  // Current resolution level for coordinate computation
  private resolutionLevel: number = 3;

  // Bound event handlers
  private boundOnMouseMove: (event: MouseEvent) => void;
  private boundOnMouseLeave: (event: MouseEvent) => void;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private rendererElement: HTMLElement,
    private getContentArea: () => HTMLElement,
    private octahedronRenderer: OctahedronRenderer
  ) {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnMouseLeave = this.onMouseLeave.bind(this);

    this.createLabel();
  }

  /**
   * Sets the resolution level for coordinate computation.
   * Minimum is 1 (resolution 0 doesn't display hexagons).
   */
  setResolutionLevel(n: number): void {
    this.resolutionLevel = Math.max(1, Math.min(6, Math.round(n)));
  }

  /**
   * Gets the current resolution level.
   */
  getResolutionLevel(): number {
    return this.resolutionLevel;
  }

  /**
   * Creates the CSS2D label for displaying cell info.
   */
  private createLabel(): void {
    this.labelDiv = document.createElement('div');
    this.labelDiv.className = 'isea3h-hover-label';
    this.labelDiv.style.cssText = `
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre;
      pointer-events: none;
      border: 1px solid rgba(255, 255, 255, 0.3);
    `;

    this.label = new CSS2DObject(this.labelDiv);
    this.label.visible = false;
    this.scene.add(this.label);
  }

  /**
   * Starts listening for mouse events.
   */
  activate(): void {
    this.rendererElement.addEventListener('mousemove', this.boundOnMouseMove);
    this.rendererElement.addEventListener('mouseleave', this.boundOnMouseLeave);
  }

  /**
   * Stops listening for mouse events.
   */
  deactivate(): void {
    this.rendererElement.removeEventListener('mousemove', this.boundOnMouseMove);
    this.rendererElement.removeEventListener('mouseleave', this.boundOnMouseLeave);
  }

  /**
   * Handles mouse move for hover detection.
   */
  private onMouseMove(event: MouseEvent): void {
    const contentArea = this.getContentArea();
    const rect = contentArea.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Get the sphere mesh to raycast against
    const sphereMesh = this.octahedronRenderer.getSphereMesh();
    if (!sphereMesh || !this.octahedronRenderer.isSphereMode()) {
      this.hideLabel();
      return;
    }

    const intersects = this.raycaster.intersectObject(sphereMesh);

    if (intersects.length > 0) {
      const hitPoint = intersects[0].point.clone();

      // Convert sphere point to octahedron coordinates
      const octPoint = sphereToOctahedron(hitPoint);

      // Get cell at current resolution level
      const cell = octahedronPointToCell(octPoint, this.resolutionLevel);

      // Compute the display hierarchy with hover point for choosing central neighbors
      const displayHierarchy = computeDisplayHierarchy(cell, octPoint);

      // Compute and display the cells
      this.displayCellInfo(hitPoint, displayHierarchy);
      this.highlightCells(displayHierarchy);
    } else {
      this.hideLabel();
      this.octahedronRenderer.clearHoverDisplay();
    }
  }

  /**
   * Handles mouse leave.
   */
  private onMouseLeave(_event: MouseEvent): void {
    this.hideLabel();
    this.octahedronRenderer.clearHoverDisplay();
  }

  /**
   * Displays cell information in the label.
   */
  private displayCellInfo(position: THREE.Vector3, hierarchy: ISEA3HDisplayHierarchy): void {
    if (!this.label || !this.labelDiv) return;

    // Build the label text
    const lines: string[] = ['Cell Hierarchy:'];

    for (const level of hierarchy.levels) {
      const type = level.isSquareCell ? '□' : '⬡';
      const central = isCentralChild(level.cell) ? '●' : '○';
      lines.push(`${central} ${type} ${formatCellShort(level.cell)}`);
    }

    this.labelDiv.textContent = lines.join('\n');

    // Position the label with a left offset relative to camera view
    // Get the camera's right vector and offset the label to the left
    const cameraRight = new THREE.Vector3();
    this.camera.getWorldDirection(cameraRight);
    cameraRight.cross(this.camera.up).normalize();

    // Position: start from hit point, move outward slightly, then offset left
    const labelPos = position.clone().normalize().multiplyScalar(1.1);
    labelPos.addScaledVector(cameraRight, -0.5); // Offset to the left

    this.label.position.copy(labelPos);
    this.label.visible = true;
  }

  /**
   * Hides the label.
   */
  private hideLabel(): void {
    if (this.label) {
      this.label.visible = false;
    }
  }

  /**
   * Highlights the cells in the hierarchy.
   */
  private highlightCells(hierarchy: ISEA3HDisplayHierarchy): void {
    // Clear previous hover display
    this.octahedronRenderer.clearHoverDisplay();

    // Colors for selected cells at each level
    const selectedColors = [
      0x00ff00, // Level n (current) - green
      0xffff00, // Level n-1 - yellow
      0xff8800, // Level n-2 - orange
      0xff0088, // Level n-3 - pink
      0x8800ff, // Level n-4 - purple
      0x0088ff, // Level n-5 - blue
      0x00ffff, // Level n-6 - cyan
    ];

    // Colors for alternative (non-selected) cells - dimmer versions
    const alternativeColors = [
      0x006600, // Level n - dim green
      0x666600, // Level n-1 - dim yellow
      0x664400, // Level n-2 - dim orange
      0x660044, // Level n-3 - dim pink
      0x440066, // Level n-4 - dim purple
      0x004466, // Level n-5 - dim blue
      0x006666, // Level n-6 - dim cyan
    ];

    // First pass: display alternative cells (so they render behind selected cells)
    for (let i = 0; i < hierarchy.levels.length; i++) {
      const level = hierarchy.levels[i];
      const alternativeColor = alternativeColors[i % alternativeColors.length];

      if (level.alternativeCells) {
        for (const altCell of level.alternativeCells) {
          this.octahedronRenderer.displayHoverCell(altCell, alternativeColor);
        }
      }
    }

    // Second pass: display selected cells (so they render on top)
    for (let i = 0; i < hierarchy.levels.length; i++) {
      const level = hierarchy.levels[i];
      const selectedColor = selectedColors[i % selectedColors.length];

      this.octahedronRenderer.displayHoverCell(level, selectedColor);

      // Display barycenter and neighbor barycenters for the current resolution level (first cell)
      if (i === 0) {
        this.octahedronRenderer.displayHoverBarycenter(level.barycenter, 0xffff00);
        if (level.neighborBarycenters.length > 0) {
          this.octahedronRenderer.displayHoverNeighborBarycenters(level.neighborBarycenters, 0xff00ff);
        }
      }
    }
  }

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.deactivate();

    if (this.label) {
      this.scene.remove(this.label);
      this.label = null;
    }

    this.labelDiv = null;
  }
}
