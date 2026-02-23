import { Vector3 } from 'three';
import { IcoCell } from './IcoCell';
import {
  createIcosahedronVertices,
  computeFaceCenters,
  computeVertexToFaces,
} from '../geometry/Icosahedron';

/**
 * IcoTree: A hierarchical structure of hexagonal/pentagonal cells on a sphere.
 *
 * The tree is based on the dual of an icosahedron:
 * - 12 root cells (pentagons), one for each icosahedron vertex
 * - Each cell can be subdivided into children
 * - Peripheral children are shared between cells meeting at a vertex
 * - Center child is created only when all peripheral children exist
 */
export class IcoTree {
  /** The 12 icosahedron vertices (centers of root pentagons) */
  readonly icoVertices: Vector3[];

  /** The 20 face centers (vertices of root pentagons) */
  readonly faceCenters: Vector3[];

  /** The 12 root cells (pentagons) */
  readonly roots: IcoCell[];

  /** Map from cell ID to cell */
  private cellMap: Map<number, IcoCell> = new Map();

  constructor() {
    this.icoVertices = createIcosahedronVertices();
    this.faceCenters = computeFaceCenters(this.icoVertices);
    this.roots = this.createRootCells();

    // Register roots
    for (const root of this.roots) {
      this.cellMap.set(root.id, root);
    }

    // Set up vertex neighbor relationships
    this.setupVertexNeighbors();
  }

  /**
   * Creates the 12 root pentagonal cells.
   */
  private createRootCells(): IcoCell[] {
    const vertexToFaces = computeVertexToFaces();
    const cells: IcoCell[] = [];

    for (let vi = 0; vi < 12; vi++) {
      const center = this.icoVertices[vi];
      const faceIndices = vertexToFaces.get(vi)!;

      // Sort faces by angle around the vertex
      const sortedFaceIndices = this.sortFacesAroundVertex(vi, faceIndices);
      const vertices = sortedFaceIndices.map(fi => this.faceCenters[fi]);

      const cell = new IcoCell(center, vertices);
      cells.push(cell);
    }

    return cells;
  }

  /**
   * Sorts face indices by angle around a vertex.
   */
  private sortFacesAroundVertex(vertexIndex: number, faceIndices: number[]): number[] {
    const center = this.icoVertices[vertexIndex];
    const up = center.clone().normalize();
    const right = new Vector3();

    if (Math.abs(up.x) < 0.9) {
      right.crossVectors(up, new Vector3(1, 0, 0)).normalize();
    } else {
      right.crossVectors(up, new Vector3(0, 1, 0)).normalize();
    }
    const forward = new Vector3().crossVectors(right, up);

    return faceIndices.slice().sort((a, b) => {
      const ca = this.faceCenters[a].clone().sub(center);
      const cb = this.faceCenters[b].clone().sub(center);
      const angleA = Math.atan2(ca.dot(forward), ca.dot(right));
      const angleB = Math.atan2(cb.dot(forward), cb.dot(right));
      return angleA - angleB;
    });
  }

  /**
   * Sets up vertex neighbor relationships for all root cells.
   * For each vertex of each cell, finds the other cells sharing that vertex.
   */
  private setupVertexNeighbors(): void {
    // Build a map from vertex position to cells that have that vertex
    const vertexToCells = new Map<string, { cell: IcoCell; vertexIndex: number }[]>();

    const vertexKey = (v: Vector3) =>
      `${v.x.toFixed(8)},${v.y.toFixed(8)},${v.z.toFixed(8)}`;

    for (const cell of this.roots) {
      for (let vi = 0; vi < cell.vertices.length; vi++) {
        const key = vertexKey(cell.vertices[vi]);
        if (!vertexToCells.has(key)) {
          vertexToCells.set(key, []);
        }
        vertexToCells.get(key)!.push({ cell, vertexIndex: vi });
      }
    }

    // For each cell and vertex, set up the neighbor list
    for (const cell of this.roots) {
      cell.vertexNeighbors = [];

      for (let vi = 0; vi < cell.vertices.length; vi++) {
        const key = vertexKey(cell.vertices[vi]);
        const cellsAtVertex = vertexToCells.get(key) || [];

        // Filter out this cell to get neighbors
        const neighbors = cellsAtVertex
          .filter(entry => entry.cell !== cell)
          .map(entry => entry.cell);

        cell.vertexNeighbors.push(neighbors);
      }
    }
  }

