import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GUI } from 'dat.gui';
import { TabApplication } from './TabManager';
import { IcoTree, IcoCell } from '@core/icotree';
import { createGeometryFromTree, createWireframeGeometry, computeTreeStats } from '@core/icotree';

/**
 * IcoTree visualization application.
 * Provides an interactive view of the IcoTree spherical hexagonal/pentagonal cell structure.
 */
export class IcoTreeApplication implements TabApplication {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: OrbitControls;
  private gui: GUI | null = null;

  private icoTree: IcoTree;
  private sphereMesh: THREE.Mesh | null = null;
  private wireframeMesh: THREE.LineSegments | null = null;
  private highlightMesh: THREE.Mesh | null = null;
  private centersMesh: THREE.Points | null = null;
  private labelsGroup: THREE.Group | null = null;

  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private hoveredCell: IcoCell | null = null;

  private params = {
    showWireframe: true,
    showFaces: true,
    showCenters: false,
    showLabels: true,
    colorByCellType: true,
    autoRotate: false,
  };

  private initialized = false;
  private active = false;

  // Bind event handlers for proper removal
  private boundOnMouseMove: (event: MouseEvent) => void;
  private boundOnClick: (event: MouseEvent) => void;
  private boundOnResize: () => void;

  constructor() {
    // Initialize scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.z = 2.5;

    // Initialize renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.getContentArea().appendChild(this.renderer.domElement);

    // Initialize CSS2D renderer for labels (before updateRendererSize)
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.getContentArea().appendChild(this.labelRenderer.domElement);

    // Now update sizes for both renderers
    this.updateRendererSize();

    // Initially hidden
    this.renderer.domElement.style.display = 'none';
    this.labelRenderer.domElement.style.display = 'none';

    // Initialize controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Raycaster for interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Create IcoTree (starts with 12 pentagonal root cells)
    this.icoTree = new IcoTree();

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-5, -5, -5);
    this.scene.add(backLight);

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(1.5);
    this.scene.add(axesHelper);

