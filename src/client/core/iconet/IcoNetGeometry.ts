/**
 * Icosahedral Net Geometry
 *
 * Generates the vertex and face data for a 2D icosahedral net layout.
 * The net consists of 20 equilateral triangles arranged in 4 rows:
 *   - Row 0: 5 up-pointing triangles (top cap)
 *   - Row 1: 10 alternating triangles (middle band)
 *   - Row 2: 5 down-pointing triangles (bottom cap)
 *
 * Vertices are shared between adjacent triangles for efficient indexing.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type TriangleFace = [number, number, number];

export interface IcoNetConfig {
  /** Side length of equilateral triangles (default: 1.0) */
  triangleSize?: number;
  /** Number of columns in top/bottom rows (default: 5) */
  numCols?: number;
}

/**
 * Computes the height of an equilateral triangle given its side length.
 */
export function triangleHeight(sideLength: number): number {
  return (sideLength * Math.sqrt(3)) / 2;
}

/**
 * Icosahedral net geometry data.
 * Contains the computed vertices and faces for the 2D layout.
 */
export class IcoNetGeometry {
  /** 2D vertex positions */
  readonly vertices: Vec2[];

  /** Triangle faces as index triplets with consistent winding */
  readonly faces: TriangleFace[];

  /** Side length of equilateral triangles */
  readonly triangleSize: number;

  /** Number of columns in top/bottom rows */
  readonly numCols: number;

  /** Height of each equilateral triangle */
  readonly height: number;

  /** Index where each row of vertices starts */
  readonly rowStarts: { row0: number; row1: number; row2: number; row3: number };

  /** Index ranges for face rows */
  readonly faceRanges: { topEnd: number; midEnd: number; bottomEnd: number };

  constructor(config: IcoNetConfig = {}) {
    this.triangleSize = config.triangleSize ?? 1.0;
    this.numCols = config.numCols ?? 5;
    this.height = triangleHeight(this.triangleSize);

    this.vertices = [];
    this.faces = [];

    this.rowStarts = this.computeRowStarts();
    this.buildVertices();
    this.buildFaces();
    this.faceRanges = {
      topEnd: this.numCols,
      midEnd: this.numCols + this.numCols * 2,
      bottomEnd: this.numCols * 4,
    };
  }

  private computeRowStarts() {
    const row0 = 0;
    const row1 = this.numCols;
    const row2 = this.numCols + (this.numCols + 1);
    const row3 = this.numCols + (this.numCols + 1) + (this.numCols + 1);
    return { row0, row1, row2, row3 };
  }

  /**
   * Builds the shared vertex array.
   *
   * Vertex layout (4 rows):
   *   Row 0: numCols vertices (apexes of top-row up-triangles)
   *   Row 1: numCols+1 vertices (shared between top and middle rows)
   *   Row 2: numCols+1 vertices (shared between middle and bottom rows)
   *   Row 3: numCols vertices (apexes of bottom-row down-triangles)
   */
  private buildVertices(): void {
    const s = this.triangleSize;
    const h = this.height;
    const offsetX = -(this.numCols * s) / 2;

    // Row 0: numCols vertices (top apexes) at y = -h
    for (let i = 0; i < this.numCols; i++) {
      this.vertices.push({ x: offsetX + i * s, y: -h });
    }

    // Row 1: numCols+1 vertices at y = 0
    // Offset by -s/2 from row 0
    for (let i = 0; i < this.numCols + 1; i++) {
      this.vertices.push({ x: offsetX - s / 2 + i * s, y: 0 });
    }

    // Row 2: numCols+1 vertices at y = h
    for (let i = 0; i < this.numCols + 1; i++) {
      this.vertices.push({ x: offsetX + i * s, y: h });
    }

    // Row 3: numCols vertices (bottom apexes) at y = 2h
    for (let i = 0; i < this.numCols; i++) {
      this.vertices.push({ x: offsetX + s / 2 + i * s, y: 2 * h });
    }
  }

  /**
   * Builds the face index array.
   * Creates triangles with consistent counter-clockwise winding.
   */
  private buildFaces(): void {
    const { row0, row1, row2, row3 } = this.rowStarts;

    // Top row: numCols up-pointing triangles
    for (let i = 0; i < this.numCols; i++) {
      const apex = row0 + i;
      const baseLeft = row1 + i;
      const baseRight = row1 + i + 1;
      this.faces.push([apex, baseLeft, baseRight]);
    }

    // Middle row: alternating triangles
    for (let i = 0; i < this.numCols; i++) {
      // Down-pointing: base at row1, apex at row2
      const downApex = row2 + i;
      const downBaseLeft = row1 + i;
      const downBaseRight = row1 + i + 1;
      this.faces.push([downApex, downBaseRight, downBaseLeft]);

      // Up-pointing: apex at row1, base at row2
      const upApex = row1 + i + 1;
      const upBaseLeft = row2 + i;
      const upBaseRight = row2 + i + 1;
      this.faces.push([upApex, upBaseLeft, upBaseRight]);
    }

    // Bottom row: numCols down-pointing triangles
    for (let i = 0; i < this.numCols; i++) {
      const apex = row3 + i;
      const baseLeft = row2 + i;
      const baseRight = row2 + i + 1;
      this.faces.push([apex, baseRight, baseLeft]);
    }
  }

  /**
   * Returns the row index (0=top, 1=middle, 2=bottom) for a given face index.
   */
  getFaceRow(faceIndex: number): number {
    if (faceIndex < this.faceRanges.topEnd) return 0;
    if (faceIndex < this.faceRanges.midEnd) return 1;
    return 2;
  }

  /**
   * Returns whether the face at the given index is up-pointing.
   */
  isUpPointing(faceIndex: number): boolean {
    const row = this.getFaceRow(faceIndex);
    if (row === 0) return true;
    if (row === 2) return false;
    // Middle row: even indices are down, odd are up
    const midIndex = faceIndex - this.faceRanges.topEnd;
    return midIndex % 2 === 1;
  }

  /**
   * Gets the vertex at the given index.
   */
  getVertex(index: number): Vec2 {
    return this.vertices[index];
  }

  /**
   * Gets the face at the given index.
   */
  getFace(index: number): TriangleFace {
    return this.faces[index];
  }

  /**
   * Returns the total number of vertices.
   */
  get vertexCount(): number {
    return this.vertices.length;
  }

  /**
   * Returns the total number of faces.
   */
  get faceCount(): number {
    return this.faces.length;
  }
}
