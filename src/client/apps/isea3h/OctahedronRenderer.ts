import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { ISEA3HCellDisplayInfo } from './ISEA3HEncoding';
import {
  ProjectionMode,
  setProjectionMode,
  getProjectionMode,
  projectToSphere as projectToSphereAPI,
  interpolateGreatArc as interpolateGreatArcAPI,
} from './ISEA3HSnyderProjection';

// Re-export ProjectionMode for convenience
export { ProjectionMode } from './ISEA3HSnyderProjection';

export interface GUIParams {
  showFaces: boolean;
  showWireframe: boolean;
  showVertices: boolean;
  sphereMode: boolean;
  projectionMode: ProjectionMode;
}

// Number of segments to subdivide great arcs
const GREAT_ARC_SEGMENTS = 16;
// Offset to lift lines above the sphere surface
const SPHERE_LINE_OFFSET = 0.005;
// Offset to lift lines above the octahedron surface
const OCTAHEDRON_LINE_OFFSET = 0.005;
// Line widths for marker lines
const BARYCENTER_LINE_WIDTH = 4;
const NEIGHBOR_LINE_WIDTH = 2;

/**
 * Gets the octahedron face signature for a point.
 * Returns a string like "++-" indicating the signs of (x, y, z).
 */
function getOctahedronFace(point: THREE.Vector3): string {
  const sx = point.x >= 0 ? '+' : '-';
  const sy = point.y >= 0 ? '+' : '-';
  const sz = point.z >= 0 ? '+' : '-';
  return `${sx}${sy}${sz}`;
}

/**
 * Projects a point onto the octahedron surface.
 * The octahedron is defined by |x| + |y| + |z| = 1.
 */
function projectToOctahedron(point: THREE.Vector3, offset: number = 0): THREE.Vector3 {
  const sum = Math.abs(point.x) + Math.abs(point.y) + Math.abs(point.z);
  if (sum === 0) return new THREE.Vector3(1, 0, 0); // Fallback

  const scale = (1 + offset) / sum;
  return new THREE.Vector3(point.x * scale, point.y * scale, point.z * scale);
}

/**
 * Interpolates along the octahedron surface between two points.
 * Handles face crossings by finding edge intersections.
 * Returns an array of points along the path.
 */
function interpolateOctahedronPath(
  start: THREE.Vector3,
  end: THREE.Vector3,
  offset: number = 0
): THREE.Vector3[] {
  const startFace = getOctahedronFace(start);
  const endFace = getOctahedronFace(end);

  // If same face, just return the two endpoints projected onto the surface
  if (startFace === endFace) {
    return [
      projectToOctahedron(start, offset),
      projectToOctahedron(end, offset)
    ];
  }

  // Find which coordinates change sign between start and end
  const crossings: { axis: 'x' | 'y' | 'z'; t: number }[] = [];

  if (Math.sign(start.x) !== Math.sign(end.x) && start.x !== 0 && end.x !== 0) {
    // Find t where x = 0: start.x + t * (end.x - start.x) = 0
    const t = -start.x / (end.x - start.x);
    if (t > 0 && t < 1) {
      crossings.push({ axis: 'x', t });
    }
  }
  if (Math.sign(start.y) !== Math.sign(end.y) && start.y !== 0 && end.y !== 0) {
    const t = -start.y / (end.y - start.y);
    if (t > 0 && t < 1) {
      crossings.push({ axis: 'y', t });
    }
  }
  if (Math.sign(start.z) !== Math.sign(end.z) && start.z !== 0 && end.z !== 0) {
    const t = -start.z / (end.z - start.z);
    if (t > 0 && t < 1) {
      crossings.push({ axis: 'z', t });
    }
  }

  // Sort crossings by t value
  crossings.sort((a, b) => a.t - b.t);

  // Build the path with crossing points
  const path: THREE.Vector3[] = [projectToOctahedron(start, offset)];

  for (const crossing of crossings) {
    const t = crossing.t;
    const crossPoint = new THREE.Vector3(
      start.x + t * (end.x - start.x),
      start.y + t * (end.y - start.y),
      start.z + t * (end.z - start.z)
    );
    path.push(projectToOctahedron(crossPoint, offset));
  }

  path.push(projectToOctahedron(end, offset));

  return path;
}