  /**
   * Recursively sets up vertex neighbors for child cells.
   * Called after cells are subdivided.
   */
  setupChildVertexNeighbors(cell: IcoCell): void {
    if (!cell.children.length) return;

    const allLeaves = Array.from(this.leaves());

    // Build vertex to cells map for all current leaves
    const vertexToCells = new Map<string, { cell: IcoCell; vertexIndex: number }[]>();

    const vertexKey = (v: Vector3) =>
      `${v.x.toFixed(8)},${v.y.toFixed(8)},${v.z.toFixed(8)}`;

    for (const leaf of allLeaves) {
      for (let vi = 0; vi < leaf.vertices.length; vi++) {
        const key = vertexKey(leaf.vertices[vi]);
        if (!vertexToCells.has(key)) {
          vertexToCells.set(key, []);
        }
        vertexToCells.get(key)!.push({ cell: leaf, vertexIndex: vi });
      }
    }

    // Set up neighbors for each leaf
    for (const leaf of allLeaves) {
      leaf.vertexNeighbors = [];

      for (let vi = 0; vi < leaf.vertices.length; vi++) {
        const key = vertexKey(leaf.vertices[vi]);
        const cellsAtVertex = vertexToCells.get(key) || [];

        const neighbors = cellsAtVertex
          .filter(entry => entry.cell !== leaf)
          .map(entry => entry.cell);

        leaf.vertexNeighbors.push(neighbors);
      }
    }
  }

  /**
   * Gets all leaf cells.
   */
  *leaves(): Generator<IcoCell> {
    for (const root of this.roots) {
      yield* root.leaves();
    }
  }

  /**
   * Gets all cells in the tree.
   */
  *traverse(): Generator<IcoCell> {
    for (const root of this.roots) {
      yield* root.traverse();
    }
  }

  /**
   * Finds the leaf cell containing a point on the unit sphere.
   */
  findLeaf(point: Vector3): IcoCell | null {
    const normalized = point.clone().normalize();

    for (const root of this.roots) {
      const result = root.findLeaf(normalized);
      if (result) return result;
    }

    return null;
  }

  /**
   * Counts total cells.
   */
  countCells(): number {
    let count = 0;
    for (const _ of this.traverse()) {
      count++;
    }
    return count;
  }

  /**
   * Counts leaf cells.
   */
  countLeaves(): number {
    let count = 0;
    for (const _ of this.leaves()) {
      count++;
    }
    return count;
  }

  /**
   * Counts cell types among leaves.
   */
  countCellTypes(): { pentagons: number; hexagons: number } {
    let pentagons = 0;
    let hexagons = 0;

    for (const cell of this.leaves()) {
      if (cell.isPentagon) pentagons++;
      else hexagons++;
    }

    return { pentagons, hexagons };
  }

  /**
   * Gets a cell by ID.
   */
  getCell(id: number): IcoCell | undefined {
    return this.cellMap.get(id);
  }

  /**
   * Collapses all cells back to roots.
   */
  collapseAll(): void {
    for (const root of this.roots) {
      root.collapse();
    }
    // Re-setup vertex neighbors for roots
    this.setupVertexNeighbors();
  }

  /**
   * Subdivides a cell and updates neighbor relationships.
   * This is the main entry point for subdivision.
   */
  subdivideCell(cell: IcoCell): void {
    console.log("Subdividing cell ID:", cell.id, "Depth:", cell.depth);
    cell.subdivide();

    // After subdivision, we need to update vertex neighbors for any new cells
    // This is called after each subdivision to keep neighbors up to date
    this.rebuildAllVertexNeighbors();
  }

  /**
   * Rebuilds vertex neighbor relationships for all leaves.
   */
  rebuildAllVertexNeighbors(): void {
    const allLeaves = Array.from(this.leaves());

    const vertexToCells = new Map<string, { cell: IcoCell; vertexIndex: number }[]>();

    const vertexKey = (v: Vector3) =>
      `${v.x.toFixed(8)},${v.y.toFixed(8)},${v.z.toFixed(8)}`;

    for (const leaf of allLeaves) {
      for (let vi = 0; vi < leaf.vertices.length; vi++) {
        const key = vertexKey(leaf.vertices[vi]);
        if (!vertexToCells.has(key)) {
          vertexToCells.set(key, []);
        }
        vertexToCells.get(key)!.push({ cell: leaf, vertexIndex: vi });
      }
    }

    for (const leaf of allLeaves) {
      leaf.vertexNeighbors = [];

      for (let vi = 0; vi < leaf.vertices.length; vi++) {
        const key = vertexKey(leaf.vertices[vi]);
        const cellsAtVertex = vertexToCells.get(key) || [];

        const neighbors = cellsAtVertex
          .filter(entry => entry.cell !== leaf)
          .map(entry => entry.cell);

        leaf.vertexNeighbors.push(neighbors);
      }
    }
  }
}
