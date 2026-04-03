/**
 * View Frustum-based Level of Detail (LOD) system for quadtree sphere rendering.
 *
 * Determines which quadtree cells to render based on:
 * 1. View frustum culling  – only cells visible to the camera
 * 2. Screen-space error   – subdivide cells that appear large on screen
 * 3. Back-face culling    – discard cells on the far side of the sphere
 *
 * The output is purely spatial (UV bounds, face, level).
 * Color assignment and visualization are the caller's responsibility.
 */

import * as THREE from 'three';
import { QuadTreeCell, CubeFace, getGridSize } from './QuadTreeEncoding';
import {
  computeCellCenter,
  computeCellVertices,
  computeCellCenterOnSphere,
  computeCellVerticesOnSphere,
} from './QuadTreeGeometry';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * A single renderable quadrant — one quarter of a QuadTree cell.
 *
 * Key format: "face:level:x:y:quadrantIndex"  (quadrant 0=BL, 1=BR, 2=TR, 3=TL)
 *
 * Contains only spatial data; presentation properties (colors, materials)
 * are the responsibility of the consuming renderer.
 */
export interface QuadrantSpec {
  key: string;
  face: number;
  level: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Configuration for the view frustum LOD system.
 */
export interface LODConfig {
  /** Maximum depth level — safety cap (default: 20) */
  maxDepth: number;
  /** Target screen-space error in pixels — smaller = more detail (default: 64) */
  targetScreenSpaceError: number;
  /** Extra margin around the frustum to prevent edge popping (default: 0.1) */
  frustumMargin: number;
  /** Use sphere geometry for culling and screen-space computation (default: true) */
  sphereMode: boolean;
}

const DEFAULT_CONFIG: LODConfig = {
  maxDepth: 20,
  targetScreenSpaceError: 64,
  frustumMargin: 0.1,
  sphereMode: true,
};

/**
 * Result of an LOD computation pass.
 */
export interface LODResult {
  /** Map of quadrant key → QuadrantSpec ready for rendering */
  quadrants: Map<string, QuadrantSpec>;
  stats: {
    totalCells: number;
    cellsPerLevel: Map<number, number>;
    culledCells: number;
    maxLevelReached: number;
  };
}

// ── Implementation ────────────────────────────────────────────────────────────

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

  setConfig(config: Partial<LODConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): LODConfig {
    return { ...this.config };
  }

