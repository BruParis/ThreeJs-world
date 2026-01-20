import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { HalfedgeGraph } from '@core/HalfedgeGraph';
import { Halfedge } from '@core/Halfedge';
import { TectonicSystem } from '../tectonics/data/Plate';
import {
  makeBufferGeometryFromHalfedgeGraph,
  makeBufferGeometryFromLoops,
  subdivideTrianglesLoop,
  normalizeVertices,
  populateDualGraph,
  makeLineSegments2FromHalfedgeGraph,
  distortGraphLoop,
  makeFaceDistribution
} from '@core/HalfedgeGraphUtils';
import { populateIcosahedronHalfedgeGraph } from '@core/geometry/IcosahedronMesh';
import {
  makeLineSegments2FromTile,
  makeLineSegments2FromPlate,
  makeLineSegments2FromBoundary
} from '../visualization/TectonicsDrawingUtils';
import { SceneManager } from './SceneManager';

/**
 * Manages all visualization elements: meshes, materials, lines, and rebuild logic.
 */
export class VisualizationManager {
  private sceneManager: SceneManager;

  // Meshes
  private icosahedron: THREE.Mesh | null = null;
  private dualMesh: THREE.Mesh | null = null;

  // Materials
  private icosahedronMaterial: THREE.MeshBasicMaterial;
  private dualMaterial: THREE.MeshBasicMaterial;
  private graphLinesMaterial: LineMaterial;
  private tileLinesMaterial: LineMaterial;
  private plateLinesMaterial: LineMaterial;
  private motionSpeedLinesMaterial: LineMaterial;
  private boundaryLinesMaterial: LineMaterial;

  // Line segments
  private halfedgeGraphLines: LineSegments2;
  private tileLines: LineSegments2;
  private plateLines: LineSegments2;
  private motionSpeedLines: LineSegments2;
  private boundaryLines: LineSegments2;

  // Halfedge graphs
  private icoHalfedgeGraph: HalfedgeGraph;
  private icoHalfedgeDualGraph: HalfedgeGraph;

  // Parameters
  private icoParams = {
    degree: 2,
    numVertices: 0,
    numFaces: 0,
    numHalfedges: 0
  };

  private icoDualParams = {
    pentagons: 0,
    hexagons: 0,
    heptagons: 0
  };

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;

    // Initialize halfedge graphs
    this.icoHalfedgeGraph = new HalfedgeGraph();
    this.icoHalfedgeDualGraph = new HalfedgeGraph();