/**
 * Creates a polygon path on the octahedron surface, handling face crossings.
 */
function createOctahedronPolygonPath(
  vertices: THREE.Vector3[],
  offset: number = 0
): THREE.Vector3[] {
  const path: THREE.Vector3[] = [];
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const start = vertices[i];
    const end = vertices[(i + 1) % n];

    const segmentPath = interpolateOctahedronPath(start, end, offset);

    // Add all points except the last (to avoid duplicates at joints)
    for (let j = 0; j < segmentPath.length - 1; j++) {
      path.push(segmentPath[j]);
    }
  }

  // Close the loop
  if (path.length > 0) {
    path.push(path[0].clone());
  }

  return path;
}

/**
 * Renders an octahedron with vertices at (±1,0,0), (0,±1,0), (0,0,±1).
 * The primary face is defined by vertices (1,0,0), (0,1,0), (0,0,1).
 * Can toggle between octahedron and sphere mode.
 */
export class OctahedronRenderer {
  private scene: THREE.Scene;

  // Mode
  private sphereMode: boolean = true;

  // Meshes
  private octahedronMesh: THREE.Mesh | null = null;
  private wireframeMesh: THREE.LineSegments | null = null;
  private sphereWireframeMesh: THREE.Line | null = null;
  private vertexMarkers: THREE.Points | null = null;
  private sphereMesh: THREE.Mesh | null = null;

  // Cell visualization (from GUI input)
  private cellBarycenterMarker: Line2 | null = null;
  private cellOutline: THREE.Line | null = null;
  private neighborMarkers: Line2[] = [];
  private parentCellOutlines: THREE.Line[] = [];

  // Hover visualization
  private hoverCellOutlines: THREE.Line[] = [];
  private hoverNeighborMarkers: Line2[] = [];
  private hoverBarycenterMarker: Line2 | null = null;

  // Projection debug visualization
  private projectionDebugOctPoints: THREE.Points | null = null;
  private projectionDebugSpherePoints: THREE.Points | null = null;
  private projectionDebugLines: THREE.LineSegments | null = null;
  private projectionDebugSubdivisions: number = 0; // 0 means debug is disabled

  // Octahedron vertices
  public readonly vertices: THREE.Vector3[] = [
    new THREE.Vector3(1, 0, 0),   // 0: +X
    new THREE.Vector3(-1, 0, 0),  // 1: -X
    new THREE.Vector3(0, 1, 0),   // 2: +Y
    new THREE.Vector3(0, -1, 0),  // 3: -Y
    new THREE.Vector3(0, 0, 1),   // 4: +Z
    new THREE.Vector3(0, 0, -1),  // 5: -Z
  ];

  // Face indices (8 triangular faces)
  // Each face is defined by 3 vertex indices
  public readonly faces: number[][] = [
    // Top faces (y > 0)
    [0, 2, 4],  // +X, +Y, +Z
    [4, 2, 1],  // +Z, +Y, -X
    [1, 2, 5],  // -X, +Y, -Z
    [5, 2, 0],  // -Z, +Y, +X
    // Bottom faces (y < 0)
    [0, 4, 3],  // +X, +Z, -Y
    [4, 1, 3],  // +Z, -X, -Y
    [1, 5, 3],  // -X, -Z, -Y
    [5, 0, 3],  // -Z, +X, -Y
  ];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Builds the octahedron visualization.
   */
  build(params: GUIParams): void {
    this.sphereMode = params.sphereMode;
    setProjectionMode(params.projectionMode);

    this.buildOctahedronMesh();
    this.buildWireframe();
    this.buildSphereWireframe();
    this.buildVertexMarkers();
    this.buildSphereMesh();

    this.setVisibility('faces', params.showFaces);
    this.setVisibility('wireframe', params.showWireframe);
    this.setVisibility('vertices', params.showVertices);
    this.updateSphereMode(params.sphereMode);
  }

