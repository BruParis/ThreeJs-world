/**
 * View Frustum-based Level of Detail (LOD) system for quadtree sphere rendering.
 *
 * This system determines which quadtree cells to render based on:
 * 1. View frustum culling - only cells visible to the camera
 * 2. Screen-space error - subdivide cells that appear large on screen
 * 3. Camera distance - deeper levels when camera is closer to the sphere
 */

import * as THREE from 'three';
import { QuadTreeCell, CubeFace, getGridSize } from './QuadTreeEncoding';
import { computeCellCenter, computeCellVertices, computeCellCenterOnSphere, computeCellVerticesOnSphere } from './QuadTreeGeometry';
import { QuadrantSpec } from './CubeRenderer';

// Colors for quadtree levels
const LEVEL_COLORS = [
  0xff0000,  // Level 0 - red
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
  0xff0088,  // Level 11 - pink
  0xff4444,  // Level 12 - light red
  0xffaa44,  // Level 13 - light orange
  0xffff88,  // Level 14 - light yellow
  0xaaffaa,  // Level 15 - light green
  0x88ffff,  // Level 16 - light cyan
  0xaaaaff,  // Level 17 - light blue
  0xffaaff,  // Level 18 - light magenta
  0xffffff,  // Level 19 - white
  0xcccccc,  // Level 20+ - gray
];

/**
 * Configuration for the view frustum LOD system.
 */
export interface LODConfig {
  /** Maximum depth level — safety cap, not a user control (default: 20) */
  maxDepth: number;
  /** Target screen-space error in pixels (default: 64) - smaller = more detail */
  targetScreenSpaceError: number;
  /** Extra margin around the frustum for culling (prevents popping, default: 0.1) */
  frustumMargin: number;
  /** Whether to use spherical distance for LOD (default: true) */
  sphereMode: boolean;
}

const DEFAULT_CONFIG: LODConfig = {
  maxDepth: 20,
  targetScreenSpaceError: 64,
  frustumMargin: 0.1,
  sphereMode: true,
};

/**
 * Result of LOD computation - cells to render at their appropriate levels.
 */
export interface LODResult {
  /** Map of quadrant key to QuadrantSpec for rendering */
  quadrants: Map<string, QuadrantSpec>;
  /** Cells to display outlines for (for debugging/visualization) */
  cellsToDisplay: Array<{ cell: QuadTreeCell; color: number; childQuadrants?: Set<number> }>;
  /** Statistics about the LOD computation */
  stats: {
    totalCells: number;
    cellsPerLevel: Map<number, number>;
    culledCells: number;
    maxLevelReached: number;
  };
}

/**
 * View Frustum LOD System for quadtree-based sphere rendering.
 */
export class ViewFrustumLOD {
  private config: LODConfig;
  private frustum: THREE.Frustum;
  private projScreenMatrix: THREE.Matrix4;
  private tempSphere: THREE.Sphere;
  private lodCameraPosition: THREE.Vector3;

  constructor(config: Partial<LODConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this.tempSphere = new THREE.Sphere();
    this.lodCameraPosition = new THREE.Vector3();
  }

  /**
   * Updates the LOD configuration.
   */
  setConfig(config: Partial<LODConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): LODConfig {
    return { ...this.config };
  }

  /**
   * Computes which cells to render based on the camera's view frustum and screen-space error.
   *
   * @param camera The camera to use for frustum culling and screen-space error computation
   * @param screenWidth Width of the viewport in pixels
   * @param screenHeight Height of the viewport in pixels
   * @returns LODResult with quadrants to render and statistics
   */
  computeLOD(
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number
  ): LODResult {
    // Update the frustum from camera
    this.updateFrustum(camera);
    this.lodCameraPosition.copy(camera.position);

    const quadrants = new Map<string, QuadrantSpec>();
    const cellsToDisplay: LODResult['cellsToDisplay'] = [];
    const cellsPerLevel = new Map<number, number>();
    let culledCells = 0;
    let maxLevelReached = 0;

    // Track which cells have children displayed (to avoid rendering parent where child exists)
    const cellsWithChildren = new Set<string>();
    // Track displayed leaf cells
    const displayedLeafCells = new Set<string>();

    // Process all 6 cube faces
    for (let face = 0; face < 6; face++) {
      // Start traversal from level 0 (the entire face)
      const rootCell: QuadTreeCell = { face: face as CubeFace, level: 0, x: 0, y: 0 };

      this.traverseCell(
        rootCell,
        camera,
        screenWidth,
        screenHeight,
        quadrants,
        cellsToDisplay,
        cellsWithChildren,
        displayedLeafCells,
        cellsPerLevel,
        { culled: 0, maxLevel: 0 }
      );
    }

    // Find max level from traversal
    for (const level of cellsPerLevel.keys()) {
      if (level > maxLevelReached) {
        maxLevelReached = level;
      }
    }

    return {
      quadrants,
      cellsToDisplay,
      stats: {
        totalCells: quadrants.size / 4, // Each cell has 4 quadrants
        cellsPerLevel,
        culledCells,
        maxLevelReached,
      },
    };
  }

