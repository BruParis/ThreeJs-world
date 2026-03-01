import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GUI } from 'dat.gui';
import { TabApplication } from '../../tabs/TabManager';
import {
  IcoNetGeometry,
  IcoNetCoordinates,
  HexaTriangle,
  buildHexaTriangles,
  findTriangleAtPoint,
  interpolateLatLon,
  HexaCell,
  buildHexaCells,
  findCellAtPoint,
  computeCellCentroid,
} from '../../core/iconet';

/**
 * Icosahedral net visualization application.
 * Displays a 2D map with equilateral triangles arranged in strips.
 */
export class HexaTreeApplication implements TabApplication {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: OrbitControls;
  private gui: GUI | null = null;

  // 2D map elements
  private mapGroup: THREE.Group | null = null;
  private triangleMesh: THREE.Mesh | null = null;
  private triangleWireframe: THREE.LineSegments | null = null;
  private vertexMarkers: THREE.Points | null = null;

  // Geometry and coordinates
  private geometry: IcoNetGeometry | null = null;
  private coordinates: IcoNetCoordinates | null = null;
  private triangles: HexaTriangle[] = [];
  private hexaCells: HexaCell[] = [];

  // Triangle highlight
  private highlightMesh: THREE.Mesh | null = null;
  private highlightMaterial: THREE.MeshBasicMaterial | null = null;

  // Hexagon elements
  private hexagonWireframe: THREE.LineSegments | null = null;
  private hexagonHighlightMesh: THREE.Mesh | null = null;
  private hexagonHighlightMaterial: THREE.MeshBasicMaterial | null = null;

  // Hover label
  private hoverLabel: CSS2DObject | null = null;
  private hoverLabelElement: HTMLDivElement | null = null;

  // Raycasting
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private hoverPlane: THREE.Plane;

  // Hover info for GUI display
  private hoverInfo = {
    triangleId: -1,
    hexagonId: -1,
    lat: 0,
    lon: 0,
    latDisplay: '',
    lonDisplay: '',
  };

  private params = {
    showFaces: true,
    showWireframe: true,
    showVertices: true,
    showHexagons: true,
    hoverMode: 'triangle' as 'triangle' | 'hexagon',
  };

  private initialized = false;
  private active = false;