  /**
   * Builds the semi-transparent sphere mesh.
   */
  private buildSphereMesh(): void {
    const geometry = new THREE.SphereGeometry(1, 64, 32);
    const material = new THREE.MeshLambertMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    this.sphereMesh = new THREE.Mesh(geometry, material);
    this.sphereMesh.visible = false;
    this.scene.add(this.sphereMesh);
  }

  /**
   * Updates sphere mode: toggles between octahedron and sphere display.
   */
  updateSphereMode(enabled: boolean): void {
    this.sphereMode = enabled;

    // Toggle octahedron visibility
    if (this.octahedronMesh) {
      this.octahedronMesh.visible = !enabled;
    }

    // Toggle wireframe visibility (octahedron vs sphere wireframe)
    if (this.wireframeMesh && this.sphereWireframeMesh) {
      const wireframeVisible = this.wireframeMesh.visible || this.sphereWireframeMesh.visible;
      this.wireframeMesh.visible = !enabled && wireframeVisible;
      this.sphereWireframeMesh.visible = enabled && wireframeVisible;
    }

    // Toggle sphere visibility
    if (this.sphereMesh) {
      this.sphereMesh.visible = enabled;
    }
  }

  /**
   * Gets the current sphere mode state.
   */
  isSphereMode(): boolean {
    return this.sphereMode;
  }

  /**
   * Updates the projection mode (Snyder or normalization).
   * Rebuilds visualizations that depend on the projection.
   */
  updateProjectionMode(mode: ProjectionMode): void {
    setProjectionMode(mode);

    // Rebuild the sphere wireframe with the new projection
    const existingWireframe = this.sphereWireframeMesh;
    if (existingWireframe) {
      const wasVisible = existingWireframe.visible;
      existingWireframe.geometry.dispose();
      (existingWireframe.material as THREE.Material).dispose();
      this.scene.remove(existingWireframe);
      this.sphereWireframeMesh = null;
      this.buildSphereWireframe();
      // buildSphereWireframe() sets this.sphereWireframeMesh
      if (this.sphereWireframeMesh !== null) {
        (this.sphereWireframeMesh as THREE.LineSegments).visible = wasVisible;
      }
    }

    // Refresh projection debug if it was enabled
    if (this.projectionDebugSubdivisions > 0) {
      this.displayProjectionDebug(this.projectionDebugSubdivisions);
    }
  }

  /**
   * Gets the current projection mode.
   */
  getProjectionMode(): ProjectionMode {
    return getProjectionMode();
  }

  /**
   * Projects a point from the octahedron surface onto the unit sphere
   * using the current projection mode (Snyder or normalization).
   */
  private projectToSphere(point: THREE.Vector3, offset: number = 0): THREE.Vector3 {
    return projectToSphereAPI(point, offset);
  }

  /**
   * Interpolates along a great arc between two points.
   * The input points are on the octahedron surface and are projected
   * to the sphere using the current projection mode.
   * Returns an array of points along the arc on the sphere.
   */
  private interpolateGreatArc(
    start: THREE.Vector3,
    end: THREE.Vector3,
    segments: number,
    offset: number = 0
  ): THREE.Vector3[] {
    return interpolateGreatArcAPI(start, end, segments, offset);
  }

  /**
   * Creates a polygon outline as great arc segments on the sphere.
   */
  private createGreatArcPolygon(
    vertices: THREE.Vector3[],
    color: number,
    offset: number = SPHERE_LINE_OFFSET
  ): THREE.Line | null {
    if (vertices.length < 3) return null;

    const allPoints: THREE.Vector3[] = [];

    // Create great arc segments between consecutive vertices
    for (let i = 0; i < vertices.length; i++) {
      const start = vertices[i];
      const end = vertices[(i + 1) % vertices.length];

      const arcPoints = this.interpolateGreatArc(start, end, GREAT_ARC_SEGMENTS, offset);

      // Add all points except the last one (to avoid duplicates at joins)
      for (let j = 0; j < arcPoints.length - 1; j++) {
        allPoints.push(arcPoints[j]);
      }
    }

    // Close the loop by adding the first point
    if (allPoints.length > 0) {
      allPoints.push(allPoints[0].clone());
    }

    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];