  /**
   * Updates the frustum from the camera matrices.
   */
  private updateFrustum(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    // Expand frustum planes by margin to prevent popping at edges
    if (this.config.frustumMargin > 0) {
      for (const plane of this.frustum.planes) {
        plane.constant += this.config.frustumMargin;
      }
    }
  }

  /**
   * Recursively traverses the quadtree, deciding whether to render a cell or subdivide it.
   */
  private traverseCell(
    cell: QuadTreeCell,
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number,
    quadrants: Map<string, QuadrantSpec>,
    cellsToDisplay: LODResult['cellsToDisplay'],
    cellsWithChildren: Set<string>,
    displayedLeafCells: Set<string>,
    cellsPerLevel: Map<number, number>,
    counters: { culled: number; maxLevel: number }
  ): void {
    const cellKey = this.cellKey(cell);

    // First, check if this cell is visible in the frustum
    if (!this.isCellInFrustum(cell)) {
      counters.culled++;
      // console.log(`Culled cell ${cellKey} at level ${cell.level}`);
      return;
    }

    // At max depth: always render (safety cap)
    if (cell.level >= this.config.maxDepth) {
      this.addCellToResult(cell, quadrants, cellsToDisplay, cellsPerLevel);
      displayedLeafCells.add(cellKey);
      if (cell.level > counters.maxLevel) counters.maxLevel = cell.level;
      return;
    }

    // Small enough on screen: render as leaf
    const screenSpaceSize = this.computeScreenSpaceSize(cell, camera, screenWidth, screenHeight);
    if (screenSpaceSize < this.config.targetScreenSpaceError) {
      this.addCellToResult(cell, quadrants, cellsToDisplay, cellsPerLevel);
      displayedLeafCells.add(cellKey);
      if (cell.level > counters.maxLevel) counters.maxLevel = cell.level;
      return;
    }

    // Cell is too large on screen - subdivide into children
    const children = this.getChildCells(cell);
    const childQuadrantsDisplayed = new Set<number>();

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childKey = this.cellKey(child);

      // Recursively process child
      const prevLeafCount = displayedLeafCells.size;
      this.traverseCell(
        child,
        camera,
        screenWidth,
        screenHeight,
        quadrants,
        cellsToDisplay,
        cellsWithChildren,
        displayedLeafCells,
        cellsPerLevel,
        counters
      );

      // Check if child added any leaves
      if (displayedLeafCells.size > prevLeafCount || displayedLeafCells.has(childKey)) {
        childQuadrantsDisplayed.add(i);
      }
    }