    // Bind event handlers
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnClick = this.onClick.bind(this);
    this.boundOnResize = this.onResize.bind(this);
  }

  /**
   * Rebuilds the IcoTree meshes based on current parameters.
   */
  private rebuildMeshes(): void {
    // Remove existing meshes
    if (this.sphereMesh) {
      this.scene.remove(this.sphereMesh);
      this.sphereMesh.geometry.dispose();
      (this.sphereMesh.material as THREE.Material).dispose();
    }

    if (this.wireframeMesh) {
      this.scene.remove(this.wireframeMesh);
      this.wireframeMesh.geometry.dispose();
      (this.wireframeMesh.material as THREE.Material).dispose();
    }

    if (this.centersMesh) {
      this.scene.remove(this.centersMesh);
      this.centersMesh.geometry.dispose();
      (this.centersMesh.material as THREE.Material).dispose();
    }

    if (this.labelsGroup) {
      this.scene.remove(this.labelsGroup);
      // Dispose label DOM elements
      this.labelsGroup.traverse((obj) => {
        if (obj instanceof CSS2DObject) {
          obj.element.remove();
        }
      });
      this.labelsGroup = null;
    }

    // Create face geometry
    const geometry = createGeometryFromTree(this.icoTree);

    // Add vertex colors based on cell type or index
    const colors: number[] = [];

    for (const cell of this.icoTree.leaves()) {
      const color = this.getCellColor(cell);
      const n = cell.vertices.length;

      // Each cell is triangulated into n triangles (fan from center)
      // Each triangle has 3 vertices
      for (let i = 0; i < n; i++) {
        colors.push(color.r, color.g, color.b);
        colors.push(color.r, color.g, color.b);
        colors.push(color.r, color.g, color.b);
      }
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Create mesh material
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
      transparent: true,
      opacity: 0.9,
    });

    this.sphereMesh = new THREE.Mesh(geometry, material);
    this.sphereMesh.visible = this.params.showFaces;
    this.scene.add(this.sphereMesh);

    // Create wireframe
    const wireframeGeometry = createWireframeGeometry(this.icoTree);
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });

    this.wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    this.wireframeMesh.visible = this.params.showWireframe;
    this.scene.add(this.wireframeMesh);

    // Create cell centers as points
    const centersPositions: number[] = [];
    for (const cell of this.icoTree.leaves()) {
      const c = cell.center;
      centersPositions.push(c.x * 1.01, c.y * 1.01, c.z * 1.01); // Slightly above surface
    }

    const centersGeometry = new THREE.BufferGeometry();
    centersGeometry.setAttribute('position', new THREE.Float32BufferAttribute(centersPositions, 3));

    const centersMaterial = new THREE.PointsMaterial({
      color: 0xff0000,
      size: 0.05,
    });

    this.centersMesh = new THREE.Points(centersGeometry, centersMaterial);
    this.centersMesh.visible = this.params.showCenters;
    this.scene.add(this.centersMesh);

    // Create labels for each cell
    this.labelsGroup = new THREE.Group();
    for (const cell of this.icoTree.leaves()) {
      const labelDiv = document.createElement('div');
      labelDiv.className = 'icotree-cell-label';
      labelDiv.style.color = '#ffffff';
      labelDiv.style.fontSize = '10px';
      labelDiv.style.fontFamily = 'monospace';
      labelDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
      labelDiv.style.padding = '2px 4px';
      labelDiv.style.borderRadius = '3px';
      labelDiv.style.whiteSpace = 'nowrap';

      const cellType = cell.isPentagon ? 'P' : 'H';
      labelDiv.textContent = `${cell.id}:${cellType}`;

      const label = new CSS2DObject(labelDiv);
      // Position slightly above the surface
      const pos = cell.center.clone().multiplyScalar(1.02);
      label.position.copy(pos);
      this.labelsGroup.add(label);
    }
    this.labelsGroup.visible = this.params.showLabels;
    this.scene.add(this.labelsGroup);

    // Update stats in GUI
    this.updateStatsDisplay();
  }

  /**
   * Gets a color for a cell based on current color mode.
   */
  private getCellColor(cell: IcoCell): THREE.Color {
    if (this.params.colorByCellType) {
      // Pentagon = blue, Hexagon = green
      if (cell.isPentagon) {
        return new THREE.Color(0x4488ff);
      } else {
        return new THREE.Color(0x44ff88);
      }
    } else {
      // Color by cell ID (rainbow)
      const hue = (cell.id % 12) / 12;
      return new THREE.Color().setHSL(hue, 0.7, 0.5);
    }
  }

  /**
   * Creates and highlights a single cell.
   */
  private highlightCell(cell: IcoCell | null): void {
    // Remove previous highlight
    if (this.highlightMesh) {
      this.scene.remove(this.highlightMesh);
      this.highlightMesh.geometry.dispose();
      (this.highlightMesh.material as THREE.Material).dispose();
      this.highlightMesh = null;
    }

    if (!cell) return;

    // Create geometry for the highlighted cell (fan triangulation)
    const center = cell.center;
    const vertices = cell.vertices;
    const n = vertices.length;
    const positions: number[] = [];

    for (let i = 0; i < n; i++) {
      const v0 = center;
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];

      // Slightly above surface to avoid z-fighting
      const scale = 1.005;
      positions.push(v0.x * scale, v0.y * scale, v0.z * scale);
      positions.push(v1.x * scale, v1.y * scale, v1.z * scale);
      positions.push(v2.x * scale, v2.y * scale, v2.z * scale);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });

    this.highlightMesh = new THREE.Mesh(geometry, material);
    this.highlightMesh.renderOrder = 999;
    this.scene.add(this.highlightMesh);
  }

  /**
   * Handles mouse move for hover effects.
   */
  private onMouseMove(event: MouseEvent): void {
    if (!this.active || !this.sphereMesh) return;

    // Calculate mouse position in normalized device coordinates
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.sphereMesh);

    if (intersects.length > 0) {
      const point = intersects[0].point.clone().normalize();
      const cell = this.icoTree.findLeaf(point);

      if (cell !== this.hoveredCell) {
        this.hoveredCell = cell;
        this.highlightCell(cell);
      }
    } else {
      if (this.hoveredCell) {
        this.hoveredCell = null;
        this.highlightCell(null);
      }
    }
  }

  /**
   * Handles click to subdivide cells.
   */
  private onClick(_event: MouseEvent): void {
    if (!this.active || !this.hoveredCell) return;
    console.log(`Clicked cell ID: ${this.hoveredCell.id}, Depth: ${this.hoveredCell.depth}, Type: ${this.hoveredCell.isPentagon ? 'Pentagon' : 'Hexagon'}`);

    // Subdivide the clicked cell if it's a leaf and not too deep
    if (this.hoveredCell.isLeaf && this.hoveredCell.depth < 3) {
      // Use tree's subdivideCell to properly handle neighbor relationships
      this.icoTree.subdivideCell(this.hoveredCell);
      this.rebuildMeshes();
    }
  }

  /**
   * Gets the content area element, or falls back to body.
   */
  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  /**
   * Updates renderer size based on content area.
   */
  private updateRendererSize(): void {
    const contentArea = this.getContentArea();
    const width = contentArea.clientWidth || window.innerWidth;
    const height = contentArea.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  /**
   * Handles window resize.
   */
  private onResize(): void {
    this.updateRendererSize();
  }

  /**
   * Sets up the GUI controls.
   */
  private setupGUI(): void {
    this.gui = new GUI({ autoPlace: false });
    // Append GUI to content area
    this.getContentArea().appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0';
    this.gui.domElement.style.right = '0';

    // View controls
    const viewFolder = this.gui.addFolder('View');
    viewFolder
      .add(this.params, 'showFaces')
      .name('Show Faces')
      .onChange((value: boolean) => {
        if (this.sphereMesh) this.sphereMesh.visible = value;
      });
    viewFolder
      .add(this.params, 'showWireframe')
      .name('Show Wireframe')
      .onChange((value: boolean) => {
        if (this.wireframeMesh) this.wireframeMesh.visible = value;
      });
    viewFolder
      .add(this.params, 'showCenters')
      .name('Show Centers')
      .onChange((value: boolean) => {
        if (this.centersMesh) this.centersMesh.visible = value;
      });
    viewFolder
      .add(this.params, 'showLabels')
      .name('Show Labels')
      .onChange((value: boolean) => {
        if (this.labelsGroup) this.labelsGroup.visible = value;
      });
    viewFolder
      .add(this.params, 'colorByCellType')
      .name('Color by Type')
      .onChange(() => this.rebuildMeshes());
    viewFolder
      .add(this.params, 'autoRotate')
      .name('Auto Rotate')
      .onChange((value: boolean) => {
        this.controls.autoRotate = value;
      });
    viewFolder.open();

    // Stats
    const statsFolder = this.gui.addFolder('Stats');
    const pentagonController = statsFolder.add({ pentagons: 0 }, 'pentagons').name('Pentagons').listen();
    const hexagonController = statsFolder.add({ hexagons: 0 }, 'hexagons').name('Hexagons').listen();
    const totalController = statsFolder.add({ total: 0 }, 'total').name('Total Cells').listen();

    // Store references for updating
    (this as any)._statsControllers = { pentagonController, hexagonController, totalController };

    statsFolder.open();

    // Instructions
    const helpFolder = this.gui.addFolder('Help');
    helpFolder.add({ info: 'Click on a cell to subdivide' }, 'info').name('Interaction');
    helpFolder.add({ legend: 'Blue=Pentagon, Green=Hexagon' }, 'legend').name('Colors');
  }

  /**
   * Updates stats in the GUI.
   */
  private updateStatsDisplay(): void {
    const controllers = (this as any)._statsControllers;
    if (controllers) {
      const stats = computeTreeStats(this.icoTree);
      controllers.pentagonController.object.pentagons = stats.pentagons;
      controllers.hexagonController.object.hexagons = stats.hexagons;
      controllers.totalController.object.total = stats.leafCells;
    }
  }

  public activate(): void {
    if (!this.initialized) {
      // First-time initialization
      this.rebuildMeshes();
      this.setupGUI();

      // Attach event listeners
      this.renderer.domElement.addEventListener('mousemove', this.boundOnMouseMove);
      this.renderer.domElement.addEventListener('click', this.boundOnClick);
      window.addEventListener('resize', this.boundOnResize);

      this.initialized = true;
    }

    // Show renderer, label renderer, and GUI
    this.renderer.domElement.style.display = 'block';
    this.labelRenderer.domElement.style.display = 'block';
    if (this.gui) {
      this.gui.domElement.style.display = 'block';
    }

    // Update stats
    this.updateStatsDisplay();

    this.active = true;
  }

  public deactivate(): void {
    // Hide renderer, label renderer, and GUI
    this.renderer.domElement.style.display = 'none';
    this.labelRenderer.domElement.style.display = 'none';
    if (this.gui) {
      this.gui.domElement.style.display = 'none';
    }

    this.active = false;
  }

  public update(): void {
    if (!this.active) return;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    // Remove event listeners
    this.renderer.domElement.removeEventListener('mousemove', this.boundOnMouseMove);
    this.renderer.domElement.removeEventListener('click', this.boundOnClick);
    window.removeEventListener('resize', this.boundOnResize);

    // Dispose GUI
    if (this.gui) {
      this.gui.destroy();
    }

    // Dispose Three.js resources
    if (this.sphereMesh) {
      this.sphereMesh.geometry.dispose();
      (this.sphereMesh.material as THREE.Material).dispose();
    }

    if (this.wireframeMesh) {
      this.wireframeMesh.geometry.dispose();
      (this.wireframeMesh.material as THREE.Material).dispose();
    }

    if (this.centersMesh) {
      this.centersMesh.geometry.dispose();
      (this.centersMesh.material as THREE.Material).dispose();
    }

    if (this.highlightMesh) {
      this.highlightMesh.geometry.dispose();
      (this.highlightMesh.material as THREE.Material).dispose();
    }

    if (this.labelsGroup) {
      this.labelsGroup.traverse((obj) => {
        if (obj instanceof CSS2DObject) {
          obj.element.remove();
        }
      });
    }

    this.renderer.dispose();
    this.labelRenderer.domElement.remove();
  }
}
