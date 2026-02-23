import { Vector3 } from 'three';

/**
 * Represents a cell (hexagon or pentagon) in the IcoTree.
 *
 * Subdivision creates:
 * - For hexagons: 7 children (1 center hexagon + 6 peripheral hexagons)
 * - For pentagons: 6 children (1 center pentagon + 5 peripheral hexagons)
 *
 * Peripheral children are SHARED with neighbor cells. A peripheral at vertex V
 * is shared by all cells (typically 3) that meet at V.
 *
 * The center child is only created when ALL peripheral children exist.
 * This happens when all cells sharing this cell's vertices have subdivided.
 */
export class IcoCell {
  /** Center point of the cell on the unit sphere */
  readonly center: Vector3;

  /** Vertices of the cell boundary (5 for pentagon, 6 for hexagon) */
  readonly vertices: Vector3[];

  /** Parent cell, null for root cells */
  readonly parent: IcoCell | null;

  /** Depth in the tree (0 for root cells) */
  readonly depth: number;

  /** Whether this is a center child (true) or peripheral child (false) */
  readonly isCenterChild: boolean;

  /** Child index within parent (-1 for root, 0..N-1 for peripheral, N for center) */
  readonly childIndex: number;

  /** Unique identifier */
  readonly id: number;

  /** Static counter for IDs */
  private static _idCounter = 0;

  /**
   * Neighbor cells at each vertex.
   * vertexNeighbors[i] contains the other cells (typically 2) that share vertex[i].
   * Set up by IcoTree after construction.
   */
  vertexNeighbors: IcoCell[][] = [];

  /**
   * Whether this cell has initiated subdivision (computed midpoints).
   */
  private _subdivisionInitiated = false;

  /**
   * Midpoints from center to each vertex (computed on subdivision).
   */
  private _midpoints: Vector3[] | null = null;

  /**
   * Children array: indices 0..N-1 are peripheral children, index N is center child.
   * Null entries mean that child doesn't exist yet.
   */
  private _children: (IcoCell | null)[] | null = null;

  constructor(
    center: Vector3,
    vertices: Vector3[],
    parent: IcoCell | null = null,
    childIndex: number = -1,
    isCenterChild: boolean = false
  ) {
    this.id = IcoCell._idCounter++;
    this.center = center.clone().normalize();
    this.vertices = vertices.map(v => v.clone().normalize());
    this.parent = parent;
    this.depth = parent ? parent.depth + 1 : 0;
    this.childIndex = childIndex;
    this.isCenterChild = isCenterChild;
  }

  /** Returns true if this cell is a pentagon. */
  get isPentagon(): boolean {
    return this.vertices.length === 5;
  }

  /** Returns true if this cell is a hexagon. */
  get isHexagon(): boolean {
    return this.vertices.length === 6;
  }

  /** Returns the number of sides. */
  get sideCount(): number {
    return this.vertices.length;
  }

  /** Returns whether subdivision has been initiated. */
  get subdivisionInitiated(): boolean {
    return this._subdivisionInitiated;
  }

  /** Returns the midpoints (null if subdivision not initiated). */
  get midpoints(): Vector3[] | null {
    return this._midpoints;
  }

  /** Returns true if the center child exists (fully subdivided). */
  get isFullySubdivided(): boolean {
    if (!this._children) return false;
    return this._children[this.sideCount] !== null;
  }

  /** Returns true if this is a leaf (no center child). */
  get isLeaf(): boolean {
    return !this.isFullySubdivided;
  }

  /** Returns the number of children currently created. */
  get childCount(): number {
    if (!this._children) return 0;
    return this._children.filter(c => c !== null).length;
  }

  /** Returns the center child, or null if not yet created. */
  get centerChild(): IcoCell | null {
    if (!this._children) return null;
    return this._children[this.sideCount];
  }

  /** Returns the peripheral child at the given vertex index, or null. */
  getPeripheral(vertexIndex: number): IcoCell | null {
    if (!this._children) return null;
    return this._children[vertexIndex];
  }