    for (const p of allPoints) {
      positions.push(p.x, p.y, p.z);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    return line;
  }

  private buildOctahedronMesh(): void {
    const geometry = new THREE.BufferGeometry();

    // Create position array for all faces
    const positions: number[] = [];
    const colors: number[] = [];

    // Color palette for faces
    const faceColors = [
      new THREE.Color(0x4a90d9), // Blue
      new THREE.Color(0x50c878), // Green
      new THREE.Color(0xffa500), // Orange
      new THREE.Color(0xff6b6b), // Red
      new THREE.Color(0x9b59b6), // Purple
      new THREE.Color(0xf39c12), // Yellow
      new THREE.Color(0x1abc9c), // Teal
      new THREE.Color(0xe74c3c), // Crimson
    ];

    for (let i = 0; i < this.faces.length; i++) {
      const face = this.faces[i];
      const color = faceColors[i];

      for (const vertexIndex of face) {
        const v = this.vertices[vertexIndex];
        positions.push(v.x, v.y, v.z);
        colors.push(color.r, color.g, color.b);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    this.octahedronMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.octahedronMesh);
  }

  private buildWireframe(): void {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];

    // Create edges for each face
    for (const face of this.faces) {
      for (let i = 0; i < 3; i++) {
        const v1 = this.vertices[face[i]];
        const v2 = this.vertices[face[(i + 1) % 3]];
        positions.push(v1.x, v1.y, v1.z);
        positions.push(v2.x, v2.y, v2.z);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.wireframeMesh = new THREE.LineSegments(geometry, material);
    this.scene.add(this.wireframeMesh);
  }

  /**
   * Builds the sphere wireframe with great arc edges.
   */
  private buildSphereWireframe(): void {
    // Collect unique edges (to avoid duplicates from shared edges between faces)
    const edgeSet = new Set<string>();
    const edges: [THREE.Vector3, THREE.Vector3][] = [];

    for (const face of this.faces) {
      for (let i = 0; i < 3; i++) {
        const idx1 = face[i];
        const idx2 = face[(i + 1) % 3];
        // Create a canonical edge key (smaller index first)
        const edgeKey = idx1 < idx2 ? `${idx1}-${idx2}` : `${idx2}-${idx1}`;

        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push([this.vertices[idx1], this.vertices[idx2]]);
        }
      }
    }

    // Build great arc segments for each edge
    const positions: number[] = [];

    for (const [v1, v2] of edges) {
      const arcPoints = this.interpolateGreatArc(v1, v2, GREAT_ARC_SEGMENTS, SPHERE_LINE_OFFSET);

      // Add line segments between consecutive arc points
      for (let i = 0; i < arcPoints.length - 1; i++) {
        positions.push(arcPoints[i].x, arcPoints[i].y, arcPoints[i].z);
        positions.push(arcPoints[i + 1].x, arcPoints[i + 1].y, arcPoints[i + 1].z);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.sphereWireframeMesh = new THREE.LineSegments(geometry, material);
    this.sphereWireframeMesh.visible = false;
    this.scene.add(this.sphereWireframeMesh);
  }

  private buildVertexMarkers(): void {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];

    for (const v of this.vertices) {
      positions.push(v.x, v.y, v.z);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xff0000,
      size: 0.1,
      sizeAttenuation: true,
    });

    this.vertexMarkers = new THREE.Points(geometry, material);
    this.scene.add(this.vertexMarkers);
  }

  /**
   * Sets visibility of a visual element.
   */
  setVisibility(key: string, visible: boolean): void {
    switch (key) {
      case 'faces':
        if (this.octahedronMesh) this.octahedronMesh.visible = visible;
        break;
      case 'wireframe':
        // Show the appropriate wireframe based on current mode
        if (this.wireframeMesh) {
          this.wireframeMesh.visible = visible && !this.sphereMode;
        }
        if (this.sphereWireframeMesh) {
          this.sphereWireframeMesh.visible = visible && this.sphereMode;
        }
        break;
      case 'vertices':
        if (this.vertexMarkers) this.vertexMarkers.visible = visible;
        break;
    }
  }

  /**
   * Displays an ISEA3H cell with its barycenter, outline, and neighbors.
   */
  displayCell(displayInfo: ISEA3HCellDisplayInfo): void {
    this.clearCellDisplay();

    // Display barycenter (yellow to distinguish from red octahedron vertices)
    this.displayBarycenter(displayInfo.barycenter, 0xffff00, 0.08);

    // Display neighbor barycenters
    this.displayNeighborMarkers(displayInfo.neighborBarycenters);

    // Display cell outline
    this.displayCellOutline(displayInfo.cellVertices, 0x00ff00);
  }

  /**
   * Displays a cell at a higher level (parent) with different styling.
   */
  displayParentCell(displayInfo: ISEA3HCellDisplayInfo, color: number = 0xffff00): void {
    // Create parent outline with different color
    const outline = this.createCellOutline(displayInfo.cellVertices, color);
    if (outline) {
      this.parentCellOutlines.push(outline);
    }
  }

  /**
   * Displays the barycenter as a thick line extending from the surface.
   */
  private displayBarycenter(position: THREE.Vector3, color: number, height: number = 0.08): void {
    // Project to appropriate surface
    const basePos = this.sphereMode
      ? this.projectToSphere(position, SPHERE_LINE_OFFSET)
      : projectToOctahedron(position, OCTAHEDRON_LINE_OFFSET);

    // Create line extending outward from the surface
    const direction = basePos.clone().normalize();
    const endPos = basePos.clone().addScaledVector(direction, height);

    const geometry = new LineGeometry();
    geometry.setPositions([
      basePos.x, basePos.y, basePos.z,
      endPos.x, endPos.y, endPos.z
    ]);

    const material = new LineMaterial({
      color,
      linewidth: BARYCENTER_LINE_WIDTH,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });

    this.cellBarycenterMarker = new Line2(geometry, material);
    this.scene.add(this.cellBarycenterMarker);
  }

  /**
   * Displays neighbor barycenters as thick lines extending from the surface.
   */
  private displayNeighborMarkers(positions: THREE.Vector3[], height: number = 0.04): void {
    if (positions.length === 0) return;

    for (const pos of positions) {
      // Project to appropriate surface
      const basePos = this.sphereMode
        ? this.projectToSphere(pos, SPHERE_LINE_OFFSET)
        : projectToOctahedron(pos, OCTAHEDRON_LINE_OFFSET);

      // Create line extending outward from the surface
      const direction = basePos.clone().normalize();
      const endPos = basePos.clone().addScaledVector(direction, height);

      const geometry = new LineGeometry();
      geometry.setPositions([
        basePos.x, basePos.y, basePos.z,
        endPos.x, endPos.y, endPos.z
      ]);

      const material = new LineMaterial({
        color: 0x0088ff,
        linewidth: NEIGHBOR_LINE_WIDTH,
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      });

      const line = new Line2(geometry, material);
      this.neighborMarkers.push(line);
      this.scene.add(line);
    }
  }

  /**
   * Displays the cell outline (hexagon or square).
   */
  private displayCellOutline(vertices: THREE.Vector3[], color: number): void {
    const outline = this.createCellOutline(vertices, color);
    if (outline) {
      this.cellOutline = outline;
    }
  }

  /**
   * Creates a cell outline from vertices.
   * In sphere mode, uses great arc segments.
   * In octahedron mode, follows the octahedron surface handling face crossings.
   */
  private createCellOutline(vertices: THREE.Vector3[], color: number): THREE.Line | null {
    if (vertices.length < 3) return null;

    if (this.sphereMode) {
      return this.createGreatArcPolygon(vertices, color, SPHERE_LINE_OFFSET);
    }

    // Octahedron mode: follow the surface, handling face crossings
    const path = createOctahedronPolygonPath(vertices, OCTAHEDRON_LINE_OFFSET);

    if (path.length < 2) return null;

    const geometry = new THREE.BufferGeometry();
    const posArray: number[] = [];

    for (const p of path) {
      posArray.push(p.x, p.y, p.z);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));

    const material = new THREE.LineBasicMaterial({ color });
    const outline = new THREE.Line(geometry, material);
    this.scene.add(outline);
    return outline;
  }

