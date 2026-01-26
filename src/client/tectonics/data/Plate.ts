import * as THREE from 'three';
import { Halfedge } from '@core/Halfedge';

export enum PlateCategory {
  CONTINENTAL = 'continental',
  OCEANIC = 'oceanic',
  MICROPLATE = 'microplate',
  DEFORMATION = 'deformation',
  UNKNOWN = 'unknown'
}

let _idTileCount = 0;
let _idPlateCount = 0;
let _idBoundaryCount = 0;

export class Tile {
  id: number = _idTileCount++;
  edge: Halfedge;
  plate: Plate;
  centroid: THREE.Vector3;
  motionVec: THREE.Vector3 = new THREE.Vector3();
  readonly area: number;

  *loop(): IterableIterator<Halfedge> {
    for (const he of this.edge.nextLoop()) {
      yield he;
    }
  }

  constructor(halfedge: Halfedge, plate: Plate) {
    this.edge = halfedge;
    this.plate = plate;

    // Collect vertices
    const vertices: THREE.Vector3[] = [];
    for (const he of this.loop()) {
      vertices.push(he.vertex.position);
    }

    // Compute centroid
    this.centroid = new THREE.Vector3();
    for (const vertexPos of vertices) {
      this.centroid.add(vertexPos);
    }
    this.centroid.divideScalar(vertices.length);
    this.centroid.normalize();

    // Compute area (spherical polygon area on unit sphere)
    this.area = this.computeSphericalPolygonArea(vertices);
  }

  /**
   * Computes the area of a spherical polygon on a unit sphere.
   * Uses triangulation from centroid and sums spherical triangle areas.
   */
  private computeSphericalPolygonArea(vertices: THREE.Vector3[]): number {
    const n = vertices.length;
    if (n < 3) return 0;

    let totalArea = 0;
    const center = this.centroid;

    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      totalArea += this.sphericalTriangleArea(center, v1, v2);
    }

    return totalArea;
  }

  /**
   * Computes the area of a spherical triangle on a unit sphere using the formula:
   * Area = 2 * atan2(|A · (B × C)|, 1 + A·B + B·C + C·A)
   */
  private sphericalTriangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
    const crossBC = new THREE.Vector3().crossVectors(b, c);
    const numerator = Math.abs(a.dot(crossBC));
    const denominator = 1 + a.dot(b) + b.dot(c) + c.dot(a);
    return 2 * Math.atan2(numerator, denominator);
  }

  countEdges(): number {
    let count = 0;
    for (const _ of this.loop()) {
      count++;
    }
    return count;
  }

  countBorderEdges(): number {
    let count = 0;
    const plate = this.plate;
    for (const he of this.loop()) {
      if (plate.borderEdge2TileMap.has(he)) {
        count++;
      }
    }
    return count;
  }

  isABridge(): boolean {

    const plate = this.plate;
    // Count the number of border->non-border flips
    let numFlips = 0;
    for (const he of this.loop()) {
      const nextHe = he.next;

      const currentIsBorder = plate.borderEdge2TileMap.has(he);
      const nextIsBorder = plate.borderEdge2TileMap.has(nextHe);

      if (currentIsBorder && !nextIsBorder) {
        numFlips++;
      }
    }

    return numFlips >= 2;
  }
}

export class Plate {
  id: number = _idPlateCount++;
  tiles: Set<Tile>;
  borderEdge2TileMap: Map<Halfedge, Tile>;
  category: PlateCategory;
  system: TectonicSystem;
  centroid: THREE.Vector3;
  // Motion quantities units are irrelevant,
  // just use normalized magnitudes
  // (not really simulating anything physical here)
  rotationAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  rotationSpeed: number = 0; // radians per unit time
  private _area: number = 0;

  *iterBorderTiles(): IterableIterator<Tile> {
    const visitedTiles: Set<Tile> = new Set<Tile>();
    for (const borderTile of this.borderEdge2TileMap.values()) {
      if (visitedTiles.has(borderTile)) {
        continue;
      }

      visitedTiles.add(borderTile);
      yield borderTile;
    }
  }