  /** Returns all existing children. */
  get children(): IcoCell[] {
    if (!this._children) return [];
    return this._children.filter(c => c !== null) as IcoCell[];
  }

  /**
   * Initiates subdivision of this cell.
   * This computes midpoints and triggers peripheral/center creation where possible.
   */
  subdivide(): void {
    if (this._subdivisionInitiated) return;
    this._subdivisionInitiated = true;

    // Compute midpoints from center to each vertex
    this._midpoints = this.vertices.map(v => {
      const mid = new Vector3().addVectors(this.center, v).multiplyScalar(0.5);
      return mid.normalize();
    });

    // Initialize children array
    const n = this.sideCount;
    this._children = new Array(n + 1).fill(null);

    // Try to create peripheral children at each vertex
    for (let i = 0; i < n; i++) {
      this.tryCreatePeripheral(i);
    }

    // Try to create center child
    this.tryCreateCenter();
  }

  /**
   * Attempts to create the peripheral child at the given vertex index.
   * Only succeeds if all cells sharing that vertex have subdivided.
   */
  private tryCreatePeripheral(vertexIndex: number): void {
    if (!this._children || this._children[vertexIndex] !== null) return;

    const neighbors = this.vertexNeighbors[vertexIndex] || [];

    // Check if all neighbors sharing this vertex have initiated subdivision
    // for (const neighbor of neighbors) {
    //   if (!neighbor._subdivisionInitiated) {
    //     return; // Can't create peripheral yet
    //   }
    // }

    // All cells sharing this vertex have subdivided - create the peripheral
    const peripheral = this.createPeripheralAt(vertexIndex, neighbors);

    // Register the peripheral with this cell and all neighbors
    this._children[vertexIndex] = peripheral;

    for (const neighbor of neighbors) {
      const neighborVertexIdx = this.findSharedVertexIndex(neighbor, vertexIndex);
      if (neighborVertexIdx >= 0 && neighbor._children) {
        neighbor._children[neighborVertexIdx] = peripheral;
        // Try to create neighbor's center child
        neighbor.tryCreateCenter();
      }
    }

    // Try to create our center child
    this.tryCreateCenter();
  }

  /**
   * Creates the peripheral cell at the given vertex.
   * The peripheral is centered on the original vertex and has vertices
   * formed by midpoints from all cells sharing that vertex.
   */
  private createPeripheralAt(vertexIndex: number, neighbors: IcoCell[]): IcoCell {
    const vertex = this.vertices[vertexIndex];
    const n = this.sideCount;

    // Collect vertices for the peripheral hexagon
    // From this cell: the two midpoints adjacent to this vertex
    const peripheralVertices: Vector3[] = [];

    // Add midpoints from this cell (in order around the vertex)
    // m[vertexIndex] is the midpoint toward this vertex
    // m[(vertexIndex + n - 1) % n] is the midpoint toward the previous vertex
    const mThis1 = this._midpoints![vertexIndex];
    const mThis2 = this._midpoints![(vertexIndex + n - 1) % n];

    peripheralVertices.push(mThis1, mThis2);

    // Add midpoints from each neighbor
    for (const neighbor of neighbors) {
      const neighborVertexIdx = this.findSharedVertexIndex(neighbor, vertexIndex);
      if (neighborVertexIdx >= 0 && neighbor._midpoints) {
        const nn = neighbor.sideCount;
        const mNeighbor1 = neighbor._midpoints[neighborVertexIdx];
        const mNeighbor2 = neighbor._midpoints[(neighborVertexIdx + nn - 1) % nn];
        peripheralVertices.push(mNeighbor1, mNeighbor2);
      }
    }

    // Sort vertices around the center (vertex) to form proper polygon
    const sortedVertices = this.sortVerticesAroundPoint(vertex, peripheralVertices);

    return new IcoCell(
      vertex,
      sortedVertices,
      this,
      vertexIndex,
      false
    );
  }