  /**
   * Clears all cell visualization.
   */
  clearCellDisplay(): void {
    if (this.cellBarycenterMarker) {
      this.cellBarycenterMarker.geometry.dispose();
      (this.cellBarycenterMarker.material as THREE.Material).dispose();
      this.scene.remove(this.cellBarycenterMarker);
      this.cellBarycenterMarker = null;
    }

    if (this.cellOutline) {
      this.cellOutline.geometry.dispose();
      (this.cellOutline.material as THREE.Material).dispose();
      this.scene.remove(this.cellOutline);
      this.cellOutline = null;
    }

    for (const marker of this.neighborMarkers) {
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      this.scene.remove(marker);
    }
    this.neighborMarkers = [];

    this.clearParentCellDisplay();
  }

  /**
   * Clears parent cell outlines.
   */
  clearParentCellDisplay(): void {
    for (const outline of this.parentCellOutlines) {
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
      this.scene.remove(outline);
    }
    this.parentCellOutlines = [];
  }

  /**
   * Gets the sphere mesh for raycasting.
   */
  getSphereMesh(): THREE.Mesh | null {
    return this.sphereMesh;
  }

  /**
   * Gets the octahedron mesh for raycasting.
   */
  getOctahedronMesh(): THREE.Mesh | null {
    return this.octahedronMesh;
  }