    // If any children were displayed, mark this cell as having children
    if (childQuadrantsDisplayed.size > 0) {
      cellsWithChildren.add(cellKey);

      // If not all children are displayed (some were culled), fill the gaps at this level
      if (childQuadrantsDisplayed.size < 4) {
        // Add quadrants for the culled children at this level
        const color = this.getLevelColor(cell.level);
        const gridSize = getGridSize(cell.level);
        const u0 = -1 + (2 * cell.x) / gridSize;
        const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
        const v0 = -1 + (2 * cell.y) / gridSize;
        const v1 = -1 + (2 * (cell.y + 1)) / gridSize;
        const uMid = (u0 + u1) / 2;
        const vMid = (v0 + v1) / 2;

        // Only add quadrants for children that weren't displayed
        for (let q = 0; q < 4; q++) {
          if (!childQuadrantsDisplayed.has(q)) {
            const quadBounds = this.getQuadrantBounds(q, u0, u1, v0, v1, uMid, vMid);
            const key = `${cell.face}:${cell.level}:${cell.x}:${cell.y}:${q}`;
            quadrants.set(key, {
              key,
              ...quadBounds,
              face: cell.face,
              color,
            });
          }
        }

        // Add to display list with child quadrants info
        cellsToDisplay.push({
          cell,
          color,
          childQuadrants: childQuadrantsDisplayed,
        });

        // Update stats
        const count = cellsPerLevel.get(cell.level) || 0;
        cellsPerLevel.set(cell.level, count + 1);
      }
    }
  }

  /**
   * Adds a cell to the result (as a leaf node to render).
   */
  private addCellToResult(
    cell: QuadTreeCell,
    quadrants: Map<string, QuadrantSpec>,
    cellsToDisplay: LODResult['cellsToDisplay'],
    cellsPerLevel: Map<number, number>
  ): void {
    const color = this.getLevelColor(cell.level);
    const gridSize = getGridSize(cell.level);
    const u0 = -1 + (2 * cell.x) / gridSize;
    const u1 = -1 + (2 * (cell.x + 1)) / gridSize;
    const v0 = -1 + (2 * cell.y) / gridSize;
    const v1 = -1 + (2 * (cell.y + 1)) / gridSize;
    const uMid = (u0 + u1) / 2;
    const vMid = (v0 + v1) / 2;

    // Add all 4 quadrants
    for (let q = 0; q < 4; q++) {
      const quadBounds = this.getQuadrantBounds(q, u0, u1, v0, v1, uMid, vMid);
      const key = `${cell.face}:${cell.level}:${cell.x}:${cell.y}:${q}`;
      quadrants.set(key, {
        key,
        ...quadBounds,
        face: cell.face,
        color,
      });
    }

    // Add to display list
    cellsToDisplay.push({ cell, color });

    // Update stats
    const count = cellsPerLevel.get(cell.level) || 0;
    cellsPerLevel.set(cell.level, count + 1);
  }

  /**
   * Gets the bounds for a specific quadrant (0=BL, 1=BR, 2=TR, 3=TL).
   */
  private getQuadrantBounds(
    quadrant: number,
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    uMid: number,
    vMid: number
  ): { u0: number; u1: number; v0: number; v1: number } {
    switch (quadrant) {
      case 0: return { u0: u0, u1: uMid, v0: v0, v1: vMid };   // BL
      case 1: return { u0: uMid, u1: u1, v0: v0, v1: vMid };   // BR
      case 2: return { u0: uMid, u1: u1, v0: vMid, v1: v1 };   // TR
      case 3: return { u0: u0, u1: uMid, v0: vMid, v1: v1 };   // TL
      default: return { u0, u1, v0, v1 };
    }
  }

  /**
   * Checks if a cell is at least partially within the view frustum.
   * Uses a bounding sphere test for efficiency.
   */
  private isCellInFrustum(cell: QuadTreeCell): boolean {
    // Get cell vertices directly on the sphere (or cube if not in sphere mode)
    const vertices = this.config.sphereMode
      ? computeCellVerticesOnSphere(cell)
      : computeCellVertices(cell);

    // Compute bounding sphere of the cell
    const center = new THREE.Vector3();
    for (const v of vertices) {
      center.add(v);
    }
    center.divideScalar(vertices.length);

    let maxRadius = 0;
    for (const v of vertices) {
      const dist = center.distanceTo(v);
      if (dist > maxRadius) {
        maxRadius = dist;
      }
    }

    // Add a small margin to the radius to prevent popping
    const boundingRadius = maxRadius * 1.1;
    this.tempSphere.set(center, boundingRadius);

    // When the camera is inside the bounding sphere the frustum plane tests are
    // unreliable (the frustum emanates from within the sphere, so side planes can
    // score the center as "outside"). Skip only the frustum check; back-face
    // culling is still valid and must still run to reject the far side of the sphere.
    const cameraInsideSphere = this.lodCameraPosition.distanceTo(center) <= boundingRadius;
    if (!cameraInsideSphere && !this.frustum.intersectsSphere(this.tempSphere)) return false;

    // Back-face culling for sphere using a spherical-cap horizon test.
    //
    // Point-sampling (testing center + corners) fails at minimal altitude: when the camera
    // is directly above a boundary between two cube faces the visible cap is tiny (~2°) and
    // none of the sampled points of any cell fall inside it, so every cell is incorrectly
    // culled and nothing renders.
    //
    // Correct approach: treat the cell as a spherical cap and test whether that cap
    // overlaps the visible cap (the "horizon cap").
    //
    //   Visible cap:  points P on unit sphere with dot(P, C) > 1
    //                 ↔ angular dist from C/|C| < arccos(1/|C|)   [horizon half-angle α]
    //   Cell cap:     center = normalised centroid of vertices, half-angle θ
    //                 (largest angular dist from centre to any corner)
    //
    //   The two caps overlap iff  angular_dist(capCenter, C/|C|) < θ + α
    //   ↔  dot(capCenter, C/|C|) > cos(θ + α)
    //                            = cos(θ)·cos(α) − sin(θ)·sin(α)
    //
    // This handles all camera positions correctly, including above face edges and corners.
    if (this.config.sphereMode) {
      const camPos = this.lodCameraPosition;
      const camDist = camPos.length();
      if (camDist > 1.0) {
        // Cell's spherical bounding cap
        const capCenter = center.clone().normalize(); // unit direction of cell centroid
        let cosCapHalf = 1.0;
        for (const v of vertices) {
          const c = capCenter.dot(v); // v is on unit sphere → c = cos(angular dist)
          if (c < cosCapHalf) cosCapHalf = c;
        }
        const sinCapHalf = Math.sqrt(Math.max(0.0, 1.0 - cosCapHalf * cosCapHalf));

        // Horizon cap from camera
        const cosHorizon = 1.0 / camDist;                                          // cos(α)
        const sinHorizon = Math.sqrt(Math.max(0.0, 1.0 - cosHorizon * cosHorizon)); // sin(α)

        // Cell is entirely below the horizon when the two caps don't overlap
        const cosThreshold = cosCapHalf * cosHorizon - sinCapHalf * sinHorizon; // cos(θ+α)
        const dotCamDir    = capCenter.dot(camPos) / camDist;                   // dot(capCenter, C/|C|)
        if (dotCamDir < cosThreshold) return false;
      }
    }

    return true;
  }

  /**
   * Computes the approximate screen-space size of a cell in pixels.
   * This is used to determine if we need to subdivide further.
   */
  private computeScreenSpaceSize(
    cell: QuadTreeCell,
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number
  ): number {
    // Get cell center and vertices directly on sphere (or cube if not in sphere mode)
    const cellCenter = this.config.sphereMode
      ? computeCellCenterOnSphere(cell)
      : computeCellCenter(cell);
    const vertices = this.config.sphereMode
      ? computeCellVerticesOnSphere(cell)
      : computeCellVertices(cell);

    // Compute the bounding radius of the cell using the farthest corner.
    // Using only vertices[0] underestimates distorted cells (e.g. near cube face edges
    // with the Arvo projection), which produces coarse-LOD rectangular artifacts.
    let cellRadius = 0;
    for (const v of vertices) {
      const d = cellCenter.distanceTo(v);
      if (d > cellRadius) cellRadius = d;
    }

    // Distance from camera to cell center
    const cameraDistance = camera.position.distanceTo(cellCenter);

    // Prevent division by zero
    if (cameraDistance < 0.001) {
      return Infinity; // Cell is essentially at the camera, needs maximum subdivision
    }

    // Compute projected size using perspective projection
    // The projected size in normalized device coordinates is approximately:
    // size_ndc = (cellRadius / distance) / tan(fov/2)
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const halfFovTan = Math.tan(fovRad / 2);

    // Projected size in NDC space (-1 to 1)
    const sizeNDC = (cellRadius / cameraDistance) / halfFovTan;

    // Convert to screen pixels (using the smaller dimension for a conservative estimate)
    const screenSize = sizeNDC * Math.min(screenWidth, screenHeight);

    return screenSize;
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
   * Gets the color for a given level.
   */
  private getLevelColor(level: number): number {
    return LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)];
  }

  /**
   * Generates a unique key for a cell.
   */
  private cellKey(cell: QuadTreeCell): string {
    return `${cell.face}:${cell.level}:${cell.x}:${cell.y}`;
  }
}

