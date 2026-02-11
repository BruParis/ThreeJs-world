import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HalfedgeGraph } from '@core/HalfedgeGraph';
import { Halfedge } from '@core/Halfedge';
import { TectonicSystem, PlateBoundary, BoundaryEdge, Tile, Plate } from '../tectonics/data/Plate';
import {
  makeBufferGeometryFromHalfedgeGraph,
  makeBufferGeometryFromLoops,
  makeLineSegments2FromHalfedgeGraph
} from '@core/HalfedgeGraphUtils';
import {
  makeLineSegments2FromTile,
  makeLineSegments2FromPlate,
  makeLineSegments2FromBoundary,
  makeLineSegments2FromBoundaryGradient,
  makeLineSegments2ForNeighborTilesInPlate
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
  private motionVecLinesMaterial: LineMaterial;
  private boundaryLinesMaterial: LineMaterial;
  private allBoundariesLinesMaterial: LineMaterial;
  private neighborTilesLinesMaterial: LineMaterial;
  private noiseGradientLinesMaterial: LineMaterial;

  // Line segments
  private halfedgeGraphLines: LineSegments2;
  private tileLines: LineSegments2;
  private plateLines: LineSegments2;
  private motionVecLines: LineSegments2;
  private boundaryLines: LineSegments2;
  private allBoundariesLines: LineSegments2;
  private neighborTilesLines: LineSegments2;
  private noiseGradientLines: LineSegments2;

  // Halfedge graphs
  private icoHalfedgeGraph: HalfedgeGraph;
  private icoHalfedgeDualGraph: HalfedgeGraph;

  // Current selection state
  private currentSelectedHalfedge: Halfedge | null = null;
  private currentClickPoint: THREE.Vector3 | null = null;
  private currentBoundary: PlateBoundary | null = null;

  // Labels for tile and plate info
  private tileLabel: CSS2DObject | null = null;
  private plateLabel: CSS2DObject | null = null;

  // Parameters
  private icoParams = {
    degree: 2,
    numVertices: 0,
    numFaces: 0,
    numHalfedges: 0
  };

  private icoDualParams = {
    dualFaces: 0,
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

    this.motionVecLinesMaterial = new LineMaterial({
      linewidth: 1,
      depthTest: true,
      depthWrite: true,
      vertexColors: true,
      visible: false,
    });

    this.boundaryLinesMaterial = new LineMaterial({
      linewidth: 8,
      depthTest: true,
      depthWrite: true,
      vertexColors: true,
      visible: true,
    });

    this.allBoundariesLinesMaterial = new LineMaterial({
      linewidth: 3,
      depthTest: true,
      depthWrite: true,
      vertexColors: true,
      visible: true,
    });

    this.neighborTilesLinesMaterial = new LineMaterial({
      linewidth: 5,
      depthTest: true,
      depthWrite: true,
      vertexColors: true,
      visible: false,
    });

    this.noiseGradientLinesMaterial = new LineMaterial({
      linewidth: 2,
      depthTest: true,
      depthWrite: true,
      vertexColors: true,
      visible: true,
    });

    // Initialize line segments
    this.halfedgeGraphLines = new LineSegments2(new LineSegmentsGeometry(), this.graphLinesMaterial);
    this.tileLines = new LineSegments2(new LineSegmentsGeometry(), this.tileLinesMaterial);
    this.plateLines = new LineSegments2(new LineSegmentsGeometry(), this.plateLinesMaterial);
    this.motionVecLines = new LineSegments2(new LineSegmentsGeometry(), this.motionVecLinesMaterial);
    this.boundaryLines = new LineSegments2(new LineSegmentsGeometry(), this.boundaryLinesMaterial);
    this.allBoundariesLines = new LineSegments2(new LineSegmentsGeometry(), this.allBoundariesLinesMaterial);
    this.neighborTilesLines = new LineSegments2(new LineSegmentsGeometry(), this.neighborTilesLinesMaterial);
    this.noiseGradientLines = new LineSegments2(new LineSegmentsGeometry(), this.noiseGradientLinesMaterial);
  }

  /**
   * Sets the primal and dual halfedge graphs from an external builder.
   */
  public setGraphs(primalGraph: HalfedgeGraph, dualGraph: HalfedgeGraph): void {
    this.icoHalfedgeGraph = primalGraph;
    this.icoHalfedgeDualGraph = dualGraph;
  }

  /**
   * Sets the statistics for the primal and dual graphs.
   */
  public setStats(stats: {
    numVertices: number;
    numFaces: number;
    numHalfedges: number;
    numDualFaces: number;
    pentagons: number;
    hexagons: number;
    heptagons: number;
  }): void {
    this.icoParams.numVertices = stats.numVertices;
    this.icoParams.numFaces = stats.numFaces;
    this.icoParams.numHalfedges = stats.numHalfedges;
    this.icoDualParams.dualFaces = stats.numDualFaces;
    this.icoDualParams.pentagons = stats.pentagons;
    this.icoDualParams.hexagons = stats.hexagons;
    this.icoDualParams.heptagons = stats.heptagons;
  }

  /**
   * Rebuilds all meshes from the current graphs.
   * This is pure visualization work: mesh creation, scene management, rotation preservation.
   */
  public rebuildVisualMeshesFromGraphs(): void {
    console.log("Rebuilding meshes from graphs");
    const start_time = performance.now();

    const scene = this.sceneManager.getScene();

    let rotation: THREE.Euler | null = null;

    // Rebuild icosahedron mesh
    if (this.icosahedron) {
      rotation = this.icosahedron.rotation.clone();
      scene.remove(this.icosahedron);
    }

    const geometry = makeBufferGeometryFromHalfedgeGraph(this.icoHalfedgeGraph, true);
    const positions = geometry.attributes.position;

    // Add color attribute to the geometry
    const colors = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
    for (let i = 0; i < positions.count; i++) {
      colors.setXYZ(i, 1, 1, 1);
    }

    geometry.setAttribute('color', colors);

    this.icosahedron = new THREE.Mesh(geometry, this.icosahedronMaterial);

    if (rotation) {
      this.icosahedron.rotation.copy(rotation);
    }

    scene.add(this.icosahedron);

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

    console.log("Meshes rebuilt in", (performance.now() - start_time).toFixed(2), "ms");
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
   * Displays edges of neighbor tiles that are on the same plate as the clicked tile.
   * Used for debugging getNeighborTilesInPlate function.
   */
  public displayNeighborTilesLines(he: Halfedge, tectonicSystem: TectonicSystem): void {
    if (!tectonicSystem) {
      console.warn('No tectonic plates available.');
      return;
    }

    const scene = this.sceneManager.getScene();

    if (this.neighborTilesLines) {
      scene.remove(this.neighborTilesLines);
    }

    const tile = tectonicSystem.findTileFromEdge(he);

    if (!tile) {
      console.warn('No tile found for the clicked halfedge.');
      return;
    }

    console.log(`[DEBUG] Displaying neighbor tiles for tile ${tile.id} in plate ${tile.plate.id} (${tile.plate.category})`);

    makeLineSegments2ForNeighborTilesInPlate(tile, tectonicSystem, this.neighborTilesLines);

    // Copy rotation from dual mesh
    if (this.dualMesh) {
      this.neighborTilesLines.rotation.copy(this.dualMesh.rotation);
    }

    scene.add(this.neighborTilesLines);
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
   * Displays boundary edges with gradient coloring from one limit to the other.
   * @param boundary The plate boundary to visualize
   * @param startLimit Optional: which limit edge to start the gradient from
   */
  public displayBoundaryGradient(boundary: PlateBoundary, startLimit?: BoundaryEdge): void {
    const scene = this.sceneManager.getScene();

    if (this.boundaryLines) {
      scene.remove(this.boundaryLines);
    }

    const success = makeLineSegments2FromBoundaryGradient(boundary, this.boundaryLines, startLimit);
    if (success) {
      scene.add(this.boundaryLines);
    }
  }

  /**
   * Displays boundary edges colored by type (raw or refined).
   * @param boundary The plate boundary to visualize
   * @param useRawType If true, use rawType; otherwise use refinedType
   */
  public displayBoundaryByType(boundary: PlateBoundary, useRawType: boolean): void {
    const scene = this.sceneManager.getScene();

    if (this.boundaryLines) {
      scene.remove(this.boundaryLines);
    }

    makeLineSegments2FromBoundary(boundary, this.boundaryLines, useRawType);
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

  /**
   * Displays labels for the selected tile and its plate.
   * Labels are added as children of dualMesh so they rotate with the scene.
   * @param tile The selected tile
   */
  public displayTileAndPlateLabels(tile: Tile): void {
    if (!this.dualMesh) {
      console.warn('No dual mesh available for labels.');
      return;
    }

    // Remove existing labels
    this.clearLabels();

    const plate = tile.plate;
    const elevationFactor = 1.15;

    // Create tile label
    const tileLabelDiv = document.createElement('div');
    tileLabelDiv.className = 'tile-label';
    tileLabelDiv.style.cssText = `
      background: rgba(255, 255, 255, 0.9);
      padding: 4px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      color: #333;
      border: 1px solid #666;
    `;
    tileLabelDiv.innerHTML = `
      <strong>Tile #${tile.id}</strong><br>
      Area: ${tile.area.toFixed(6)}
    `;

    this.tileLabel = new CSS2DObject(tileLabelDiv);
    const tilePos = tile.centroid.clone().multiplyScalar(elevationFactor);
    this.tileLabel.position.copy(tilePos);
    // Add as child of dualMesh so it rotates with the scene
    this.dualMesh.add(this.tileLabel);

    // Create plate label
    const plateLabelDiv = document.createElement('div');
    plateLabelDiv.className = 'plate-label';
    plateLabelDiv.style.cssText = `
      background: rgba(240, 240, 255, 0.9);
      padding: 4px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      color: #333;
      border: 1px solid #336;
    `;
    plateLabelDiv.innerHTML = `
      <strong>Plate #${plate.id}</strong><br>
      Category: ${plate.category}<br>
      Area: ${plate.area.toFixed(6)}<br>
      Tiles: ${plate.tiles.size}
    `;

    this.plateLabel = new CSS2DObject(plateLabelDiv);
    // Position plate label at plate centroid, slightly more elevated
    const platePos = plate.centroid.clone().multiplyScalar(elevationFactor * 1.1);
    this.plateLabel.position.copy(platePos);
    // Add as child of dualMesh so it rotates with the scene
    this.dualMesh.add(this.plateLabel);
  }

  /**
   * Clears tile and plate labels from the scene.
   */
  public clearLabels(): void {
    if (this.tileLabel) {
      this.tileLabel.removeFromParent();
      this.tileLabel = null;
    }
    if (this.plateLabel) {
      this.plateLabel.removeFromParent();
      this.plateLabel = null;
    }
  }

  /**
   * Sets the current selection state.
   */
  public setCurrentSelection(halfedge: Halfedge | null, clickPoint: THREE.Vector3 | null, boundary: PlateBoundary | null): void {
    this.currentSelectedHalfedge = halfedge;
    this.currentClickPoint = clickPoint;
    this.currentBoundary = boundary;
  }

  /**
   * Gets the current selected boundary.
   */
  public getCurrentBoundary(): PlateBoundary | null {
    return this.currentBoundary;
  }

  /**
   * Gets the current click point.
   */
  public getCurrentClickPoint(): THREE.Vector3 | null {
    return this.currentClickPoint;
  }

  /**
   * Refreshes the boundary display based on the given mode.
   * @param mode The display mode: 'none', 'rawType', 'refinedType', or 'iteration'
   */
  public refreshBoundaryDisplay(mode: string): void {
    const scene = this.sceneManager.getScene();

    // Always remove existing boundary lines first
    if (this.boundaryLines) {
      scene.remove(this.boundaryLines);
    }

    // If no boundary selected, just clear and return
    if (!this.currentBoundary) {
      return;
    }

    switch (mode) {
      case 'none':
        // Just remove, don't add anything
        break;

      case 'rawType':
        makeLineSegments2FromBoundary(this.currentBoundary, this.boundaryLines, true);
        scene.add(this.boundaryLines);
        break;

      case 'refinedType':
        makeLineSegments2FromBoundary(this.currentBoundary, this.boundaryLines, false);
        scene.add(this.boundaryLines);
        break;

      case 'iteration':
        if (!this.currentBoundary.limitEdges || !this.currentClickPoint) {
          console.warn('Cannot display iteration: no limit edges or click point');
          return;
        }
        const [limitA, limitB] = this.currentBoundary.limitEdges;
        const distToA = this.currentClickPoint.distanceTo(
          limitA.halfedge.vertex.position.clone().add(limitA.halfedge.next.vertex.position).multiplyScalar(0.5)
        );
        const distToB = this.currentClickPoint.distanceTo(
          limitB.halfedge.vertex.position.clone().add(limitB.halfedge.next.vertex.position).multiplyScalar(0.5)
        );
        const closestLimit = distToA < distToB ? limitA : limitB;
        const success = makeLineSegments2FromBoundaryGradient(this.currentBoundary, this.boundaryLines, closestLimit);
        if (success) {
          scene.add(this.boundaryLines);
        }
        break;
    }
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

  public getMotionVecLinesMaterial(): LineMaterial {
    return this.motionVecLinesMaterial;
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

  public getMotionVecLines(): LineSegments2 {
    return this.motionVecLines;
  }

  public getBoundaryLines(): LineSegments2 {
    return this.boundaryLines;
  }

  public getAllBoundariesLines(): LineSegments2 {
    return this.allBoundariesLines;
  }

  public getAllBoundariesLinesMaterial(): LineMaterial {
    return this.allBoundariesLinesMaterial;
  }

  public getNeighborTilesLines(): LineSegments2 {
    return this.neighborTilesLines;
  }

  public getNeighborTilesLinesMaterial(): LineMaterial {
    return this.neighborTilesLinesMaterial;
  }

  public getNoiseGradientLines(): LineSegments2 {
    return this.noiseGradientLines;
  }

  public getNoiseGradientLinesMaterial(): LineMaterial {
    return this.noiseGradientLinesMaterial;
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