  private boundOnResize: () => void;
  private boundOnMouseMove: (event: MouseEvent) => void;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 8, 0);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.getContentArea().appendChild(this.renderer.domElement);

    // CSS2D renderer for labels
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.getContentArea().appendChild(this.labelRenderer.domElement);

    this.updateRendererSize();
    this.renderer.domElement.style.display = 'none';
    this.labelRenderer.domElement.style.display = 'none';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 10, 5);
    this.scene.add(directionalLight);

    const axesHelper = new THREE.AxesHelper(2);
    this.scene.add(axesHelper);

    // Raycasting setup
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Bind event handlers
    this.boundOnResize = this.onResize.bind(this);
    this.boundOnMouseMove = this.onMouseMove.bind(this);
  }

  /**
   * Creates the hover label element and CSS2DObject.
   */
  private createHoverLabel(): void {
    this.hoverLabelElement = document.createElement('div');
    this.hoverLabelElement.style.cssText = `
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 6px 10px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      transform: translate(-50%, -100%) translateY(-10px);
    `;
    this.hoverLabelElement.style.display = 'none';

    this.hoverLabel = new CSS2DObject(this.hoverLabelElement);
    this.hoverLabel.position.set(0, 0.1, 0);
    this.scene.add(this.hoverLabel);
  }

  /**
   * Handles mouse move for triangle hover detection.
   */
  private onMouseMove(event: MouseEvent): void {
    if (!this.geometry || !this.coordinates) return;

    const contentArea = this.getContentArea();
    const rect = contentArea.getBoundingClientRect();

    // Calculate normalized device coordinates
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Cast ray from camera through mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Find intersection with the horizontal plane at y=0
    const intersectPoint = new THREE.Vector3();
    const intersects = this.raycaster.ray.intersectPlane(this.hoverPlane, intersectPoint);

    if (!intersects) {
      this.hideHoverLabel();
      this.highlightTriangle(null);
      this.highlightHexagon(null);
      this.clearHoverInfo();
      return;
    }

    // Convert 3D intersection point to 2D (x, z -> x, y in 2D space)
    const point2D = { x: intersectPoint.x, y: intersectPoint.z };

    if (this.params.hoverMode === 'triangle') {
      this.handleTriangleHover(point2D, intersectPoint);
    } else {
      this.handleHexagonHover(point2D, intersectPoint);
    }
  }

  /**
   * Handles hover in triangle mode.
   */
  private handleTriangleHover(point2D: { x: number; y: number }, intersectPoint: THREE.Vector3): void {
    // Clear hexagon highlight
    this.highlightHexagon(null);

    // Find the triangle containing this point
    const triangle = findTriangleAtPoint(point2D, this.triangles);

    if (triangle) {
      // Interpolate lat/lon for the point
      const latLon = interpolateLatLon(point2D, triangle, this.coordinates!);
      const formatted = this.formatLatLon(latLon.lat, latLon.lon);

      // Update hover info
      this.hoverInfo.triangleId = triangle.id;
      this.hoverInfo.hexagonId = -1;
      this.hoverInfo.lat = latLon.lat;
      this.hoverInfo.lon = latLon.lon;
      this.hoverInfo.latDisplay = formatted.latDisplay;
      this.hoverInfo.lonDisplay = formatted.lonDisplay;

      // Show label and highlight
      this.showTriangleHoverLabel(triangle, latLon, intersectPoint);
      this.highlightTriangle(triangle);
    } else {
      this.hideHoverLabel();
      this.highlightTriangle(null);
      this.clearHoverInfo();
    }
  }

  /**
   * Handles hover in hexagon mode.
   */
  private handleHexagonHover(point2D: { x: number; y: number }, intersectPoint: THREE.Vector3): void {
    // Clear triangle highlight
    this.highlightTriangle(null);

    // Find the cell containing this point
    const cell = findCellAtPoint(point2D, this.hexaCells);

    if (cell) {
      // For lat/lon, we still use the triangle (hexagons don't have simple lat/lon mapping)
      const triangle = findTriangleAtPoint(point2D, this.triangles);
      let latLon = { lat: 0, lon: 0 };
      if (triangle) {
        latLon = interpolateLatLon(point2D, triangle, this.coordinates!);
      }
      const formatted = this.formatLatLon(latLon.lat, latLon.lon);

      // Update hover info
      this.hoverInfo.triangleId = -1;
      this.hoverInfo.hexagonId = cell.id;
      this.hoverInfo.lat = latLon.lat;
      this.hoverInfo.lon = latLon.lon;
      this.hoverInfo.latDisplay = formatted.latDisplay;
      this.hoverInfo.lonDisplay = formatted.lonDisplay;

      // Show label and highlight
      this.showHexagonHoverLabel(cell, latLon, intersectPoint);
      this.highlightHexagon(cell);
    } else {
      this.hideHoverLabel();
      this.highlightHexagon(null);
      this.clearHoverInfo();
    }
  }

  /**
   * Clears the hover info.
   */
  private clearHoverInfo(): void {
    this.hoverInfo.triangleId = -1;
    this.hoverInfo.hexagonId = -1;
    this.hoverInfo.lat = 0;
    this.hoverInfo.lon = 0;
    this.hoverInfo.latDisplay = '';
    this.hoverInfo.lonDisplay = '';
  }

  /**
   * Shows the hover label for the given triangle.
   */
  private showTriangleHoverLabel(
    triangle: HexaTriangle,
    latLon: { lat: number; lon: number },
    position: THREE.Vector3
  ): void {
    if (!this.hoverLabel || !this.hoverLabelElement) return;

    const formatted = this.formatLatLon(latLon.lat, latLon.lon);
    const rowNames = ['Top', 'Middle', 'Bottom'];

    this.hoverLabelElement.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 4px;">Triangle #${triangle.id}</div>
      <div>Lat: ${formatted.latDisplay}</div>
      <div>Lon: ${formatted.lonDisplay}</div>
      <div style="color: #aaa; margin-top: 4px;">${rowNames[triangle.row]} row${triangle.isUpPointing ? ' (up)' : ' (down)'}</div>
    `;
    this.hoverLabelElement.style.display = 'block';

    // Position label at the hover point
    this.hoverLabel.position.copy(position);
    this.hoverLabel.position.y = 0.1;
  }

  /**
   * Shows the hover label for the given hexagon cell.
   */
  private showHexagonHoverLabel(
    cell: HexaCell,
    latLon: { lat: number; lon: number },
    position: THREE.Vector3
  ): void {
    if (!this.hoverLabel || !this.hoverLabelElement) return;

    const formatted = this.formatLatLon(latLon.lat, latLon.lon);
    const rowNames = ['North Pole', 'Upper Ring', 'Lower Ring', 'South Pole'];
    const cellType = cell.isPole ? 'Pole' : 'Ring';
    const vertexCount = cell.vertices.length;

    this.hoverLabelElement.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 4px;">Hexagon #${cell.id}</div>
      <div>Lat: ${formatted.latDisplay}</div>
      <div>Lon: ${formatted.lonDisplay}</div>
      <div style="color: #aaa; margin-top: 4px;">${rowNames[cell.row]} (${cellType})</div>
      <div style="color: #aaa;">Vertices: ${vertexCount}</div>
    `;
    this.hoverLabelElement.style.display = 'block';

    // Position label at the hover point
    this.hoverLabel.position.copy(position);
    this.hoverLabel.position.y = 0.1;
  }

  /**
   * Hides the hover label.
   */
  private hideHoverLabel(): void {
    if (this.hoverLabelElement) {
      this.hoverLabelElement.style.display = 'none';
    }
  }

  /**
   * Builds the 2D map visualization using IcoNetGeometry.
   */
  private buildMap(): void {
    // Remove existing elements
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      this.mapGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose();
          }
        }
      });
    }

    this.mapGroup = new THREE.Group();

    // Build geometry using the IcoNetGeometry module
    this.geometry = new IcoNetGeometry({ triangleSize: 1.0, numCols: 5 });
    this.coordinates = new IcoNetCoordinates(this.geometry);
    this.triangles = buildHexaTriangles(this.geometry);
    this.hexaCells = buildHexaCells(this.geometry);

    // Create Three.js geometry
    const threeGeometry = this.createThreeGeometry();
    this.createMesh(threeGeometry);
    this.createWireframe();
    this.createVertexMarkers();
    this.createHighlightMesh();
    this.createHexagonWireframe();
    this.createHexagonHighlightMesh();

    // Create hover label
    this.createHoverLabel();

    this.scene.add(this.mapGroup);
  }

  /**
   * Creates a Three.js BufferGeometry from IcoNetGeometry data.
   */
  private createThreeGeometry(): THREE.BufferGeometry {
    const geo = this.geometry!;

    const positions: number[] = [];
    for (const v of geo.vertices) {
      positions.push(v.x, 0, v.y);
    }

    const indices: number[] = [];
    for (const [i0, i1, i2] of geo.faces) {
      indices.push(i0, i1, i2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Creates the triangle mesh with face colors.
   */
  private createMesh(geometry: THREE.BufferGeometry): void {
    const geo = this.geometry!;

    // Assign colors by row
    const colors: number[] = [];
    const rowColors = [
      new THREE.Color(0x4488ff), // Top row: blue
      new THREE.Color(0x44ff88), // Middle row: green
      new THREE.Color(0xff8844), // Bottom row: orange
    ];

    for (let fi = 0; fi < geo.faceCount; fi++) {
      const row = geo.getFaceRow(fi);
      const color = rowColors[row];
      for (let j = 0; j < 3; j++) {
        colors.push(color.r, color.g, color.b);
      }
    }

    // Non-indexed geometry for per-face colors
    const nonIndexedGeometry = geometry.toNonIndexed();
    nonIndexedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });

    this.triangleMesh = new THREE.Mesh(nonIndexedGeometry, material);
    this.triangleMesh.visible = this.params.showFaces;
    this.mapGroup!.add(this.triangleMesh);
  }

  /**
   * Creates the wireframe overlay.
   */
  private createWireframe(): void {
    const geo = this.geometry!;

    const wireframePositions: number[] = [];
    for (const [i0, i1, i2] of geo.faces) {
      const v0 = geo.vertices[i0];
      const v1 = geo.vertices[i1];
      const v2 = geo.vertices[i2];

      wireframePositions.push(v0.x, 0.01, v0.y, v1.x, 0.01, v1.y);
      wireframePositions.push(v1.x, 0.01, v1.y, v2.x, 0.01, v2.y);
      wireframePositions.push(v2.x, 0.01, v2.y, v0.x, 0.01, v0.y);
    }

    const wireframeGeometry = new THREE.BufferGeometry();
    wireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireframePositions, 3));

    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });

    this.triangleWireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    this.triangleWireframe.visible = this.params.showWireframe;
    this.mapGroup!.add(this.triangleWireframe);
  }

  /**
   * Creates vertex marker points.
   */
  private createVertexMarkers(): void {
    const geo = this.geometry!;

    const markerPositions: number[] = [];
    for (const v of geo.vertices) {
      markerPositions.push(v.x, 0.02, v.y);
    }

    const markerGeometry = new THREE.BufferGeometry();
    markerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(markerPositions, 3));

    const markerMaterial = new THREE.PointsMaterial({
      color: 0xff0000,
      size: 0.1,
    });

    this.vertexMarkers = new THREE.Points(markerGeometry, markerMaterial);
    this.vertexMarkers.visible = this.params.showVertices;
    this.mapGroup!.add(this.vertexMarkers);
  }

  /**
   * Creates the highlight mesh for hovering over triangles.
   */
  private createHighlightMesh(): void {
    // Create a single triangle geometry that will be updated on hover
    const highlightGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(9); // 3 vertices * 3 components
    highlightGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    this.highlightMesh = new THREE.Mesh(highlightGeometry, this.highlightMaterial);
    this.highlightMesh.renderOrder = 999; // Render on top
    this.highlightMesh.visible = false;
    this.mapGroup!.add(this.highlightMesh);
  }

  /**
   * Updates the highlight mesh to show the given triangle.
   */
  private highlightTriangle(triangle: HexaTriangle | null): void {
    if (!this.highlightMesh) return;

    if (!triangle) {
      this.highlightMesh.visible = false;
      return;
    }

    // Update geometry to match the triangle
    const positions = this.highlightMesh.geometry.attributes.position as THREE.BufferAttribute;
    const y = 0.005; // Slightly above the main mesh

    positions.setXYZ(0, triangle.v0.x, y, triangle.v0.y);
    positions.setXYZ(1, triangle.v1.x, y, triangle.v1.y);
    positions.setXYZ(2, triangle.v2.x, y, triangle.v2.y);
    positions.needsUpdate = true;

    this.highlightMesh.visible = true;
  }

  /**
   * Creates the wireframe for hexagon cells.
   */
  private createHexagonWireframe(): void {
    const wireframePositions: number[] = [];

    for (const cell of this.hexaCells) {
      const vertices = cell.vertices;
      const n = vertices.length;

      // Draw edges connecting consecutive vertices
      for (let i = 0; i < n; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % n];
        wireframePositions.push(v1.x, 0.015, v1.y);
        wireframePositions.push(v2.x, 0.015, v2.y);
      }
    }

    const wireframeGeometry = new THREE.BufferGeometry();
    wireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireframePositions, 3));

    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8,
    });

    this.hexagonWireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    this.hexagonWireframe.visible = this.params.showHexagons;
    this.mapGroup!.add(this.hexagonWireframe);
  }

  /**
   * Creates the highlight mesh for hovering over hexagons.
   */
  private createHexagonHighlightMesh(): void {
    // Create a buffer geometry that can hold up to 6 triangles (for hexagon fan)
    // A hexagon is drawn as a triangle fan from center to each edge
    const maxVertices = 7 * 3; // Up to 7-gon, 3 components per vertex
    const highlightGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(maxVertices * 3); // 6 triangles max
    highlightGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.hexagonHighlightMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    this.hexagonHighlightMesh = new THREE.Mesh(highlightGeometry, this.hexagonHighlightMaterial);
    this.hexagonHighlightMesh.renderOrder = 998;
    this.hexagonHighlightMesh.visible = false;
    this.mapGroup!.add(this.hexagonHighlightMesh);
  }

  /**
   * Updates the hexagon highlight mesh to show the given cell.
   */
  private highlightHexagon(cell: HexaCell | null): void {
    if (!this.hexagonHighlightMesh) return;

    if (!cell) {
      this.hexagonHighlightMesh.visible = false;
      return;
    }

    const vertices = cell.vertices;
    const n = vertices.length;
    const y = 0.008;

    // Compute centroid
    const centroid = computeCellCentroid(cell);

    // Create triangle fan: centroid to each pair of adjacent vertices
    const positions: number[] = [];
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];

      positions.push(centroid.x, y, centroid.y);
      positions.push(v1.x, y, v1.y);
      positions.push(v2.x, y, v2.y);
    }

    // Update geometry
    const posAttr = this.hexagonHighlightMesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.length; i++) {
      posAttr.array[i] = positions[i];
    }
    // Clear remaining positions
    for (let i = positions.length; i < posAttr.array.length; i++) {
      posAttr.array[i] = 0;
    }
    posAttr.needsUpdate = true;
    this.hexagonHighlightMesh.geometry.setDrawRange(0, positions.length / 3);

    this.hexagonHighlightMesh.visible = true;
  }

  /**
   * Formats lat/lon values for display.
   */
  private formatLatLon(lat: number, lon: number): { latDisplay: string; lonDisplay: string } {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 180 ? 'W' : 'E';
    const displayLon = lon > 180 ? 360 - lon : lon;

    return {
      latDisplay: `${Math.abs(lat).toFixed(2)}° ${latDir}`,
      lonDisplay: `${displayLon.toFixed(2)}° ${lonDir}`,
    };
  }

  private getContentArea(): HTMLElement {
    return document.getElementById('content-area') || document.body;
  }

  private updateRendererSize(): void {
    const contentArea = this.getContentArea();
    const width = contentArea.clientWidth || window.innerWidth;
    const height = contentArea.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  private onResize(): void {
    this.updateRendererSize();
  }

  private setupGUI(): void {
    this.gui = new GUI({ autoPlace: false });
    this.getContentArea().appendChild(this.gui.domElement);
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '0';
    this.gui.domElement.style.right = '0';

    const viewFolder = this.gui.addFolder('View');
    viewFolder
      .add(this.params, 'showFaces')
      .name('Show Faces')
      .onChange((value: boolean) => {
        if (this.triangleMesh) this.triangleMesh.visible = value;
      });
    viewFolder
      .add(this.params, 'showWireframe')
      .name('Show Wireframe')
      .onChange((value: boolean) => {
        if (this.triangleWireframe) this.triangleWireframe.visible = value;
      });
    viewFolder
      .add(this.params, 'showVertices')
      .name('Show Vertices')
      .onChange((value: boolean) => {
        if (this.vertexMarkers) this.vertexMarkers.visible = value;
      });
    viewFolder
      .add(this.params, 'showHexagons')
      .name('Show Hexagons')
      .onChange((value: boolean) => {
        if (this.hexagonWireframe) this.hexagonWireframe.visible = value;
      });
    viewFolder.open();

    const infoFolder = this.gui.addFolder('Info');
    infoFolder.add({ vertices: this.geometry?.vertexCount ?? 0 }, 'vertices').name('Vertices');
    infoFolder.add({ faces: this.geometry?.faceCount ?? 0 }, 'faces').name('Faces');
    infoFolder.add({ hexagons: this.hexaCells.length }, 'hexagons').name('Hexagons');

    // Hover settings folder
    const hoverSettingsFolder = this.gui.addFolder('Hover Settings');
    hoverSettingsFolder
      .add(this.params, 'hoverMode', ['triangle', 'hexagon'])
      .name('Hover Mode')
      .onChange(() => {
        // Clear current highlights when switching modes
        this.highlightTriangle(null);
        this.highlightHexagon(null);
        this.hideHoverLabel();
        this.clearHoverInfo();
      });

    // Hover info folder - displays real-time hover data
    const hoverFolder = this.gui.addFolder('Hover Info');
    hoverFolder.add(this.hoverInfo, 'triangleId').name('Triangle ID').listen();
    hoverFolder.add(this.hoverInfo, 'hexagonId').name('Hexagon ID').listen();
    hoverFolder.add(this.hoverInfo, 'latDisplay').name('Latitude').listen();
    hoverFolder.add(this.hoverInfo, 'lonDisplay').name('Longitude').listen();
    hoverFolder.open();
  }

  public activate(): void {
    if (!this.initialized) {
      this.buildMap();
      this.setupGUI();
      window.addEventListener('resize', this.boundOnResize);
      this.renderer.domElement.addEventListener('mousemove', this.boundOnMouseMove);
      this.initialized = true;
    }

    this.renderer.domElement.style.display = 'block';
    this.labelRenderer.domElement.style.display = 'block';
    if (this.gui) {
      this.gui.domElement.style.display = 'block';
    }
    this.active = true;
  }

  public deactivate(): void {
    this.renderer.domElement.style.display = 'none';
    this.labelRenderer.domElement.style.display = 'none';
    if (this.gui) {
      this.gui.domElement.style.display = 'none';
    }
    this.hideHoverLabel();
    this.active = false;
  }

  public update(): void {
    if (!this.active) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    window.removeEventListener('resize', this.boundOnResize);
    this.renderer.domElement.removeEventListener('mousemove', this.boundOnMouseMove);

    if (this.gui) {
      this.gui.destroy();
    }

    if (this.hoverLabel) {
      this.scene.remove(this.hoverLabel);
    }

    if (this.mapGroup) {
      this.mapGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose();
          }
        }
      });
    }

    this.renderer.dispose();
  }
}
