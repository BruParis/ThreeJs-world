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
  motionSpeed: THREE.Vector3 = new THREE.Vector3();

  *loop(): IterableIterator<Halfedge> {
    for (const he of this.edge.nextLoop()) {
      yield he;
    }
  }

  constructor(halfedge: Halfedge, plate: Plate) {
    this.edge = halfedge;
    this.plate = plate;

    // Compute centroid
    const verticesPosSet: Set<THREE.Vector3> = new Set<THREE.Vector3>();
    for (const he of this.loop()) {
      const vertexPos = he.vertex.position;
      verticesPosSet.add(vertexPos);
    }

    this.centroid = new THREE.Vector3();
    const numVertices = verticesPosSet.size;
    for (const vertexPos of verticesPosSet) {
      this.centroid.add(vertexPos);
    }

    this.centroid.divideScalar(numVertices);

    this.centroid.normalize();

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
}

// INACTIVE: no relative motion
// DIVERGENT: plates moving apart
// CONVERTGENT: plates moving towards each other
// TRANSFORM: plates sliding past each other
// OBLIQUE_DIVERGENT: plates moving apart with a shear component
// OBLIQUE_CONVERGENT: plates moving towards each other with a shear component
export enum BoundaryType {
  UNKNOWN = 'unknown',
  INACTIVE = 'inactive',
  DIVERGENT = 'divergent',
  CONVERGENT = 'convergent',
  TRANSFORM = 'transform',
  OBLIQUE_DIVERGENT = 'oblique_divergent',
  OBLIQUE_CONVERGENT = 'oblique_convergent'
}

export class BoundaryEdge {
  halfedge: Halfedge;
  type: BoundaryType;
  relativeMotionSpeed: THREE.Vector3;

  constructor(edge: Halfedge) {
    this.halfedge = edge;
    this.type = BoundaryType.UNKNOWN;
    this.relativeMotionSpeed = new THREE.Vector3();
  }
}

export class PlateBoundary {
  id: number = _idBoundaryCount++;
  plateA: Plate;
  plateB: Plate;
  boundaryEdges: Set<BoundaryEdge>;

  constructor(plateA: Plate, plateB: Plate, borderEdges: Set<Halfedge>) {
    this.id = _idBoundaryCount++;
    this.plateA = plateA;
    this.plateB = plateB;
    this.boundaryEdges = new Set<BoundaryEdge>();

    for (const he of borderEdges) {
      const boundaryEdge = new BoundaryEdge(he);
      this.boundaryEdges.add(boundaryEdge);
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
