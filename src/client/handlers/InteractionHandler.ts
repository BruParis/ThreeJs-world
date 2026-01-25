import * as THREE from 'three';
import { SceneManager } from '../managers/SceneManager';
import { VisualizationManager } from '../managers/VisualizationManager';
import { TectonicManager } from '../managers/TectonicManager';
import { BoundaryEdge } from '../tectonics/data/Plate';

/**
 * Handles mouse interaction events, raycasting, and selection.
 */
export class InteractionHandler {
  private sceneManager: SceneManager;
  private visualizationManager: VisualizationManager;
  private tectonicManager: TectonicManager;
  private selectionMode: boolean = true;
  private iterateBoundaryEdgesMode: boolean = false;

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

      // Recolor the tectonic system
      this.tectonicManager.colorTectonicSystem(false);

      // Check if tile is eligible for transfer to dominant plate
      this.tectonicManager.checkTileTransferEligibility(clickedHe);

      // Handle iterate boundary edges debug mode
      if (this.iterateBoundaryEdgesMode) {
        this.handleIterateBoundaryEdgesClick(clickedHe, intersect.point);
      }

      // Uncomment these to enable plate operations on click:
      // this.tectonicManager.splitPlateAtEdge(clickedHe);
      // this.tectonicManager.transferTileAtEdge(clickedHe);
      // this.tectonicManager.absorbPlateFromEdge(clickedHe);
    }
  }

  /**
   * Handles click in iterate boundary edges debug mode.
   * Finds the boundary, warns if not updated, finds closest limit edge,
   * and colors edges with gradient.
   */
  private handleIterateBoundaryEdgesClick(clickedHe: import('@core/Halfedge').Halfedge, clickPoint: THREE.Vector3): void {
    const tectonicSystem = this.tectonicManager.getTectonicSystem();
    if (!tectonicSystem) {
      console.warn('No tectonic system available for boundary iteration.');
      return;
    }

    // Find boundary from clicked edge
    const boundary = tectonicSystem.edge2BoundaryMap.get(clickedHe);
    if (!boundary) {
      console.warn('Clicked edge is not on a plate boundary.');
      return;
    }

    // Check if boundary has limit edges
    if (!boundary.limitEdges) {
      console.warn(`Boundary ${boundary.id} has no limit edges. Call update() on the boundary first, or it may be a closed loop.`);
      return;
    }

    const [limitA, limitB] = boundary.limitEdges;

    // Find the closest limit edge to the click point
    const distToA = this.distanceToEdge(clickPoint, limitA);
    const distToB = this.distanceToEdge(clickPoint, limitB);
    const closestLimit = distToA < distToB ? limitA : limitB;

    console.log(`Iterating boundary ${boundary.id} from limit edge (distance A: ${distToA.toFixed(3)}, B: ${distToB.toFixed(3)})`);

    // Display the boundary with gradient coloring starting from closest limit
    this.visualizationManager.displayBoundaryGradient(boundary, closestLimit);
  }

  /**
   * Computes the distance from a point to a boundary edge (using edge midpoint).
   */
  private distanceToEdge(point: THREE.Vector3, edge: BoundaryEdge): number {
    const edgeStart = edge.halfedge.vertex.position;
    const edgeEnd = edge.halfedge.next.vertex.position;
    const midpoint = new THREE.Vector3().addVectors(edgeStart, edgeEnd).multiplyScalar(0.5);
    return point.distanceTo(midpoint);
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
   * Sets the iterate boundary edges debug mode.
   */
  public setIterateBoundaryEdgesMode(value: boolean): void {
    this.iterateBoundaryEdgesMode = value;
  }

  /**
   * Gets the iterate boundary edges debug mode.
   */
  public getIterateBoundaryEdgesMode(): boolean {
    return this.iterateBoundaryEdgesMode;
  }
}