  constructor(tileEdge: Halfedge, category: PlateCategory = PlateCategory.UNKNOWN) {

    this.tiles = new Set<Tile>();
    this.system = new TectonicSystem();

    const newTile = new Tile(tileEdge, this);
    this.tiles.add(newTile);
    this.category = category;

    this.borderEdge2TileMap = new Map<Halfedge, Tile>();
    for (const he of newTile.loop()) {
      this.borderEdge2TileMap.set(he, newTile);
    }

    this.centroid = new THREE.Vector3();
  }

  addTileFromEdge(edge: Halfedge): Tile | null {
    const newTile = new Tile(edge, this);

    if (this.tiles.has(newTile)) {
      console.warn(`Tile already present in plate ${this.id}`);
      return null;
    }

    this.tiles.add(newTile);

    for (const he of newTile.loop()) {
      const twin = he.twin;
      if (this.borderEdge2TileMap.has(twin)) {
        this.borderEdge2TileMap.delete(twin);
      } else {
        this.borderEdge2TileMap.set(he, newTile);
      }
    }

    return newTile;
  }

  updateCentroid(): void {
    this.centroid.set(0, 0, 0);

    const verticesPosSet: Set<THREE.Vector3> = new Set<THREE.Vector3>();
    for (const tile of this.tiles) {
      for (const he of tile.loop()) {
        const vertexPos = he.vertex.position;
        verticesPosSet.add(vertexPos);
      }
    }

    const numVertices = verticesPosSet.size;
    for (const vertexPos of verticesPosSet) {
      this.centroid.add(vertexPos);
    }

    this.centroid.divideScalar(numVertices);

    this.centroid.normalize();
  }

  /**
   * Gets the plate area. Must call computeArea() first after all modifications.
   */
  get area(): number {
    return this._area;
  }

  /**
   * Computes the plate area as the sum of all tile areas.
   * Call this after all tile modifications (transfers, absorptions) are complete.
   */
  computeArea(): void {
    this._area = 0;
    for (const tile of this.tiles) {
      this._area += tile.area;
    }
  }
}

// INACTIVE: no relative motion
// DIVERGENT: plates moving apart
// CONVERGENT: plates moving towards each other
// TRANSFORM: plates sliding past each other
export enum BoundaryType {
  UNKNOWN = 'unknown',
  INACTIVE = 'inactive',
  DIVERGENT = 'divergent',
  CONVERGENT = 'convergent',
  TRANSFORM = 'transform'
}

export class BoundaryEdge {
  halfedge: Halfedge;
  private _rawType: BoundaryType;
  refinedType: BoundaryType;

  constructor(edge: Halfedge) {
    this.halfedge = edge;
    this._rawType = BoundaryType.UNKNOWN;
    this.refinedType = BoundaryType.UNKNOWN;
  }

  get rawType(): BoundaryType {
    return this._rawType;
  }

  set rawType(value: BoundaryType) {
    this._rawType = value;
    this.refinedType = value;
  }
}

export class PlateBoundary {
  id: number = _idBoundaryCount++;
  plateA: Plate;
  plateB: Plate;
  boundaryEdges: Set<BoundaryEdge>;

  // Limit edges (the two endpoints of the boundary chain)
  private _limitEdges: [BoundaryEdge, BoundaryEdge] | null = null;
  // Adjacency map: each edge maps to its neighbors in the chain
  private _adjacencyMap: Map<BoundaryEdge, BoundaryEdge[]> = new Map();

  get limitEdges(): [BoundaryEdge, BoundaryEdge] | null {
    return this._limitEdges;
  }

  constructor(plateA: Plate, plateB: Plate, borderEdges: Set<Halfedge>) {
    this.id = _idBoundaryCount++;
    this.plateA = plateA;
    this.plateB = plateB;
    this.boundaryEdges = new Set<BoundaryEdge>();

    for (const he of borderEdges) {
      const boundaryEdge = new BoundaryEdge(he);
      this.boundaryEdges.add(boundaryEdge);
    }

    this.update();
  }