  /**
   * Displays a hover cell outline.
   */
  displayHoverCell(displayInfo: ISEA3HCellDisplayInfo, color: number): void {
    if (displayInfo.cellVertices.length < 3) return;

    const outline = this.createCellOutline(displayInfo.cellVertices, color);
    if (outline) {
      this.hoverCellOutlines.push(outline);
    }
  }

  /**
   * Displays the barycenter of the hovered cell as a thick line extending from the surface.
   */
  displayHoverBarycenter(position: THREE.Vector3, color: number = 0xff0000, height: number = 0.08): void {
    // Clear previous hover barycenter marker
    if (this.hoverBarycenterMarker) {
      this.hoverBarycenterMarker.geometry.dispose();
      (this.hoverBarycenterMarker.material as THREE.Material).dispose();
      this.scene.remove(this.hoverBarycenterMarker);
      this.hoverBarycenterMarker = null;
    }

    // Project to appropriate surface
    const basePos = this.sphereMode
      ? this.projectToSphere(position, SPHERE_LINE_OFFSET)
      : projectToOctahedron(position, OCTAHEDRON_LINE_OFFSET);

    // Create line extending outward from the surface
    const direction = basePos.clone().normalize();
    const endPos = basePos.clone().addScaledVector(direction, height);

    const geometry = new LineGeometry();
    geometry.setPositions([
      basePos.x, basePos.y, basePos.z,
      endPos.x, endPos.y, endPos.z
    ]);

    const material = new LineMaterial({
      color,
      linewidth: BARYCENTER_LINE_WIDTH,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });

    this.hoverBarycenterMarker = new Line2(geometry, material);
    this.scene.add(this.hoverBarycenterMarker);
  }

