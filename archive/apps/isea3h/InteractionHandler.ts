import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { OctahedronRenderer } from './OctahedronRenderer';
import { projectToOctahedron } from './ISEA3HSnyderProjection';
import {
  ISEA3HCell,
  ISEA3HCellDisplayInfo,
  computeDisplayHierarchy,
  ISEA3HDisplayHierarchy,
  getNormalizationFactor,
  isCentralChild,
  getCentralChild,
  getNeighbors,
  isSquareCell as checkSquareCell,
} from './ISEA3HEncoding';
import {
  computeBarycenter,
  computeCellVertices,
  computeNeighborBarycenters,
  isPointInPolygon,
} from './ISEA3HGeometry';

/**
 * Rounds a value to the nearest integer whose absolute value has a specific residue modulo 3.
 */
function roundToAbsResidue(value: number, residue: number): number {
  const base = Math.round(value);
  const absBase = Math.abs(base);
  const baseMod = absBase % 3;

  if (baseMod === residue) return base;

  // Try base+1 and base-1, pick the one whose abs value has the right residue and is closer
  const candidates: number[] = [];

  // Check base + 1
  if (Math.abs(base + 1) % 3 === residue) candidates.push(base + 1);
  // Check base - 1
  if (Math.abs(base - 1) % 3 === residue) candidates.push(base - 1);
  // Check base + 2
  if (Math.abs(base + 2) % 3 === residue) candidates.push(base + 2);
  // Check base - 2
  if (Math.abs(base - 2) % 3 === residue) candidates.push(base - 2);

  if (candidates.length === 0) return base;

  // Pick the closest candidate to the original value
  let best = candidates[0];
  let bestDist = Math.abs(candidates[0] - value);
  for (let i = 1; i < candidates.length; i++) {
    const dist = Math.abs(candidates[i] - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidates[i];
    }
  }
  return best;
}

/**
 * Adjusts coordinates to satisfy |a| + |b| + |c| = normFactor.
 * Returns null if adjustment is not possible while maintaining signs.
 */
function adjustToNormFactor(a: number, b: number, c: number, normFactor: number): { a: number; b: number; c: number } | null {
  const absSum = Math.abs(a) + Math.abs(b) + Math.abs(c);
  if (absSum === normFactor) {
    return { a, b, c };
  }

  const diff = absSum - normFactor;

  // Try to adjust the coordinate with smallest absolute value
  const coords = [
    { key: 'a', val: a, abs: Math.abs(a) },
    { key: 'b', val: b, abs: Math.abs(b) },
    { key: 'c', val: c, abs: Math.abs(c) },
  ];
  coords.sort((x, y) => x.abs - y.abs); // Sort by abs ascending

  for (const coord of coords) {
    const adjustment = Math.sign(coord.val || 1) * diff;
    const newVal = coord.val - adjustment;

    // Check if adjustment maintains sign (or coord was 0)
    if (coord.val === 0 || Math.sign(newVal) === Math.sign(coord.val) || newVal === 0) {
      if (coord.key === 'a') return { a: newVal, b, c };
      if (coord.key === 'b') return { a, b: newVal, c };
      return { a, b, c: newVal };
    }
  }

  return null;
}

/**
 * Converts an octahedron point to ISEA3H cell coordinates at a given resolution level.
 * For odd n, ensures a ≡ b ≡ c (mod 3).
 */