  /**
   * Updates the boundary's internal structure after construction.
   * Computes adjacency between edges and identifies the two limit edges.
   * Must be called after all boundary edges are added.
   */
  update(): void {
    this._adjacencyMap.clear();
    this._limitEdges = null;

    if (this.boundaryEdges.size === 0) {
      return;
    }

    const edgeArray = Array.from(this.boundaryEdges);

    // Build a map from vertex ID to edges that touch that vertex
    const vertexToEdges: Map<number, BoundaryEdge[]> = new Map();

    for (const bEdge of edgeArray) {
      const startVertexId = bEdge.halfedge.vertex.id;
      const endVertexId = bEdge.halfedge.twin.vertex.id;

      if (!vertexToEdges.has(startVertexId)) {
        vertexToEdges.set(startVertexId, []);
      }
      vertexToEdges.get(startVertexId)!.push(bEdge);

      if (!vertexToEdges.has(endVertexId)) {
        vertexToEdges.set(endVertexId, []);
      }
      vertexToEdges.get(endVertexId)!.push(bEdge);
    }

    // Build adjacency: two edges are adjacent if they share a vertex
    for (const bEdge of edgeArray) {
      const neighbors: BoundaryEdge[] = [];
      const startVertexId = bEdge.halfedge.vertex.id;
      const endVertexId = bEdge.halfedge.twin.vertex.id;

      for (const otherEdge of vertexToEdges.get(startVertexId) || []) {
        if (otherEdge !== bEdge && !neighbors.includes(otherEdge)) {
          neighbors.push(otherEdge);
        }
      }

      for (const otherEdge of vertexToEdges.get(endVertexId) || []) {
        if (otherEdge !== bEdge && !neighbors.includes(otherEdge)) {
          neighbors.push(otherEdge);
        }
      }

      this._adjacencyMap.set(bEdge, neighbors);
    }

    // Find limit edges (edges with only 1 neighbor = endpoints of the chain)
    const limits: BoundaryEdge[] = [];
    for (const [bEdge, neighbors] of this._adjacencyMap) {
      if (neighbors.length === 1) {
        limits.push(bEdge);
      }
    }

    if (limits.length === 2) {
      this._limitEdges = [limits[0], limits[1]];
    } else if (limits.length === 0 && this.boundaryEdges.size > 0) {
      // Boundary forms a closed loop - no limits
      console.warn(`PlateBoundary ${this.id}: boundary forms a closed loop, no limit edges`);
    } else if (limits.length !== 0) {
      console.warn(`PlateBoundary ${this.id}: unexpected number of limit edges: ${limits.length}`);
    }
  }

  /**
   * Iterates over all boundary edges in order, from one limit to the other.
   * @param startLimit Optional starting limit edge. If not provided, starts from the first limit.
   */
  *iterateEdges(startLimit?: BoundaryEdge): IterableIterator<BoundaryEdge> {
    if (this.boundaryEdges.size === 0) {
      return;
    }

    // Determine starting edge
    let current: BoundaryEdge | undefined;
    if (startLimit && this.boundaryEdges.has(startLimit)) {
      current = startLimit;
    } else if (this._limitEdges) {
      current = this._limitEdges[0];
    } else {
      // No limits (closed loop), start from any edge
      current = this.boundaryEdges.values().next().value;
    }

    if (!current) {
      return;
    }

    const visited = new Set<BoundaryEdge>();

    while (current && !visited.has(current)) {
      yield current;
      visited.add(current);

      const neighbors: BoundaryEdge[] = this._adjacencyMap.get(current) || [];
      const next: BoundaryEdge | undefined = neighbors.find((n: BoundaryEdge) => !visited.has(n));
      if (!next) {
        break;
      }
      current = next;
    }
  }
}