  /**
   * Displays neighbor barycenters for hover mode as thick lines extending from the surface.
   */
  displayHoverNeighborBarycenters(positions: THREE.Vector3[], color: number = 0xff00ff, height: number = 0.04): void {
    // Clear previous hover neighbor markers
    for (const marker of this.hoverNeighborMarkers) {
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      this.scene.remove(marker);
    }
    this.hoverNeighborMarkers = [];

    if (positions.length === 0) return;

    for (const pos of positions) {
      // Project to appropriate surface
      const basePos = this.sphereMode
        ? this.projectToSphere(pos, SPHERE_LINE_OFFSET)
        : projectToOctahedron(pos, OCTAHEDRON_LINE_OFFSET);

      // Create line extending outward from the surface
      const direction = basePos.clone().normalize();
      const endPos = basePos.clone().addScaledVector(direction, height);

      const geometry = new LineGeometry();
      geometry.setPositions([
        basePos.x, basePos.y, basePos.z,
        endPos.x, endPos.y, endPos.z
      ]);

      const material = new LineMaterial({
        color,
        linewidth: NEIGHBOR_LINE_WIDTH,
        resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      });

      const line = new Line2(geometry, material);
      this.hoverNeighborMarkers.push(line);
      this.scene.add(line);
    }
  }

  /**
   * Clears all hover cell displays.
   */
  clearHoverDisplay(): void {
    for (const outline of this.hoverCellOutlines) {
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
      this.scene.remove(outline);
    }
    this.hoverCellOutlines = [];

    for (const marker of this.hoverNeighborMarkers) {
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      this.scene.remove(marker);
    }
    this.hoverNeighborMarkers = [];

    if (this.hoverBarycenterMarker) {
      this.hoverBarycenterMarker.geometry.dispose();
      (this.hoverBarycenterMarker.material as THREE.Material).dispose();
      this.scene.remove(this.hoverBarycenterMarker);
      this.hoverBarycenterMarker = null;
    }
  }

  /**
   * Displays debug visualization for the current projection mode.
   * Samples points regularly on the octahedron and shows their projection on the sphere.
   * @param subdivisions Number of subdivisions per edge of each octahedron face
   */
  displayProjectionDebug(subdivisions: number = 10): void {
    this.clearProjectionDebug();
    this.projectionDebugSubdivisions = subdivisions;

    const octPoints: THREE.Vector3[] = [];
    const octPointsOffset: THREE.Vector3[] = [];
    const spherePoints: THREE.Vector3[] = [];
    const linePositions: number[] = [];

    // Offset to lift points above the octahedron surface
    const OCT_POINT_OFFSET = 0.01;

    // Sample each octahedron face using barycentric coordinates
    for (const face of this.faces) {
      const v0 = this.vertices[face[0]];
      const v1 = this.vertices[face[1]];
      const v2 = this.vertices[face[2]];

      // Compute face normal for offset
      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const faceNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      // Generate points using barycentric subdivision
      for (let i = 0; i <= subdivisions; i++) {
        for (let j = 0; j <= subdivisions - i; j++) {
          const k = subdivisions - i - j;

          // Barycentric coordinates (normalized)
          const u = i / subdivisions;
          const v = j / subdivisions;
          const w = k / subdivisions;

          // Point on octahedron face
          const octPoint = new THREE.Vector3(
            u * v0.x + v * v1.x + w * v2.x,
            u * v0.y + v * v1.y + w * v2.y,
            u * v0.z + v * v1.z + w * v2.z
          );

          // Offset point along face normal
          const octPointWithOffset = octPoint.clone().addScaledVector(faceNormal, OCT_POINT_OFFSET);

          // Project to sphere using current projection mode
          const spherePoint = this.projectToSphere(octPoint, SPHERE_LINE_OFFSET);

          octPoints.push(octPoint);
          octPointsOffset.push(octPointWithOffset);
          spherePoints.push(spherePoint);

          // Add line from octahedron point (with offset) to sphere point
          linePositions.push(octPointWithOffset.x, octPointWithOffset.y, octPointWithOffset.z);
          linePositions.push(spherePoint.x, spherePoint.y, spherePoint.z);
        }
      }
    }

    // Create points on octahedron surface (with offset)
    const octPointsGeometry = new THREE.BufferGeometry();
    const octPointPositions: number[] = [];

    for (const p of octPointsOffset) {
      octPointPositions.push(p.x, p.y, p.z);
    }

    octPointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(octPointPositions, 3));