    // Initialize materials
    this.icosahedronMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      wireframe: true,
      visible: false,
      side: THREE.FrontSide,
    });

    this.dualMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      wireframe: false,
      visible: true,
      side: THREE.FrontSide,
    });

    this.graphLinesMaterial = new LineMaterial({
      linewidth: 2,
      depthTest: true,
      depthWrite: false,
      vertexColors: true,
      visible: false,
    });

    this.tileLinesMaterial = new LineMaterial({
      linewidth: 4,
      depthTest: true,
      vertexColors: true,
      visible: true,
    });

    this.plateLinesMaterial = new LineMaterial({
      linewidth: 6,
      depthTest: true,
      vertexColors: true,
      visible: true,
    });

    this.motionSpeedLinesMaterial = new LineMaterial({
      linewidth: 1,
      depthTest: true,
      depthWrite: true,
      vertexColors: true,
      visible: true,
    });

    this.boundaryLinesMaterial = new LineMaterial({
      linewidth: 8,
      depthTest: true,
      depthWrite: true,
      vertexColors: true,
      visible: true,
    });

    // Initialize line segments
    this.halfedgeGraphLines = new LineSegments2(new LineSegmentsGeometry(), this.graphLinesMaterial);
    this.tileLines = new LineSegments2(new LineSegmentsGeometry(), this.tileLinesMaterial);
    this.plateLines = new LineSegments2(new LineSegmentsGeometry(), this.plateLinesMaterial);
    this.motionSpeedLines = new LineSegments2(new LineSegmentsGeometry(), this.motionSpeedLinesMaterial);
    this.boundaryLines = new LineSegments2(new LineSegmentsGeometry(), this.boundaryLinesMaterial);
  }

  /**
   * Rebuilds the icosahedron halfedge data structure with the current degree.
   */
  public rebuildIcosahedronHalfedgeDS(): void {
    console.log("Rebuilding Icosahedron Halfedge DS");

    const scene = this.sceneManager.getScene();

    let rotation: THREE.Euler | null = null;
    // For smooth transitions, store the current rotation
    // before removing the old icosahedron
    if (this.icosahedron) {
      rotation = this.icosahedron.rotation.clone();
      scene.remove(this.icosahedron);
    }

    // Clear graphs and repopulate
    this.icoHalfedgeGraph = new HalfedgeGraph();
    this.icoHalfedgeDualGraph = new HalfedgeGraph();

    populateIcosahedronHalfedgeGraph(this.icoHalfedgeGraph);

    subdivideTrianglesLoop(this.icoHalfedgeGraph, this.icoParams.degree);

    distortGraphLoop(this.icoHalfedgeGraph, 3, 0.5);
    normalizeVertices(this.icoHalfedgeGraph);

    // Generate dual graph
    const icoHalfedge2DualBiMap = populateDualGraph(this.icoHalfedgeGraph, this.icoHalfedgeDualGraph);
    normalizeVertices(this.icoHalfedgeDualGraph);

    const geometry = makeBufferGeometryFromHalfedgeGraph(this.icoHalfedgeGraph, true);
    const positions = geometry.attributes.position;

    // Add Color attribute to the geometry
    const colors = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
    for (let i = 0; i < positions.count; i++) {
      colors.setXYZ(i, 1, 1, 1);
    }

    geometry.setAttribute('color', colors);

    this.icosahedron = new THREE.Mesh(geometry, this.icosahedronMaterial);

    this.icoParams.numVertices = this.icoHalfedgeGraph.vertices.size;
    this.icoParams.numFaces = this.icoHalfedgeGraph.faces.size;
    this.icoParams.numHalfedges = this.icoHalfedgeGraph.halfedges.size;

    // Apply the stored rotation to the new icosahedron
    if (rotation) {
      this.icosahedron.rotation.copy(rotation);
    }

    scene.add(this.icosahedron);

    let faceDistrib = makeFaceDistribution(this.icoHalfedgeDualGraph);
    this.icoDualParams.pentagons = faceDistrib.pentagons;
    this.icoDualParams.hexagons = faceDistrib.hexagons;
    this.icoDualParams.heptagons = faceDistrib.heptagons;

    // Rebuild halfedge graph lines
    if (this.halfedgeGraphLines) {
      rotation = this.halfedgeGraphLines.rotation.clone();
      scene.remove(this.halfedgeGraphLines);
    }

    makeLineSegments2FromHalfedgeGraph(this.icoHalfedgeDualGraph, this.halfedgeGraphLines);

    if (rotation) {
      this.halfedgeGraphLines.rotation.copy(rotation);
    }

    scene.add(this.halfedgeGraphLines);

    // Rebuild dual mesh
    if (this.dualMesh) {
      rotation = this.dualMesh.rotation.clone();
      scene.remove(this.dualMesh);
    }

    const dualGeometry = makeBufferGeometryFromLoops(this.icoHalfedgeDualGraph, true);
    const dualPositions = dualGeometry.attributes.position;

    // Add color attribute to the geometry
    const dualColors = new THREE.BufferAttribute(new Float32Array(dualPositions.count * 3), 3);
    for (let i = 0; i < dualPositions.count; i++) {
      dualColors.setXYZ(i, 1, 1, 1);
    }

    dualGeometry.setAttribute('color', dualColors);

    this.dualMesh = new THREE.Mesh(dualGeometry, this.dualMaterial);
    if (rotation) {
      this.dualMesh.rotation.copy(rotation);
    }

    scene.add(this.dualMesh);

    console.log("Mesh Rebuilt");
  }

  /**
   * Displays tile edges for a given halfedge.
   */
  public displayTileLines(he: Halfedge, tectonicSystem: TectonicSystem): void {
    if (!tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const scene = this.sceneManager.getScene();

    if (this.tileLines) {
      scene.remove(this.tileLines);
    }

    // Loop on the halfedges of the tile
    let tile = undefined;
    for (const auxHe of he.nextLoop()) {
      if (!tectonicSystem.edge2TileMap.has(auxHe)) {
        continue;
      }

      tile = tectonicSystem.edge2TileMap.get(auxHe);
      break;
    }
    console.log('Tile found for the clicked halfedge:', tile);

    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    makeLineSegments2FromTile(tile, this.tileLines);

    scene.add(this.tileLines);
  }

  /**
   * Displays plate edges for a given halfedge.
   */
  public displayPlateLines(he: Halfedge, tectonicSystem: TectonicSystem): void {
    if (!tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const scene = this.sceneManager.getScene();

    if (this.plateLines) {
      scene.remove(this.plateLines);
    }

    const tile = tectonicSystem.findTileFromEdge(he);

    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    const plate = tile.plate;
    console.log("plate border edges:", plate.borderEdge2TileMap.size);
    makeLineSegments2FromPlate(plate, this.plateLines);

    scene.add(this.plateLines);
  }

  /**
   * Displays boundary lines for a given halfedge.
   */
  public displayBoundaryLines(he: Halfedge, tectonicSystem: TectonicSystem): void {
    if (!tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const scene = this.sceneManager.getScene();

    const tile = tectonicSystem.findTileFromEdge(he);

    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    const plate = tile.plate;

    // Find the boundary corresponding to the clicked halfedge
    const boundary = tectonicSystem.edge2BoundaryMap.get(he);

    if (!boundary) {
      console.warn('No boundary found for the clicked halfedge.');
      return;
    }

    console.log("Tectonic Boundary found:", boundary);

    // also display full plate boundaries
    makeLineSegments2FromBoundary(boundary, this.boundaryLines);

    scene.add(this.boundaryLines);
  }

  /**
   * Clears all selection lines from the scene.
   */
  public clearSelectionLines(): void {
    const scene = this.sceneManager.getScene();
    if (this.tileLines) scene.remove(this.tileLines);
    if (this.plateLines) scene.remove(this.plateLines);
    if (this.boundaryLines) scene.remove(this.boundaryLines);
  }

  // Getters for all state
  public getIcosahedron(): THREE.Mesh | null {
    return this.icosahedron;
  }

  public getDualMesh(): THREE.Mesh | null {
    return this.dualMesh;
  }

  public getIcosahedronMaterial(): THREE.MeshBasicMaterial {
    return this.icosahedronMaterial;
  }

  public getDualMaterial(): THREE.MeshBasicMaterial {
    return this.dualMaterial;
  }

  public getGraphLinesMaterial(): LineMaterial {
    return this.graphLinesMaterial;
  }

  public getTileLinesMaterial(): LineMaterial {
    return this.tileLinesMaterial;
  }

  public getPlateLinesMaterial(): LineMaterial {
    return this.plateLinesMaterial;
  }

  public getMotionSpeedLinesMaterial(): LineMaterial {
    return this.motionSpeedLinesMaterial;
  }

  public getBoundaryLinesMaterial(): LineMaterial {
    return this.boundaryLinesMaterial;
  }

  public getHalfedgeGraphLines(): LineSegments2 {
    return this.halfedgeGraphLines;
  }

  public getTileLines(): LineSegments2 {
    return this.tileLines;
  }

  public getPlateLines(): LineSegments2 {
    return this.plateLines;
  }

  public getMotionSpeedLines(): LineSegments2 {
    return this.motionSpeedLines;
  }

  public getBoundaryLines(): LineSegments2 {
    return this.boundaryLines;
  }

  public getIcoHalfedgeGraph(): HalfedgeGraph {
    return this.icoHalfedgeGraph;
  }

  public getIcoHalfedgeDualGraph(): HalfedgeGraph {
    return this.icoHalfedgeDualGraph;
  }

  public getIcoParams() {
    return this.icoParams;
  }

  public getIcoDualParams() {
    return this.icoDualParams;
  }
}