  /**
   * Sorts vertices by angle around a center point.
   */
  private sortVerticesAroundPoint(center: Vector3, vertices: Vector3[]): Vector3[] {
    // Create reference frame at center
    const up = center.clone().normalize();
    const right = new Vector3();

    if (Math.abs(up.x) < 0.9) {
      right.crossVectors(up, new Vector3(1, 0, 0)).normalize();
    } else {
      right.crossVectors(up, new Vector3(0, 1, 0)).normalize();
    }
    const forward = new Vector3().crossVectors(right, up);

    // Sort by angle
    return vertices.slice().sort((a, b) => {
      const va = a.clone().sub(center);
      const vb = b.clone().sub(center);
      const angleA = Math.atan2(va.dot(forward), va.dot(right));
      const angleB = Math.atan2(vb.dot(forward), vb.dot(right));
      return angleA - angleB;
    });
  }

  /**
   * Finds the vertex index in the neighbor that corresponds to our vertex.
   */
  private findSharedVertexIndex(neighbor: IcoCell, ourVertexIndex: number): number {
    const ourVertex = this.vertices[ourVertexIndex];
    const tolerance = 1e-6;

    for (let i = 0; i < neighbor.vertices.length; i++) {
      if (neighbor.vertices[i].distanceTo(ourVertex) < tolerance) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Attempts to create the center child.
   * Only succeeds if all peripheral children exist.
   */
  private tryCreateCenter(): void {
    if (!this._children) return;

    const n = this.sideCount;

    // Already has center?
    if (this._children[n] !== null) return;

    // Check if all peripherals exist
    for (let i = 0; i < n; i++) {
      if (this._children[i] === null) return;
    }

    // All peripherals exist - create center child
    // Center child has same center as parent, vertices are the midpoints
    this._children[n] = new IcoCell(
      this.center,
      this._midpoints!,
      this,
      n,
      true
    );
  }

  /**
   * Collapses this cell (removes all children).
   * Note: This doesn't handle shared peripherals properly - use IcoTree.collapseAll() instead.
   */
  collapse(): void {
    this._children = null;
    this._midpoints = null;
    this._subdivisionInitiated = false;
  }

  /**
   * Tests if a point on the unit sphere is inside this cell.
   *
   * Computes arc length from centroid to point and compares with
   * arc lengths from centroid to vertices.
   */
  containsPoint(point: Vector3): boolean {
    // Hemisphere check: point must be on same side of sphere as cell center
    if (point.dot(this.center) <= 0) {
      return false;
    }

    // Normalize the point
    const normalizedPoint = point.clone().normalize();
    const centroid = this.center; // Already normalized

    // Arc length from centroid to point: arccos(dot product)
    const pointArcLength = Math.acos(Math.min(1, Math.max(-1, centroid.dot(normalizedPoint))));

    // Compare with arc length to each vertex
    // Point is inside if closer to centroid than all vertices
    for (const vertex of this.vertices) {
      const vertexArcLength = Math.acos(Math.min(1, Math.max(-1, centroid.dot(vertex))));
      if (pointArcLength >= vertexArcLength) {
        return false;
      }
    }

    return true;
  }

  /**
   * Finds the leaf cell containing the given point.
   */
  findLeaf(point: Vector3): IcoCell | null {
    if (!this.containsPoint(point)) {
      return null;
    }
    console.log("FIND LEAF Id: ", this.id, "Depth: ", this.depth);

    // If we have a center child, check all children
    if (this.isFullySubdivided && this._children) {
      for (const child of this._children) {
        if (child) {
          const result = child.findLeaf(point);
          if (result) return result;
        }
      }
    }

    // Either no children or point is in this cell
    return this;
  }

  /**
   * Generator that yields all leaf cells in this subtree.
   */
  *leaves(): Generator<IcoCell> {
    if (this.isLeaf) {
      yield this;
    } else if (this._children) {
      for (const child of this._children) {
        if (child) {
          yield* child.leaves();
        }
      }
    }
  }

  /**
   * Generator that yields all cells in this subtree.
   */
  *traverse(): Generator<IcoCell> {
    yield this;
    if (this._children) {
      for (const child of this._children) {
        if (child) {
          yield* child.traverse();
        }
      }
    }
  }

  /** Resets the ID counter. */
  static resetIdCounter(): void {
    IcoCell._idCounter = 0;
  }
}