    const octPointsMaterial = new THREE.PointsMaterial({
      color: 0xff0000,
      size: 0.02,
      sizeAttenuation: true,
    });

    this.projectionDebugOctPoints = new THREE.Points(octPointsGeometry, octPointsMaterial);
    this.scene.add(this.projectionDebugOctPoints);

    // Create points on sphere (projected positions)
    const spherePointsGeometry = new THREE.BufferGeometry();
    const spherePointPositions: number[] = [];

    for (const p of spherePoints) {
      spherePointPositions.push(p.x, p.y, p.z);
    }

    spherePointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(spherePointPositions, 3));

    const spherePointsMaterial = new THREE.PointsMaterial({
      color: 0x00ffff,
      size: 0.02,
      sizeAttenuation: true,
    });

    this.projectionDebugSpherePoints = new THREE.Points(spherePointsGeometry, spherePointsMaterial);
    this.scene.add(this.projectionDebugSpherePoints);

    // Create lines connecting octahedron points to their projections
    const linesGeometry = new THREE.BufferGeometry();
    linesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

    const linesMaterial = new THREE.LineBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.3,
    });

    this.projectionDebugLines = new THREE.LineSegments(linesGeometry, linesMaterial);
    this.scene.add(this.projectionDebugLines);

    console.log(`Projection debug (${getProjectionMode()}): ${spherePoints.length} points sampled`);
  }

  /**
   * Clears the projection debug visualization.
   */
  clearProjectionDebug(): void {
    this.projectionDebugSubdivisions = 0;

    if (this.projectionDebugOctPoints) {
      this.projectionDebugOctPoints.geometry.dispose();
      (this.projectionDebugOctPoints.material as THREE.Material).dispose();
      this.scene.remove(this.projectionDebugOctPoints);
      this.projectionDebugOctPoints = null;
    }

    if (this.projectionDebugSpherePoints) {
      this.projectionDebugSpherePoints.geometry.dispose();
      (this.projectionDebugSpherePoints.material as THREE.Material).dispose();
      this.scene.remove(this.projectionDebugSpherePoints);
      this.projectionDebugSpherePoints = null;
    }

    if (this.projectionDebugLines) {
      this.projectionDebugLines.geometry.dispose();
      (this.projectionDebugLines.material as THREE.Material).dispose();
      this.scene.remove(this.projectionDebugLines);
      this.projectionDebugLines = null;
    }
  }

  /**
   * Checks if projection debug is currently enabled.
   */
  isProjectionDebugEnabled(): boolean {
    return this.projectionDebugSubdivisions > 0;
  }

  /**
   * Gets the current projection debug subdivisions setting.
   */
  getProjectionDebugSubdivisions(): number {
    return this.projectionDebugSubdivisions;
  }

  /**
   * Disposes of all Three.js resources.
   */
  dispose(): void {
    this.clearHoverDisplay();
    this.clearCellDisplay();
    this.clearProjectionDebug();

    if (this.octahedronMesh) {
      this.octahedronMesh.geometry.dispose();
      (this.octahedronMesh.material as THREE.Material).dispose();
      this.scene.remove(this.octahedronMesh);
    }
    if (this.wireframeMesh) {
      this.wireframeMesh.geometry.dispose();
      (this.wireframeMesh.material as THREE.Material).dispose();
      this.scene.remove(this.wireframeMesh);
    }
    if (this.sphereWireframeMesh) {
      this.sphereWireframeMesh.geometry.dispose();
      (this.sphereWireframeMesh.material as THREE.Material).dispose();
      this.scene.remove(this.sphereWireframeMesh);
    }
    if (this.vertexMarkers) {
      this.vertexMarkers.geometry.dispose();
      (this.vertexMarkers.material as THREE.Material).dispose();
      this.scene.remove(this.vertexMarkers);
    }
    if (this.sphereMesh) {
      this.sphereMesh.geometry.dispose();
      (this.sphereMesh.material as THREE.Material).dispose();
      this.scene.remove(this.sphereMesh);
    }
  }
}
