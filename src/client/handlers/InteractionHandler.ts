import * as THREE from 'three';
import { SceneManager } from '../managers/SceneManager';
import { VisualizationManager } from '../managers/VisualizationManager';
import { TectonicManager } from '../managers/TectonicManager';

export enum BoundaryDisplayMode {
  RAW_TYPE = 'rawType',
  REFINED_TYPE = 'refinedType',
  ITERATION = 'iteration'
}

/**
 * Handles mouse interaction events, raycasting, and selection.
 */
export class InteractionHandler {
  private sceneManager: SceneManager;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private selectionMode: boolean = true;
  private boundaryDisplayMode: BoundaryDisplayMode = BoundaryDisplayMode.RAW_TYPE;

  // Bound event handlers
  private boundOnMouseClick: (event: MouseEvent) => void;
  private boundOnMouseMove: (event: MouseEvent) => void;

  constructor(
    sceneManager: SceneManager,
    visualizationManager: VisualizationManager,
    tectonicManager: TectonicManager
  ) {
    this.sceneManager = sceneManager;
    this.visualizationManager = visualizationManager;
    this.tectonicManager = tectonicManager;

    // Bind event handlers
    this.boundOnMouseClick = this.onMouseClick.bind(this);
    this.boundOnMouseMove = this.onMouseMove.bind(this);
  }

  /**
   * Handles mouse click events for face selection.
   */
  private onMouseClick(event: MouseEvent): void {
    if (!this.selectionMode) return;

    const mouse = this.sceneManager.getMouse();
    const raycaster = this.sceneManager.getRaycaster();
    const camera = this.sceneManager.getCamera();
    const dualMesh = this.visualizationManager.getDualMesh();
    const icoHalfedgeDualGraph = this.visualizationManager.getIcoHalfedgeDualGraph();
    const icosahedron = this.visualizationManager.getIcosahedron();
    const tectonicSystem = this.tectonicManager.getTectonicSystem();

    if (!dualMesh || !icosahedron) {
      return;
    }

    // Calculate mouse position in normalized device coordinates
    // (-1 to +1) for both components
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update the raycaster with the camera and mouse position
    raycaster.setFromCamera(mouse, camera);

    // check if the geometry is indexed
    if (!icosahedron.geometry.index) {
      console.warn('Geometry is not indexed.');
      return;
    }

    // Calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObject(dualMesh);

    if (intersects.length > 0) {
      // Get the first intersection
      const intersect = intersects[0];
      const faceIndex = intersect.faceIndex!;

      console.log('Clicked face index on dual mesh:', faceIndex);
      const clickedHeId = dualMesh.geometry.userData.face2HalfedgeMap.get(faceIndex);
      console.log('Corresponding halfedge id in dual graph:', clickedHeId);
      const clickedHe = icoHalfedgeDualGraph.halfedges.get(clickedHeId);
      if (!clickedHe) {
        console.warn('No halfedge found for clicked halfedge id:', clickedHeId);
        return;
      }

      if (!tectonicSystem) {
        console.warn('No tectonic system available.');
        return;
      }

      // Display tile, plate, and boundary edges
      this.visualizationManager.displayTileLines(clickedHe, tectonicSystem);
      this.visualizationManager.displayPlateLines(clickedHe, tectonicSystem);
      this.visualizationManager.displayBoundaryLines(clickedHe, tectonicSystem);

      // Display tile and plate labels
      const tile = tectonicSystem.findTileFromEdge(clickedHe);
      if (tile) {
        this.visualizationManager.displayTileAndPlateLabels(tile);
      }

      // Recolor the tectonic system using current display mode
      this.tectonicManager.refreshPlateDisplay();

      // Check if tile is eligible for transfer to dominant plate
      this.tectonicManager.checkTileTransferEligibility(clickedHe);

      // Handle boundary display mode
      this.handleBoundaryDisplayClick(clickedHe, intersect.point);

      // Uncomment these to enable plate operations on click:
      // this.tectonicManager.splitPlateAtEdge(clickedHe);
      // this.tectonicManager.transferTileAtEdge(clickedHe);
      // this.tectonicManager.absorbPlateFromEdge(clickedHe);
    }
  }

  /**
   * Handles click for boundary display modes.
   * Finds the closest boundary to the click point and displays it according to the current mode.
   */
  private handleBoundaryDisplayClick(clickedHe: import('@core/Halfedge').Halfedge, clickPoint: THREE.Vector3): void {
    const tectonicSystem = this.tectonicManager.getTectonicSystem();
    if (!tectonicSystem) {
      console.warn('No tectonic system available for boundary display.');
      return;
    }

    // Find the closest boundary edge to the click point
    let closestBoundary = null;
    let closestDistance = Infinity;

    for (const boundary of tectonicSystem.boundaries) {
      for (const bEdge of boundary.boundaryEdges) {
        // Calculate midpoint of the edge
        const edgeMidpoint = bEdge.halfedge.vertex.position.clone()
          .add(bEdge.halfedge.next.vertex.position)
          .multiplyScalar(0.5);

        const distance = clickPoint.distanceTo(edgeMidpoint);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestBoundary = boundary;
        }
      }
    }

    if (!closestBoundary) {
      console.warn('No boundary found near the clicked point.');
      return;
    }

    // Store selection state
    this.visualizationManager.setCurrentSelection(clickedHe, clickPoint, closestBoundary);

    // Refresh display with current mode
    this.visualizationManager.refreshBoundaryDisplay(this.boundaryDisplayMode);
  }

  /**
   * Handles mouse move events (currently minimal implementation).
   */
  private onMouseMove(event: MouseEvent): void {
    const icosahedron = this.visualizationManager.getIcosahedron();

    if (!icosahedron) return;

    if (!this.selectionMode) return;

    const mouse = this.sceneManager.getMouse();
    const raycaster = this.sceneManager.getRaycaster();
    const camera = this.sceneManager.getCamera();

    // Calculate mouse position in normalized device coordinates
    // (-1 to +1) for both components
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update the raycaster with the camera and mouse position
    raycaster.setFromCamera(mouse, camera);

    // check if the geometry is indexed
    if (!icosahedron.geometry.index) {
      console.warn('Geometry is not indexed.');
      return;
    }

    // Calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObject(icosahedron);

    if (intersects.length > 0) {
      // Hover logic could be added here
    }
  }

  /**
   * Attaches event listeners to the window.
   */
  public attachEventListeners(): void {
    window.addEventListener('click', this.boundOnMouseClick, false);
    window.addEventListener('mousemove', this.boundOnMouseMove, false);
  }

  /**
   * Detaches event listeners from the window.
   */
  public detachEventListeners(): void {
    window.removeEventListener('click', this.boundOnMouseClick, false);
    window.removeEventListener('mousemove', this.boundOnMouseMove, false);
  }

  /**
   * Sets the selection mode.
   */
  public setSelectionMode(value: boolean): void {
    this.selectionMode = value;
  }

  /**
   * Gets the selection mode.
   */
  public getSelectionMode(): boolean {
    return this.selectionMode;
  }

  /**
   * Sets the boundary display mode.
   */
  public setBoundaryDisplayMode(value: BoundaryDisplayMode): void {
    this.boundaryDisplayMode = value;
  }

  /**
   * Gets the boundary display mode.
   */
  public getBoundaryDisplayMode(): BoundaryDisplayMode {
    return this.boundaryDisplayMode;
  }
}