  /**
   * Computes which cells to render for the given camera and viewport dimensions.
   */
  computeLOD(
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number
  ): LODResult {
    this.updateFrustum(camera);
    this.lodCameraPosition.copy(camera.position);

    const quadrants = new Map<string, QuadrantSpec>();
    const cellsPerLevel = new Map<number, number>();
    let culledCells = 0;
    let maxLevelReached = 0;

    const cellsWithChildren = new Set<string>();
    const addedLeafCells = new Set<string>();

    for (let face = 0; face < 6; face++) {
      const root: QuadTreeCell = { face: face as CubeFace, level: 0, x: 0, y: 0 };
      this.traverseCell(
        root, camera, screenWidth, screenHeight,
        quadrants, cellsWithChildren, addedLeafCells,
        cellsPerLevel, { culled: 0, maxLevel: 0 }
      );
      culledCells += 0; // counters per face could be aggregated here if needed
    }

    for (const level of cellsPerLevel.keys()) {
      if (level > maxLevelReached) maxLevelReached = level;
    }

    return {
      quadrants,
      stats: { totalCells: quadrants.size / 4, cellsPerLevel, culledCells, maxLevelReached },
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private updateFrustum(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    if (this.config.frustumMargin > 0) {
      for (const plane of this.frustum.planes) {
        plane.constant += this.config.frustumMargin;
      }
    }
  }

  private traverseCell(
    cell: QuadTreeCell,
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number,
    quadrants: Map<string, QuadrantSpec>,
    cellsWithChildren: Set<string>,
    addedLeafCells: Set<string>,
    cellsPerLevel: Map<number, number>,
    counters: { culled: number; maxLevel: number }
  ): void {
    const key = this.cellKey(cell);

    if (!this.isCellInFrustum(cell)) {
      counters.culled++;
      return;
    }

    if (cell.level >= this.config.maxDepth) {
      this.addLeaf(cell, quadrants, cellsPerLevel);
      addedLeafCells.add(key);
      if (cell.level > counters.maxLevel) counters.maxLevel = cell.level;
      return;
    }

    const screenSize = this.computeScreenSpaceSize(cell, camera, screenWidth, screenHeight);
    if (screenSize < this.config.targetScreenSpaceError) {
      this.addLeaf(cell, quadrants, cellsPerLevel);
      addedLeafCells.add(key);
      if (cell.level > counters.maxLevel) counters.maxLevel = cell.level;
      return;
    }

    // Cell is too large on screen — recurse into children
    const children = this.getChildCells(cell);
    const addedChildQuadrants = new Set<number>();

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childKey = this.cellKey(child);
      const prevLeafCount = addedLeafCells.size;

      this.traverseCell(
        child, camera, screenWidth, screenHeight,
        quadrants, cellsWithChildren, addedLeafCells,
        cellsPerLevel, counters
      );

      if (addedLeafCells.size > prevLeafCount || addedLeafCells.has(childKey)) {
        addedChildQuadrants.add(i);
      }
    }

    if (addedChildQuadrants.size > 0) {
      cellsWithChildren.add(key);

      // Fill gaps left by frustum-culled children
      if (addedChildQuadrants.size < 4) {
        const { u0, u1, v0, v1 } = this.cellUVBounds(cell);
        const uMid = (u0 + u1) / 2;
        const vMid = (v0 + v1) / 2;

        for (let q = 0; q < 4; q++) {
          if (!addedChildQuadrants.has(q)) {
            const bounds = this.quadrantBounds(q, u0, u1, v0, v1, uMid, vMid);
            const qKey = `${cell.face}:${cell.level}:${cell.x}:${cell.y}:${q}`;
            quadrants.set(qKey, { key: qKey, face: cell.face, level: cell.level, ...bounds });
          }
        }

        const count = cellsPerLevel.get(cell.level) || 0;
        cellsPerLevel.set(cell.level, count + 1);
      }
    }
  }

  private addLeaf(
    cell: QuadTreeCell,
    quadrants: Map<string, QuadrantSpec>,
    cellsPerLevel: Map<number, number>
  ): void {
    const { u0, u1, v0, v1 } = this.cellUVBounds(cell);
    const uMid = (u0 + u1) / 2;
    const vMid = (v0 + v1) / 2;

    for (let q = 0; q < 4; q++) {
      const bounds = this.quadrantBounds(q, u0, u1, v0, v1, uMid, vMid);
      const key = `${cell.face}:${cell.level}:${cell.x}:${cell.y}:${q}`;
      quadrants.set(key, { key, face: cell.face, level: cell.level, ...bounds });
    }

    const count = cellsPerLevel.get(cell.level) || 0;
    cellsPerLevel.set(cell.level, count + 1);
  }

  private cellUVBounds(cell: QuadTreeCell): { u0: number; u1: number; v0: number; v1: number } {
    const gridSize = getGridSize(cell.level);
    return {
      u0: -1 + (2 * cell.x) / gridSize,
      u1: -1 + (2 * (cell.x + 1)) / gridSize,
      v0: -1 + (2 * cell.y) / gridSize,
      v1: -1 + (2 * (cell.y + 1)) / gridSize,
    };
  }

  private quadrantBounds(
    q: number, u0: number, u1: number, v0: number, v1: number, uMid: number, vMid: number
  ): { u0: number; u1: number; v0: number; v1: number } {
    switch (q) {
      case 0: return { u0,    u1: uMid, v0,    v1: vMid }; // BL
      case 1: return { u0: uMid, u1,   v0,    v1: vMid }; // BR
      case 2: return { u0: uMid, u1,   v0: vMid, v1 };    // TR
      case 3: return { u0,    u1: uMid, v0: vMid, v1 };   // TL
      default: return { u0, u1, v0, v1 };
    }
  }

  /**
   * Tests whether a cell overlaps the view frustum.
   * Combines a frustum bounding-sphere test with a spherical-cap back-face culling test.
   */
  private isCellInFrustum(cell: QuadTreeCell): boolean {
    const vertices = this.config.sphereMode
      ? computeCellVerticesOnSphere(cell)
      : computeCellVertices(cell);

    // Bounding sphere of the cell
    const center = new THREE.Vector3();
    for (const v of vertices) center.add(v);
    center.divideScalar(vertices.length);

    let maxRadius = 0;
    for (const v of vertices) {
      const d = center.distanceTo(v);
      if (d > maxRadius) maxRadius = d;
    }
    const boundingRadius = maxRadius * 1.1;
    this.tempSphere.set(center, boundingRadius);

    // Skip frustum test when camera is inside the bounding sphere
    // (frustum plane tests become unreliable in that case)
    const cameraInsideSphere = this.lodCameraPosition.distanceTo(center) <= boundingRadius;
    if (!cameraInsideSphere && !this.frustum.intersectsSphere(this.tempSphere)) return false;

    // Spherical-cap horizon test (back-face culling for a sphere).
    //
    // Two caps overlap iff  dot(capCenter, C/|C|) > cos(θ+α)
    //   where α = arccos(1/|C|)  (horizon half-angle)
    //         θ = cell cap half-angle
    if (this.config.sphereMode) {
      const camDist = this.lodCameraPosition.length();
      if (camDist > 1.0) {
        const capCenter = center.clone().normalize();
        let cosCapHalf = 1.0;
        for (const v of vertices) {
          const c = capCenter.dot(v);
          if (c < cosCapHalf) cosCapHalf = c;
        }
        const sinCapHalf = Math.sqrt(Math.max(0, 1 - cosCapHalf * cosCapHalf));
        const cosHorizon  = 1.0 / camDist;
        const sinHorizon  = Math.sqrt(Math.max(0, 1 - cosHorizon * cosHorizon));
        const cosThreshold = cosCapHalf * cosHorizon - sinCapHalf * sinHorizon;
        const dotCamDir    = capCenter.dot(this.lodCameraPosition) / camDist;
        if (dotCamDir < cosThreshold) return false;
      }
    }

    return true;
  }

  /**
   * Estimates the screen-space size of a cell in pixels.
   */
  private computeScreenSpaceSize(
    cell: QuadTreeCell,
    camera: THREE.PerspectiveCamera,
    screenWidth: number,
    screenHeight: number
  ): number {
    const cellCenter = this.config.sphereMode
      ? computeCellCenterOnSphere(cell)
      : computeCellCenter(cell);
    const vertices = this.config.sphereMode
      ? computeCellVerticesOnSphere(cell)
      : computeCellVertices(cell);

    let cellRadius = 0;
    for (const v of vertices) {
      const d = cellCenter.distanceTo(v);
      if (d > cellRadius) cellRadius = d;
    }

    const cameraDistance = camera.position.distanceTo(cellCenter);
    if (cameraDistance < 0.001) return Infinity;

    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    return (cellRadius / cameraDistance / halfFovTan) * Math.min(screenWidth, screenHeight);
  }

  private getChildCells(cell: QuadTreeCell): QuadTreeCell[] {
    const cl = cell.level + 1;
    const cx = cell.x * 2;
    const cy = cell.y * 2;
    return [
      { face: cell.face, level: cl, x: cx,     y: cy },
      { face: cell.face, level: cl, x: cx + 1, y: cy },
      { face: cell.face, level: cl, x: cx + 1, y: cy + 1 },
      { face: cell.face, level: cl, x: cx,     y: cy + 1 },
    ];
  }

  private cellKey(cell: QuadTreeCell): string {
    return `${cell.face}:${cell.level}:${cell.x}:${cell.y}`;
  }
}
