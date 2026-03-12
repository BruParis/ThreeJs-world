import * as THREE from 'three';
import { ISEA3HCellResult } from './ISEA3HEncoding';
import {
  projectToSphereSnyder,
  interpolateGreatArcSnyder,
} from './ISEA3HSnyderProjection';

export interface GUIParams {
  showFaces: boolean;
  showWireframe: boolean;
  showVertices: boolean;
  sphereMode: boolean;
}

// Number of segments to subdivide great arcs
const GREAT_ARC_SEGMENTS = 16;
// Offset to lift lines above the sphere surface
const SPHERE_LINE_OFFSET = 0.005;

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
  private cellBarycenterMarker: THREE.Points | null = null;
  private cellOutline: THREE.Line | null = null;
  private neighborMarkers: THREE.Points | null = null;
  private parentCellOutlines: THREE.Line[] = [];

  // Hover visualization
  private hoverCellOutlines: THREE.Line[] = [];

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
   * Projects a point from the octahedron surface onto the unit sphere
   * using the Snyder equal-area projection.
   */
  private projectToSphere(point: THREE.Vector3, offset: number = 0): THREE.Vector3 {
    return projectToSphereSnyder(point, offset);
  }

  /**
   * Interpolates along a great arc between two points.
   * The input points are on the octahedron surface and are projected
   * to the sphere using the Snyder equal-area projection.
   * Returns an array of points along the arc on the sphere.
   */
  private interpolateGreatArc(
    start: THREE.Vector3,
    end: THREE.Vector3,
    segments: number,
    offset: number = 0
  ): THREE.Vector3[] {
    return interpolateGreatArcSnyder(start, end, segments, offset);
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
  displayCell(result: ISEA3HCellResult): void {
    this.clearCellDisplay();

    if (!result.isValid) {
      return;
    }

    // Display barycenter
    this.displayBarycenter(result.barycenter, 0xff0000, 0.08);

    // Display neighbor barycenters
    this.displayNeighborMarkers(result.neighborBarycenters);

    // Display cell outline
    this.displayCellOutline(result.cellVertices, 0x00ff00);
  }

  /**
   * Displays a cell at a higher level (parent) with different styling.
   */
  displayParentCell(result: ISEA3HCellResult, color: number = 0xffff00): void {
    if (!result.isValid) {
      return;
    }

    // Create parent outline with different color
    const outline = this.createCellOutline(result.cellVertices, color);
    if (outline) {
      this.parentCellOutlines.push(outline);
    }
  }

  /**
   * Displays the barycenter as a point.
   */
  private displayBarycenter(position: THREE.Vector3, color: number, size: number): void {
    const geometry = new THREE.BufferGeometry();

    // Project to sphere if in sphere mode
    const displayPos = this.sphereMode
      ? this.projectToSphere(position, SPHERE_LINE_OFFSET)
      : position;

    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      displayPos.x, displayPos.y, displayPos.z
    ], 3));

    const material = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
    });

    this.cellBarycenterMarker = new THREE.Points(geometry, material);
    this.scene.add(this.cellBarycenterMarker);
  }

  /**
   * Displays neighbor barycenters as small points.
   */
  private displayNeighborMarkers(positions: THREE.Vector3[]): void {
    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    const posArray: number[] = [];

    for (const pos of positions) {
      // Project to sphere if in sphere mode
      const displayPos = this.sphereMode
        ? this.projectToSphere(pos, SPHERE_LINE_OFFSET)
        : pos;
      posArray.push(displayPos.x, displayPos.y, displayPos.z);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));

    const material = new THREE.PointsMaterial({
      color: 0x0088ff,
      size: 0.05,
      sizeAttenuation: true,
    });

    this.neighborMarkers = new THREE.Points(geometry, material);
    this.scene.add(this.neighborMarkers);
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
   * In sphere mode, uses great arc segments; otherwise, straight lines.
   */
  private createCellOutline(vertices: THREE.Vector3[], color: number): THREE.Line | null {
    if (vertices.length < 3) return null;

    if (this.sphereMode) {
      return this.createGreatArcPolygon(vertices, color, SPHERE_LINE_OFFSET);
    }

    // Octahedron mode: straight line loop
    const geometry = new THREE.BufferGeometry();
    const posArray: number[] = [];

    for (const v of vertices) {
      posArray.push(v.x, v.y, v.z);
    }
    // Close the loop
    posArray.push(vertices[0].x, vertices[0].y, vertices[0].z);

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

    if (this.neighborMarkers) {
      this.neighborMarkers.geometry.dispose();
      (this.neighborMarkers.material as THREE.Material).dispose();
      this.scene.remove(this.neighborMarkers);
      this.neighborMarkers = null;
    }

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
   * Displays a hover cell outline.
   */
  displayHoverCell(result: ISEA3HCellResult, color: number): void {
    if (!result.isValid || result.cellVertices.length < 3) return;

    const outline = this.createCellOutline(result.cellVertices, color);
    if (outline) {
      this.hoverCellOutlines.push(outline);
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
  }

  /**
   * Disposes of all Three.js resources.
   */
  dispose(): void {
    this.clearHoverDisplay();
    this.clearCellDisplay();

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