function makePlateBoundary(tectonicSystem: TectonicSystem, borderEdges: Set<Halfedge>): PlateBoundary {

  // Determine plates, iterate over all border Edhes
  // Expects 2 plates only
  const platesSet: Set<Plate> = new Set<Plate>();
  for (const he of borderEdges) {
    const twinHe = he.twin;

    const tile = tectonicSystem.findTileFromEdge(he);
    const twinTile = tectonicSystem.findTileFromEdge(twinHe);

    if (!tile || !twinTile) {
      console.error("PlateBoundary: could not find tiles for border edge", he.id);
      throw new Error("PlateBoundary: could not find tiles for border edge");
    }

    const plateA = tile.plate;
    const plateB = twinTile.plate;

    // Must be different plates
    if (plateA === plateB) {
      console.error("PlateBoundary: border edge", he.id, "has same plate on both sides:", plateA.id);
      continue;
    }

    platesSet.add(plateA);
    platesSet.add(plateB);
  }

  if (platesSet.size !== 2) {
    console.error("PlateBoundary: expected 2 plates for boundary, found", platesSet.size);
    throw new Error("PlateBoundary: invalid number of plates for boundary");
  }

  const platesArray = Array.from(platesSet);
  const plateA = platesArray[0];
  const plateB = platesArray[1];

  const boundary = new PlateBoundary(plateA, plateB, borderEdges);

  return boundary;
}

export class TectonicSystem {
  plates: Set<Plate>;
  edge2TileMap: Map<Halfedge, Tile>;
  boundaries: Set<PlateBoundary>;
  edge2BoundaryMap: Map<Halfedge, PlateBoundary>;

  constructor() {
    this.plates = new Set<Plate>();
    this.edge2TileMap = new Map<Halfedge, Tile>();
    this.boundaries = new Set<PlateBoundary>();
    this.edge2BoundaryMap = new Map<Halfedge, PlateBoundary>();
  }

  update(): void {

    this.edge2TileMap.clear();

    for (const plate of this.plates) {
      plate.system = this;
    }

    for (const plate of this.plates) {
      for (const tile of plate.tiles) {
        for (const he of tile.loop()) {
          this.edge2TileMap.set(he, tile);
        }
      }
    }

  }

  addBoundary(boundary: PlateBoundary): void {
    this.boundaries.add(boundary);

    for (const bEdge of boundary.boundaryEdges) {
      this.edge2BoundaryMap.set(bEdge.halfedge, boundary);
      this.edge2BoundaryMap.set(bEdge.halfedge.twin, boundary);
    }
  }

  clearBoundaries(): void {
    this.boundaries.clear();
    this.edge2BoundaryMap.clear();
  }

  collectAllPlates(): Set<Plate> {
    return new Set(this.plates);
  }

  removePlate(plate: Plate): void {

    this.plates.delete(plate);

    plate.system = new TectonicSystem();

    for (const tile of plate.tiles) {
      for (const he of tile.loop()) {
        this.edge2TileMap.delete(he);
      }
    }

    // Also remove any boundaries involving this plate
    for (const borderHe of plate.borderEdge2TileMap.keys()) {

      this.edge2BoundaryMap.delete(borderHe);
      this.edge2BoundaryMap.delete(borderHe.twin);
      const boundary = this.edge2BoundaryMap.get(borderHe);

      if (boundary) {
        this.boundaries.delete(boundary);
      }
    }
  }

  findTileFromEdge(he: Halfedge): Tile | undefined {

    for (const auxHe of he.nextLoop()) {
      if (!this.edge2TileMap.has(auxHe)) {
        continue;
      }

      return this.edge2TileMap.get(auxHe);
    }

    // If this happens, the tectonic system is inconsistent
    console.error('TectonicSystem: findTileFromEdge: edge', he.id, " not leading to any tile");

    return undefined;
  }


  clear(): void {
    this.plates.clear();
  }
}

export { makePlateBoundary };