function octahedronPointToCell(octPoint: THREE.Vector3, n: number): ISEA3HCell {
  const normFactor = getNormalizationFactor(n);

  // The octahedron point has |x| + |y| + |z| = 1
  // Scale to get coordinates where |a| + |b| + |c| = normFactor
  const rawA = octPoint.x * normFactor;
  const rawB = octPoint.y * normFactor;
  const rawC = octPoint.z * normFactor;

  if (n % 2 === 0) {
    // Even n: just round and adjust for sum constraint
    const a = Math.round(rawA);
    const b = Math.round(rawB);
    const c = Math.round(rawC);

    const result = adjustToNormFactor(a, b, c, normFactor);
    if (result) {
      return { n, ...result };
    }
    return { n, a, b, c };
  }

  // Odd n: |a|, |b|, |c| must all be congruent modulo 3
  // Try each possible residue and find the best valid cell
  let bestCell: ISEA3HCell | null = null;
  let bestDistance = Infinity;

  for (const residue of [0, 1, 2]) {
    // Round each coordinate to nearest value whose absolute value has this residue
    const a = roundToAbsResidue(rawA, residue);
    const b = roundToAbsResidue(rawB, residue);
    const c = roundToAbsResidue(rawC, residue);

    // Adjust to satisfy sum constraint
    const adjusted = adjustToNormFactor(a, b, c, normFactor);
    if (!adjusted) continue;

    // Verify the residue constraint is still satisfied after adjustment
    const modAbsA = Math.abs(adjusted.a) % 3;
    const modAbsB = Math.abs(adjusted.b) % 3;
    const modAbsC = Math.abs(adjusted.c) % 3;
    if (modAbsA !== modAbsB || modAbsB !== modAbsC) continue;

    // Compute distance to original point
    const dist = Math.abs(adjusted.a - rawA) + Math.abs(adjusted.b - rawB) + Math.abs(adjusted.c - rawC);

    if (dist < bestDistance) {
      bestDistance = dist;
      bestCell = { n, a: adjusted.a, b: adjusted.b, c: adjusted.c };
    }
  }

  if (bestCell) {
    return bestCell;
  }

  // Fallback: return simple rounding (shouldn't happen with valid input)
  const a = Math.round(rawA);
  const b = Math.round(rawB);
  const c = Math.round(rawC);
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
   * Maximum is 9.
   */
  setResolutionLevel(n: number): void {
    this.resolutionLevel = Math.max(1, Math.min(9, Math.round(n)));
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

    // Get the appropriate mesh to raycast against based on mode
    const isSphereMode = this.octahedronRenderer.isSphereMode();
    const targetMesh = isSphereMode
      ? this.octahedronRenderer.getSphereMesh()
      : this.octahedronRenderer.getOctahedronMesh();

    if (!targetMesh) {
      this.hideLabel();
      return;
    }

    const intersects = this.raycaster.intersectObject(targetMesh);

    if (intersects.length > 0) {
      const hitPoint = intersects[0].point.clone();

      // Convert to octahedron coordinates
      // In sphere mode, project sphere point to octahedron using current projection mode
      // In octahedron mode, the hit point is already on the octahedron
      const octPoint = isSphereMode
        ? projectToOctahedron(hitPoint)
        : this.normalizeToOctahedron(hitPoint);

      // Get cell at current resolution level
      const cell = octahedronPointToCell(octPoint, this.resolutionLevel);

      // Create callback for finding enclosing parent using geometric point-in-polygon test
      const findEnclosingParent = (parentCells: ISEA3HCell[], _currentCell: ISEA3HCell) => {
        return this.findEnclosingParentCell(parentCells, octPoint);
      };

      // Compute the display hierarchy with callback for choosing central neighbors
      const displayHierarchy = computeDisplayHierarchy(cell, findEnclosingParent);

      // Compute and display the cells
      this.displayCellInfo(hitPoint, displayHierarchy);
      this.highlightCells(displayHierarchy);
    } else {
      this.hideLabel();
      this.octahedronRenderer.clearHoverDisplay();
    }
  }

  /**
   * Normalizes a point to the octahedron surface (|x| + |y| + |z| = 1).
   */
  private normalizeToOctahedron(point: THREE.Vector3): THREE.Vector3 {
    const sum = Math.abs(point.x) + Math.abs(point.y) + Math.abs(point.z);
    if (sum === 0) return new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3(
      point.x / sum,
      point.y / sum,
      point.z / sum
    );
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

    // Colors indexed by resolution level
    const selectedColorsArray = [
      0xff0000, // Level 1 - red
      0xff8800, // Level 2 - orange
      0xffff00, // Level 3 - yellow
      0x00ff00, // Level 4 - green
      0x00ffff, // Level 5 - cyan
      0x0088ff, // Level 6 - blue
      0x8800ff, // Level 7 - purple
    ];

    // Dimmer colors for alternative (non-selected) cells
    const alternativeColorsArray = [
      0x660000, // Level 1 - dim red
      0x664400, // Level 2 - dim orange
      0x666600, // Level 3 - dim yellow
      0x006600, // Level 4 - dim green
      0x006666, // Level 5 - dim cyan
      0x004466, // Level 6 - dim blue
      0x440066, // Level 7 - dim purple
    ];

    const getSelectedColor = (n: number) => selectedColorsArray[(n - 1) % selectedColorsArray.length];
    const getAlternativeColor = (n: number) => alternativeColorsArray[(n - 1) % alternativeColorsArray.length];

    // First pass: display alternative cells (so they render behind selected cells)
    for (const level of hierarchy.levels) {
      const cellLevel = level.cell.n;
      const alternativeColor = getAlternativeColor(cellLevel);

      if (level.alternativeCells) {
        for (const altCell of level.alternativeCells) {
          this.octahedronRenderer.displayHoverCell(altCell, alternativeColor);
        }
      }
    }

    // Second pass: display selected cells (so they render on top)
    for (let i = 0; i < hierarchy.levels.length; i++) {
      const level = hierarchy.levels[i];
      const cellLevel = level.cell.n;
      const selectedColor = getSelectedColor(cellLevel);

      this.octahedronRenderer.displayHoverCell(level, selectedColor);

      // Display barycenter and neighbor barycenters for the current resolution level (first cell)
      if (i === 0) {
        const barycenter = computeBarycenter(level.cell);
        this.octahedronRenderer.displayHoverBarycenter(barycenter, 0xffff00);
        if (level.neighborCells.length > 0) {
          const neighborBarycenters = computeNeighborBarycenters(level);
          this.octahedronRenderer.displayHoverNeighborBarycenters(neighborBarycenters, 0xff00ff);
        }
      }
    }
  }

  /**
   * Finds the parent cell that encloses the reference point.
   * Falls back to the closest parent if none enclose the point.
   */
  private findEnclosingParentCell(
    parentCells: ISEA3HCell[],
    referencePoint: THREE.Vector3
  ): { selected: ISEA3HCell; alternatives: ISEA3HCell[] } | null {
    if (parentCells.length === 0) return null;

    let selectedParent: ISEA3HCell | null = null;
    const alternativeParents: ISEA3HCell[] = [];

    for (const parent of parentCells) {
      // Get display info to compute vertices
      const centralChild = getCentralChild(parent);
      const displayInfo: ISEA3HCellDisplayInfo = {
        cell: parent,
        isSquareCell: checkSquareCell(parent),
        cellVertexCells: getNeighbors(centralChild),
        neighborCells: [],
        isSelected: false,
      };

      const parentVertices = computeCellVertices(displayInfo);
      if (parentVertices.length >= 3 && isPointInPolygon(referencePoint, parentVertices)) {
        if (!selectedParent) {
          selectedParent = parent;
        } else {
          alternativeParents.push(parent);
        }
      } else {
        alternativeParents.push(parent);
      }
    }

    // If no enclosing parent found, use the closest one
    if (!selectedParent) {
      let closestDist = Infinity;
      for (const parent of parentCells) {
        const dist = computeBarycenter(parent).distanceTo(referencePoint);
        if (dist < closestDist) {
          closestDist = dist;
          selectedParent = parent;
        }
      }
      // Remove selected from alternatives
      if (selectedParent) {
        const selectedKey = `${selectedParent.n},${selectedParent.a},${selectedParent.b},${selectedParent.c}`;
        for (let i = alternativeParents.length - 1; i >= 0; i--) {
          const key = `${alternativeParents[i].n},${alternativeParents[i].a},${alternativeParents[i].b},${alternativeParents[i].c}`;
          if (key === selectedKey) {
            alternativeParents.splice(i, 1);
          }
        }
      }
    }

    if (!selectedParent) return null;

    return { selected: selectedParent, alternatives: alternativeParents };
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
