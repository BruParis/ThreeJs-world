import * as THREE from 'three';
import { QuadTreeCellDisplayInfo } from './QuadTreeEncoding';
import { computeCellVertices } from './QuadTreeGeometry';
import { ProjectionManager } from '@core/geometry/SphereProjection';
import {
  QuadrantMeshService,
  QuadrantMeshRequest,
} from '@core/workers';

export interface GUIParams {
  showFaces: boolean;
  showWireframe: boolean;
  showVertices: boolean;
  sphereMode: boolean;
}

/**
 * Specification for a quadrant mesh to be displayed.
 * The key format is "face:level:x:y:quadrantIndex".
 */
export interface QuadrantSpec {
  key: string;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  face: number;
  color: number;
}

// Number of segments to subdivide great arcs
const GREAT_ARC_SEGMENTS = 16;
// Offset to lift lines above the sphere surface
const SPHERE_LINE_OFFSET = 0.005;
// Offset to lift lines above the cube surface (for future use)
// const CUBE_LINE_OFFSET = 0.005;

/**
 * Projects a point from the cube surface onto the unit sphere using the current projection.
 * @param point Point on the cube surface
 * @param offset Optional offset to lift the point above the sphere
 */
export function projectToSphere(point: THREE.Vector3, offset: number = 0): THREE.Vector3 {
  return ProjectionManager.projectCubePointToSphere(point, offset);
}

/**
 * Projects a point from the sphere onto the cube surface using the current projection.
 * @param point Point on the sphere
 * @param offset Optional offset along face normal
 */
export function projectToCube(point: THREE.Vector3, offset: number = 0): THREE.Vector3 {
  return ProjectionManager.projectSpherePointToCube(point, offset);
}

/**
 * Gets the cube face for a point (which axis has the maximum absolute value).
 */
function getCubeFace(point: THREE.Vector3): string {
  const ax = Math.abs(point.x);
  const ay = Math.abs(point.y);
  const az = Math.abs(point.z);

  if (ax >= ay && ax >= az) {
    return point.x >= 0 ? '+x' : '-x';
  } else if (ay >= ax && ay >= az) {
    return point.y >= 0 ? '+y' : '-y';
  } else {
    return point.z >= 0 ? '+z' : '-z';
  }
}

/**
 * Interpolates along a great arc on the sphere between two points.
 * Input points are on the cube surface and are projected to the sphere using the current projection.
 */
function interpolateGreatArc(
  start: THREE.Vector3,
  end: THREE.Vector3,
  segments: number,
  offset: number = 0
): THREE.Vector3[] {
  return ProjectionManager.interpolateGreatArc(start, end, segments, offset);
}

/**
 * Interpolates along the cube surface between two points.
 * Handles face crossings.
 */
function interpolateCubePath(
  start: THREE.Vector3,
  end: THREE.Vector3,
  offset: number = 0
): THREE.Vector3[] {
  const startFace = getCubeFace(start);
  const endFace = getCubeFace(end);

  // Project both points onto the cube surface
  const projStart = projectToCube(start, offset);
  const projEnd = projectToCube(end, offset);

  // If same face, just return the two endpoints
  if (startFace === endFace) {
    return [projStart, projEnd];
  }

  // For face crossings, we need to find edge crossing points
  // This is a simplified version that uses more interpolation points
  const points: THREE.Vector3[] = [];
  const numSteps = 8;

  for (let i = 0; i <= numSteps; i++) {
    const t = i / numSteps;
    const interpPoint = new THREE.Vector3().lerpVectors(start, end, t);
    points.push(projectToCube(interpPoint, offset));
  }

  return points;
}

/**
 * Renders a cube with vertices at (±1, ±1, ±1).
 * Can toggle between cube and sphere mode.
 */
export class CubeRenderer {
  private scene: THREE.Scene;

  // Mode
  private sphereMode: boolean = true;

  // Meshes
  private cubeMesh: THREE.Mesh | null = null;
  private wireframeMesh: THREE.LineSegments | null = null;
  private sphereWireframeMesh: THREE.LineSegments | null = null;
  private vertexMarkers: THREE.Points | null = null;
  private sphereMesh: THREE.Mesh | null = null;

  // Dedicated raycasting sphere (always available for hover detection in sphere mode)
  private raycastSphere: THREE.Mesh | null = null;

  // Projection debug visualization
  private projectionDebugCubePoints: THREE.Points | null = null;
  private projectionDebugSpherePoints: THREE.Points | null = null;
  private projectionDebugLines: THREE.LineSegments | null = null;
  private projectionDebugSubdivisions: number = 0; // 0 means debug is disabled

  // Hover cell visualization
  private hoverCellOutlines: THREE.Line[] = [];
  // Quadrant meshes tracked by unique key: "face:level:x:y:quadrant"
  private hoverQuadrantMeshes: Map<string, THREE.Mesh> = new Map();

  // Hover point indicator (a tiny line extending outward from the surface)
  private hoverPointIndicator: THREE.Line | null = null;

  // Subdivision factor for quadrant triangulation (0 = disabled)
  private subdivisionFactor: number = 0;

  // Wireframe mode for quadrant meshes
  private quadrantWireframe: boolean = true;

  // Whether to use web workers for mesh generation (disabled for now)
  private useWorkers: boolean = false;

  // Worker service for parallel mesh generation
  private meshService: QuadrantMeshService | null = null;
  // Pending quadrant mesh requests (batched for parallel generation)
  private pendingQuadrantRequests: QuadrantMeshRequest[] = [];
  // Flag to track if we're currently generating meshes
  private isGeneratingMeshes: boolean = false;
  // Generation ID to cancel outdated requests
  private currentGenerationId: number = 0;

  // Unsubscribe function for projection changes
  private unsubscribeProjection: (() => void) | null = null;

  // Cube vertices (8 vertices)
  public readonly vertices: THREE.Vector3[] = [
    new THREE.Vector3(-1, -1, -1),  // 0
    new THREE.Vector3(1, -1, -1),   // 1
    new THREE.Vector3(1, 1, -1),    // 2
    new THREE.Vector3(-1, 1, -1),   // 3
    new THREE.Vector3(-1, -1, 1),   // 4
    new THREE.Vector3(1, -1, 1),    // 5
    new THREE.Vector3(1, 1, 1),     // 6
    new THREE.Vector3(-1, 1, 1),    // 7
  ];

  // Face indices (6 faces, each with 4 vertices forming 2 triangles)
  // Each face is defined as [v0, v1, v2, v3] where triangles are (v0,v1,v2) and (v0,v2,v3)
  public readonly faces: number[][] = [
    [0, 1, 2, 3],  // Back face (-Z)
    [4, 7, 6, 5],  // Front face (+Z)
    [0, 3, 7, 4],  // Left face (-X)
    [1, 5, 6, 2],  // Right face (+X)
    [0, 4, 5, 1],  // Bottom face (-Y)
    [3, 2, 6, 7],  // Top face (+Y)
  ];

  // Edge indices (12 edges)
  public readonly edges: [number, number][] = [
    // Bottom face edges
    [0, 1], [1, 5], [5, 4], [4, 0],
    // Top face edges
    [3, 2], [2, 6], [6, 7], [7, 3],
    // Vertical edges
    [0, 3], [1, 2], [5, 6], [4, 7],
  ];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // Worker service is created lazily when useWorkers is enabled

    // Subscribe to projection changes
    this.unsubscribeProjection = ProjectionManager.onProjectionChange(() => {
      this.onProjectionChanged();
    });
  }

  /**
   * Handles projection type changes by rebuilding affected visualizations.
   */
  private onProjectionChanged(): void {
    // Rebuild the sphere wireframe with the new projection
    this.rebuildSphereWireframe();

    // Clear hover display (meshes will regenerate on next hover)
    this.clearHoverDisplay();

    // Refresh projection debug if enabled
    if (this.isProjectionDebugEnabled()) {
      this.displayProjectionDebug(this.projectionDebugSubdivisions);
    }
  }

  /**
   * Rebuilds the sphere wireframe with the current projection.
   */
  private rebuildSphereWireframe(): void {
    const existingMesh = this.sphereWireframeMesh;
    if (!existingMesh) return;

    const wasVisible = existingMesh.visible;
    existingMesh.geometry.dispose();
    (existingMesh.material as THREE.Material).dispose();
    this.scene.remove(existingMesh);
    this.sphereWireframeMesh = null;

    this.buildSphereWireframe();

    // Type assertion needed because TypeScript doesn't track that buildSphereWireframe() mutates the field
    if (this.sphereWireframeMesh !== null) {
      (this.sphereWireframeMesh as THREE.LineSegments).visible = wasVisible;
    }
  }

  /**
   * Builds the cube visualization.
   */
  build(params: GUIParams): void {
    this.sphereMode = params.sphereMode;

    this.buildCubeMesh();
    this.buildWireframe();
    this.buildSphereWireframe();
    this.buildVertexMarkers();
    this.buildSphereMesh();
    this.buildRaycastSphere();

    this.setVisibility('faces', params.showFaces);
    this.setVisibility('wireframe', params.showWireframe);
    this.setVisibility('vertices', params.showVertices);
    this.updateSphereMode(params.sphereMode);
  }

  /**
   * Builds the cube mesh with colored faces.
   */
  private buildCubeMesh(): void {
    const geometry = new THREE.BufferGeometry();

    const positions: number[] = [];
    const colors: number[] = [];

    // Color palette for faces
    const faceColors = [
      new THREE.Color(0x4a90d9), // Blue - Back
      new THREE.Color(0x50c878), // Green - Front
      new THREE.Color(0xffa500), // Orange - Left
      new THREE.Color(0xff6b6b), // Red - Right
      new THREE.Color(0x9b59b6), // Purple - Bottom
      new THREE.Color(0xf39c12), // Yellow - Top
    ];

    for (let i = 0; i < this.faces.length; i++) {
      const face = this.faces[i];
      const color = faceColors[i];

      // First triangle: v0, v1, v2
      const v0 = this.vertices[face[0]];
      const v1 = this.vertices[face[1]];
      const v2 = this.vertices[face[2]];
      const v3 = this.vertices[face[3]];

      // Triangle 1
      positions.push(v0.x, v0.y, v0.z);
      positions.push(v1.x, v1.y, v1.z);
      positions.push(v2.x, v2.y, v2.z);

      // Triangle 2
      positions.push(v0.x, v0.y, v0.z);
      positions.push(v2.x, v2.y, v2.z);
      positions.push(v3.x, v3.y, v3.z);

      // Colors for both triangles (6 vertices)
      for (let j = 0; j < 6; j++) {
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

    this.cubeMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.cubeMesh);
  }

  /**
   * Builds the cube wireframe.
   */
  private buildWireframe(): void {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];

    for (const [i1, i2] of this.edges) {
      const v1 = this.vertices[i1];
      const v2 = this.vertices[i2];
      positions.push(v1.x, v1.y, v1.z);
      positions.push(v2.x, v2.y, v2.z);
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
    const positions: number[] = [];

    for (const [i1, i2] of this.edges) {
      const v1 = this.vertices[i1];
      const v2 = this.vertices[i2];

      const arcPoints = interpolateGreatArc(v1, v2, GREAT_ARC_SEGMENTS, SPHERE_LINE_OFFSET);

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

  /**
   * Builds vertex markers.
   */
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
   * Builds the semi-transparent sphere mesh (visual only).
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
   * Builds an invisible sphere mesh dedicated to raycasting.
   * This sphere is always available for hover detection in sphere mode,
   * regardless of the visibility settings of the visual sphere mesh.
   */
  private buildRaycastSphere(): void {
    const geometry = new THREE.SphereGeometry(1, 64, 32);
    // Use a basic material with visibility set to false
    // The mesh itself will be visible for raycasting but the material won't render
    const material = new THREE.MeshBasicMaterial({
      visible: false,
    });

    this.raycastSphere = new THREE.Mesh(geometry, material);
    // Keep the mesh "visible" so it can receive raycasts, but the material won't render
    this.raycastSphere.visible = true;
    this.scene.add(this.raycastSphere);
  }

  /**
   * Updates sphere mode: toggles between cube and sphere display.
   */
  updateSphereMode(enabled: boolean): void {
    this.sphereMode = enabled;

    // Toggle cube visibility
    if (this.cubeMesh) {
      this.cubeMesh.visible = !enabled;
    }

    // Toggle wireframe visibility (cube vs sphere wireframe)
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
   * Sets visibility of a visual element.
   */
  setVisibility(key: string, visible: boolean): void {
    switch (key) {
      case 'faces':
        if (this.cubeMesh) this.cubeMesh.visible = visible && !this.sphereMode;
        if (this.sphereMesh) this.sphereMesh.visible = visible && this.sphereMode;
        break;
      case 'wireframe':
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
   * Gets the sphere mesh for raycasting.
   * Returns the dedicated raycast sphere which is always available for hover detection.
   */
  getSphereMesh(): THREE.Mesh | null {
    return this.raycastSphere;
  }

  /**
   * Gets the cube mesh for raycasting.
   */
  getCubeMesh(): THREE.Mesh | null {
    return this.cubeMesh;
  }

  /**
   * Projects a point to the sphere using normalization.
   */
  projectToSphere(point: THREE.Vector3, offset: number = 0): THREE.Vector3 {
    return projectToSphere(point, offset);
  }

  /**
   * Projects a point to the cube surface.
   */
  projectToCube(point: THREE.Vector3, offset: number = 0): THREE.Vector3 {
    return projectToCube(point, offset);
  }

  /**
   * Interpolates along a great arc on the sphere.
   */
  interpolateGreatArc(
    start: THREE.Vector3,
    end: THREE.Vector3,
    segments: number,
    offset: number = 0
  ): THREE.Vector3[] {
    return interpolateGreatArc(start, end, segments, offset);
  }

  /**
   * Interpolates along the cube surface.
   */
  interpolateCubePath(
    start: THREE.Vector3,
    end: THREE.Vector3,
    offset: number = 0
  ): THREE.Vector3[] {
    return interpolateCubePath(start, end, offset);
  }

  /**
   * Displays a hover cell outline.
   */
  displayHoverCell(displayInfo: QuadTreeCellDisplayInfo, color: number): void {
    const cellVertices = computeCellVertices(displayInfo.cell);
    if (cellVertices.length < 3) return;

    const outline = this.createCellOutline(cellVertices, color);
    if (outline) {
      this.hoverCellOutlines.push(outline);
    }
  }

  /**
   * Creates a cell outline from vertices.
   * In sphere mode, uses great arc segments.
   * In cube mode, uses straight lines on the cube surface.
   */
  private createCellOutline(vertices: THREE.Vector3[], color: number): THREE.Line | null {
    if (vertices.length < 3) return null;

    if (this.sphereMode) {
      return this.createGreatArcPolygon(vertices, color, SPHERE_LINE_OFFSET);
    }

    // Cube mode: straight lines on cube surface with small offset
    const positions: number[] = [];
    const CUBE_LINE_OFFSET = 0.005;

    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      // Apply small offset along the face normal
      const normal = this.getCubeNormal(v);
      const offsetV = v.clone().addScaledVector(normal, CUBE_LINE_OFFSET);
      positions.push(offsetV.x, offsetV.y, offsetV.z);
    }
    // Close the loop
    const first = vertices[0];
    const normal = this.getCubeNormal(first);
    const offsetFirst = first.clone().addScaledVector(normal, CUBE_LINE_OFFSET);
    positions.push(offsetFirst.x, offsetFirst.y, offsetFirst.z);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    return line;
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

      const arcPoints = interpolateGreatArc(start, end, GREAT_ARC_SEGMENTS, offset);

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

  /**
   * Gets the outward normal for a point on the cube surface.
   */
  private getCubeNormal(point: THREE.Vector3): THREE.Vector3 {
    const ax = Math.abs(point.x);
    const ay = Math.abs(point.y);
    const az = Math.abs(point.z);

    if (ax >= ay && ax >= az) {
      return new THREE.Vector3(Math.sign(point.x), 0, 0);
    } else if (ay >= ax && ay >= az) {
      return new THREE.Vector3(0, Math.sign(point.y), 0);
    } else {
      return new THREE.Vector3(0, 0, Math.sign(point.z));
    }
  }

  /**
   * Clears all hover cell displays.
   */
  clearHoverDisplay(): void {
    this.clearHoverCellOutlines();
    this.clearHoverPointIndicator();
    this.clearQuadrantMeshes();
  }

  /**
   * Clears only the hover cell outlines (not the quadrant meshes).
   * Used for incremental LOD updates where meshes are kept persistent.
   */
  clearHoverCellOutlines(): void {
    for (const outline of this.hoverCellOutlines) {
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
      this.scene.remove(outline);
    }
    this.hoverCellOutlines = [];
  }

  /**
   * Displays a hover point indicator - a tiny line extending outward from the surface.
   * @param point The hit point on the surface
   */
  displayHoverPoint(point: THREE.Vector3): void {
    this.clearHoverPointIndicator();

    const LINE_LENGTH = 0.08;
    const LINE_COLOR = 0xffffff;

    let startPoint: THREE.Vector3;
    let endPoint: THREE.Vector3;

    if (this.sphereMode) {
      // For sphere mode: the normal is the normalized point itself
      const spherePoint = point.clone().normalize();
      startPoint = spherePoint.clone();
      endPoint = spherePoint.clone().multiplyScalar(1 + LINE_LENGTH);
    } else {
      // For cube mode: get the face normal
      const normal = this.getCubeNormal(point);
      startPoint = point.clone();
      endPoint = point.clone().addScaledVector(normal, LINE_LENGTH);
    }

    const geometry = new THREE.BufferGeometry();
    const positions = [
      startPoint.x, startPoint.y, startPoint.z,
      endPoint.x, endPoint.y, endPoint.z,
    ];
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({ color: LINE_COLOR });
    this.hoverPointIndicator = new THREE.Line(geometry, material);
    this.scene.add(this.hoverPointIndicator);
  }

  /**
   * Clears the hover point indicator.
   */
  private clearHoverPointIndicator(): void {
    if (this.hoverPointIndicator) {
      this.hoverPointIndicator.geometry.dispose();
      (this.hoverPointIndicator.material as THREE.Material).dispose();
      this.scene.remove(this.hoverPointIndicator);
      this.hoverPointIndicator = null;
    }
  }

  /**
   * Sets the subdivision factor for quadrant triangulation.
   * @param factor Number of subdivisions per edge (0 = disabled)
   */
  setSubdivisionFactor(factor: number): void {
    this.subdivisionFactor = Math.max(0, Math.floor(factor));
  }

  /**
   * Gets the current subdivision factor.
   */
  getSubdivisionFactor(): number {
    return this.subdivisionFactor;
  }

  /**
   * Sets the wireframe mode for quadrant meshes.
   */
  setQuadrantWireframe(enabled: boolean): void {
    this.quadrantWireframe = enabled;
    // Update existing meshes
    for (const [, mesh] of this.hoverQuadrantMeshes) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.wireframe = enabled;
      mat.opacity = enabled ? 1.0 : 0.6;
    }
  }

  /**
   * Gets the current wireframe mode.
   */
  getQuadrantWireframe(): boolean {
    return this.quadrantWireframe;
  }

  /**
   * Sets whether to use web workers for mesh generation.
   */
  setUseWorkers(enabled: boolean): void {
    this.useWorkers = enabled;
    // Clear any pending requests when switching modes
    this.pendingQuadrantRequests = [];
  }

  /**
   * Gets whether web workers are used for mesh generation.
   */
  getUseWorkers(): boolean {
    return this.useWorkers;
  }

  /**
   * Displays triangulated quadrants for a cell, excluding quadrants that contain children.
   * @param cellUVBounds The UV bounds of the cell {u0, u1, v0, v1}
   * @param face The cube face
   * @param childQuadrants Set of quadrant indices (0-3: BL, BR, TR, TL) to skip, or undefined/empty for all
   * @param color The color for the mesh
   */
  displayTriangulatedQuadrants(
    cellUVBounds: { u0: number; u1: number; v0: number; v1: number },
    face: number,
    childQuadrants: Set<number> | undefined,
    color: number
  ): void {
    if (this.subdivisionFactor <= 0) return;

    const { u0, u1, v0, v1 } = cellUVBounds;
    const uMid = (u0 + u1) / 2;
    const vMid = (v0 + v1) / 2;

    // Define the 4 quadrants: [u0, u1, v0, v1] for each
    // 0: Bottom-Left, 1: Bottom-Right, 2: Top-Right, 3: Top-Left
    const quadrants = [
      { u0: u0, u1: uMid, v0: v0, v1: vMid },   // BL
      { u0: uMid, u1: u1, v0: v0, v1: vMid },   // BR
      { u0: uMid, u1: u1, v0: vMid, v1: v1 },   // TR
      { u0: u0, u1: uMid, v0: vMid, v1: v1 },   // TL
    ];

    if (this.useWorkers) {
      // Queue requests for worker-based generation
      for (let i = 0; i < 4; i++) {
        if (childQuadrants?.has(i)) continue;
        this.pendingQuadrantRequests.push({
          ...quadrants[i],
          face,
          subdivisions: this.subdivisionFactor,
          sphereMode: this.sphereMode,
          offset: 0.001,
          color,
          id: `quadrant_${face}_${i}_${Date.now()}`,
        });
      }
    } else {
      // Synchronous generation with timing
      const syncStart = performance.now();
      let meshCount = 0;
      for (let i = 0; i < 4; i++) {
        if (childQuadrants?.has(i)) continue;
        const meshStart = performance.now();
        const mesh = this.createQuadrantMesh(quadrants[i], face, color);
        const meshEnd = performance.now();
        if (mesh) {
          // Use temporary key for non-incremental modes
          const tempKey = `temp_${face}_${u0}_${v0}_${i}_${Date.now()}`;
          this.hoverQuadrantMeshes.set(tempKey, mesh);
          meshCount++;
          console.log(`[CubeRenderer-Sync] Mesh ${i}: compute=${(meshEnd - meshStart).toFixed(2)}ms`);
        }
      }
      const syncEnd = performance.now();
      console.log(`[CubeRenderer-Sync] Total: ${meshCount} meshes in ${(syncEnd - syncStart).toFixed(2)}ms`);
    }
  }

  /**
   * Flushes all pending quadrant requests to the worker pool for parallel generation.
   * Call this after queueing all displayTriangulatedQuadrants calls.
   * Only used when useWorkers is enabled.
   */
  async flushQuadrantRequests(): Promise<void> {
    if (!this.useWorkers) return;
    if (this.pendingQuadrantRequests.length === 0) return;

    // Create mesh service lazily
    if (!this.meshService) {
      this.meshService = new QuadrantMeshService();
    }

    if (this.isGeneratingMeshes) {
      // Cancel current generation by incrementing the ID
      this.currentGenerationId++;
    }

    const generationId = ++this.currentGenerationId;
    const requests = [...this.pendingQuadrantRequests];
    this.pendingQuadrantRequests = [];
    this.isGeneratingMeshes = true;

    const batchStart = performance.now();
    console.log(`[CubeRenderer-Workers] Flushing ${requests.length} quadrant requests (batched), generationId=${generationId}`);

    try {
      // Generate all meshes in a single batched worker call
      const results = await this.meshService!.generateMeshesBatched(requests);

      // Check if this generation is still current
      if (generationId !== this.currentGenerationId) {
        console.log(`[CubeRenderer-Workers] Discarding outdated batch`);
        return;
      }

      // Add all meshes to scene
      for (const result of results) {
        const material = result.mesh.material as THREE.MeshBasicMaterial;
        material.wireframe = this.quadrantWireframe;
        material.opacity = this.quadrantWireframe ? 1.0 : 0.6;

        this.scene.add(result.mesh);
        // Use the worker-provided id as the key
        this.hoverQuadrantMeshes.set(result.id, result.mesh);
      }

      const batchEnd = performance.now();
      console.log(`[CubeRenderer-Workers] Total: ${results.length} meshes in ${(batchEnd - batchStart).toFixed(2)}ms, generationId=${generationId}`);
    } catch (error) {
      console.error(`[CubeRenderer] Error generating meshes:`, error);
    } finally {
      if (generationId === this.currentGenerationId) {
        this.isGeneratingMeshes = false;
      }
    }
  }

  /**
   * Updates LOD quadrants incrementally.
   * Compares needed quadrants with currently displayed ones,
   * removes obsolete quadrants, and generates only new ones.
   * @param neededQuadrants Map of quadrant key -> QuadrantSpec
   * @returns Promise that resolves when all new meshes are generated
   */
  async updateLODQuadrants(neededQuadrants: Map<string, QuadrantSpec>): Promise<void> {
    if (this.subdivisionFactor <= 0) return;

    // Find quadrants to remove (in current but not in needed)
    const toRemove: string[] = [];
    for (const [key] of this.hoverQuadrantMeshes) {
      if (!neededQuadrants.has(key)) {
        toRemove.push(key);
      }
    }

    // Find quadrants to add (in needed but not in current)
    const toAdd: QuadrantSpec[] = [];
    for (const [key, spec] of neededQuadrants) {
      if (!this.hoverQuadrantMeshes.has(key)) {
        toAdd.push(spec);
      }
    }

    // If nothing to add, just remove obsolete and return
    if (toAdd.length === 0) {
      for (const key of toRemove) {
        const mesh = this.hoverQuadrantMeshes.get(key);
        if (mesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          this.scene.remove(mesh);
          this.hoverQuadrantMeshes.delete(key);
        }
      }
      return;
    }

    // Generate new quadrants
    if (this.useWorkers) {
      // Use workers for new quadrants
      if (!this.meshService) {
        this.meshService = new QuadrantMeshService();
      }

      const generationId = ++this.currentGenerationId;
      this.isGeneratingMeshes = true;

      const requests: QuadrantMeshRequest[] = toAdd.map(spec => ({
        u0: spec.u0,
        u1: spec.u1,
        v0: spec.v0,
        v1: spec.v1,
        face: spec.face,
        subdivisions: this.subdivisionFactor,
        sphereMode: this.sphereMode,
        offset: 0.001,
        color: spec.color,
        id: spec.key,
      }));

      try {
        const results = await this.meshService.generateMeshesBatched(requests);

        // Check if generation is still current
        if (generationId !== this.currentGenerationId) {
          console.log(`[CubeRenderer-LOD] Discarding outdated incremental batch`);
          return;
        }

        // Now that new meshes are ready, remove obsolete ones
        for (const key of toRemove) {
          const mesh = this.hoverQuadrantMeshes.get(key);
          if (mesh) {
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
            this.scene.remove(mesh);
            this.hoverQuadrantMeshes.delete(key);
          }
        }

        // Add new meshes
        for (const result of results) {
          const material = result.mesh.material as THREE.MeshBasicMaterial;
          material.wireframe = this.quadrantWireframe;
          material.opacity = this.quadrantWireframe ? 1.0 : 0.6;

          this.scene.add(result.mesh);
          this.hoverQuadrantMeshes.set(result.id, result.mesh);
        }
      } finally {
        if (generationId === this.currentGenerationId) {
          this.isGeneratingMeshes = false;
        }
      }
    } else {
      // Synchronous generation
      const newMeshes: Array<{ key: string; mesh: THREE.Mesh }> = [];

      for (const spec of toAdd) {
        const mesh = this.createQuadrantMesh(
          { u0: spec.u0, u1: spec.u1, v0: spec.v0, v1: spec.v1 },
          spec.face,
          spec.color
        );
        if (mesh) {
          newMeshes.push({ key: spec.key, mesh });
        }
      }

      // Now that new meshes are ready, remove obsolete ones
      for (const key of toRemove) {
        const mesh = this.hoverQuadrantMeshes.get(key);
        if (mesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          this.scene.remove(mesh);
          this.hoverQuadrantMeshes.delete(key);
        }
      }

      // Add new meshes
      for (const { key, mesh } of newMeshes) {
        this.scene.add(mesh);
        this.hoverQuadrantMeshes.set(key, mesh);
      }
    }
  }

  /**
   * Gets the set of currently displayed quadrant keys.
   */
  getDisplayedQuadrantKeys(): Set<string> {
    return new Set(this.hoverQuadrantMeshes.keys());
  }

  /**
   * Creates a triangulated mesh for a quadrant.
   */
  private createQuadrantMesh(
    bounds: { u0: number; u1: number; v0: number; v1: number },
    face: number,
    color: number
  ): THREE.Mesh | null {
    const n = this.subdivisionFactor;
    if (n <= 0) return null;

    const positions: number[] = [];
    const indices: number[] = [];

    // Create grid of vertices
    const vertices: THREE.Vector3[][] = [];
    for (let i = 0; i <= n; i++) {
      vertices[i] = [];
      const u = bounds.u0 + (bounds.u1 - bounds.u0) * (i / n);
      for (let j = 0; j <= n; j++) {
        const v = bounds.v0 + (bounds.v1 - bounds.v0) * (j / n);

        // Get the point on the cube surface
        const cubePoint = this.faceUVToCubePoint(face, u, v);

        // Project to sphere if in sphere mode
        const point = this.sphereMode
          ? projectToSphere(cubePoint, 0.001) // Small offset to avoid z-fighting
          : cubePoint.clone().addScaledVector(this.getCubeNormal(cubePoint), 0.001);

        vertices[i][j] = point;
      }
    }

    // Build position array
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const v = vertices[i][j];
        positions.push(v.x, v.y, v.z);
      }
    }

    // Build index array (triangles)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const topLeft = i * (n + 1) + j;
        const topRight = topLeft + 1;
        const bottomLeft = (i + 1) * (n + 1) + j;
        const bottomRight = bottomLeft + 1;

        // Two triangles per quad
        indices.push(topLeft, bottomLeft, topRight);
        indices.push(topRight, bottomLeft, bottomRight);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: this.quadrantWireframe ? 1.0 : 0.6,
      wireframe: this.quadrantWireframe,
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Converts face UV coordinates to a cube surface point.
   */
  private faceUVToCubePoint(face: number, u: number, v: number): THREE.Vector3 {
    // Import the CubeFace enum values
    const PLUS_X = 0, MINUS_X = 1, PLUS_Y = 2, MINUS_Y = 3, PLUS_Z = 4, MINUS_Z = 5;

    switch (face) {
      case PLUS_X:
        return new THREE.Vector3(1, v, -u);
      case MINUS_X:
        return new THREE.Vector3(-1, v, u);
      case PLUS_Y:
        return new THREE.Vector3(u, 1, v);
      case MINUS_Y:
        return new THREE.Vector3(u, -1, -v);
      case PLUS_Z:
        return new THREE.Vector3(u, v, 1);
      case MINUS_Z:
        return new THREE.Vector3(-u, v, -1);
      default:
        return new THREE.Vector3(0, 0, 0);
    }
  }

  /**
   * Clears all quadrant meshes.
   */
  private clearQuadrantMeshes(): void {
    // Cancel any pending/in-progress generation
    this.currentGenerationId++;
    this.pendingQuadrantRequests = [];

    for (const [, mesh] of this.hoverQuadrantMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.scene.remove(mesh);
    }
    this.hoverQuadrantMeshes.clear();
  }

  /**
   * Displays debug visualization for the cube-to-sphere projection.
   * Samples points on each cube face and shows their projection on the sphere.
   * @param subdivisions Number of subdivisions per edge of each cube face
   */
  displayProjectionDebug(subdivisions: number = 10): void {
    this.clearProjectionDebug();
    this.projectionDebugSubdivisions = subdivisions;

    const cubePoints: THREE.Vector3[] = [];
    const cubePointsOffset: THREE.Vector3[] = [];
    const spherePoints: THREE.Vector3[] = [];
    const linePositions: number[] = [];

    // Offset to lift points above the cube surface
    const CUBE_POINT_OFFSET = 0.01;

    // Sample each cube face
    // Faces are defined by which axis is fixed at ±1
    const faceConfigs = [
      { axis: 'x', value: 1 },   // +X face
      { axis: 'x', value: -1 },  // -X face
      { axis: 'y', value: 1 },   // +Y face
      { axis: 'y', value: -1 },  // -Y face
      { axis: 'z', value: 1 },   // +Z face
      { axis: 'z', value: -1 },  // -Z face
    ];

    for (const config of faceConfigs) {
      for (let i = 0; i <= subdivisions; i++) {
        for (let j = 0; j <= subdivisions; j++) {
          // Compute the two varying coordinates in range [-1, 1]
          const u = -1 + (2 * i) / subdivisions;
          const v = -1 + (2 * j) / subdivisions;

          // Create point on cube face
          let cubePoint: THREE.Vector3;
          if (config.axis === 'x') {
            cubePoint = new THREE.Vector3(config.value, u, v);
          } else if (config.axis === 'y') {
            cubePoint = new THREE.Vector3(u, config.value, v);
          } else {
            cubePoint = new THREE.Vector3(u, v, config.value);
          }

          // Compute face normal for offset
          const faceNormal = new THREE.Vector3(
            config.axis === 'x' ? config.value : 0,
            config.axis === 'y' ? config.value : 0,
            config.axis === 'z' ? config.value : 0
          );

          // Offset point along face normal
          const cubePointWithOffset = cubePoint.clone().addScaledVector(faceNormal, CUBE_POINT_OFFSET);

          // Project to sphere using normalization
          const spherePoint = projectToSphere(cubePoint, SPHERE_LINE_OFFSET);

          cubePoints.push(cubePoint);
          cubePointsOffset.push(cubePointWithOffset);
          spherePoints.push(spherePoint);

          // Add line from cube point (with offset) to sphere point
          linePositions.push(cubePointWithOffset.x, cubePointWithOffset.y, cubePointWithOffset.z);
          linePositions.push(spherePoint.x, spherePoint.y, spherePoint.z);
        }
      }
    }

    // Create points on cube surface (with offset)
    const cubePointsGeometry = new THREE.BufferGeometry();
    const cubePointPositions: number[] = [];

    for (const p of cubePointsOffset) {
      cubePointPositions.push(p.x, p.y, p.z);
    }

    cubePointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cubePointPositions, 3));

    const cubePointsMaterial = new THREE.PointsMaterial({
      color: 0xff0000,
      size: 0.02,
      sizeAttenuation: true,
    });

    this.projectionDebugCubePoints = new THREE.Points(cubePointsGeometry, cubePointsMaterial);
    this.scene.add(this.projectionDebugCubePoints);

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

    // Create lines connecting cube points to their projections
    const linesGeometry = new THREE.BufferGeometry();
    linesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

    const linesMaterial = new THREE.LineBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.3,
    });

    this.projectionDebugLines = new THREE.LineSegments(linesGeometry, linesMaterial);
    this.scene.add(this.projectionDebugLines);

    console.log(`Projection debug: ${spherePoints.length} points sampled`);
  }

  /**
   * Clears the projection debug visualization.
   */
  clearProjectionDebug(): void {
    this.projectionDebugSubdivisions = 0;

    if (this.projectionDebugCubePoints) {
      this.projectionDebugCubePoints.geometry.dispose();
      (this.projectionDebugCubePoints.material as THREE.Material).dispose();
      this.scene.remove(this.projectionDebugCubePoints);
      this.projectionDebugCubePoints = null;
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
    // Unsubscribe from projection changes
    if (this.unsubscribeProjection) {
      this.unsubscribeProjection();
      this.unsubscribeProjection = null;
    }

    // Terminate the worker service if it was created
    if (this.meshService) {
      this.meshService.terminate();
    }

    this.clearProjectionDebug();
    this.clearHoverDisplay();

    if (this.cubeMesh) {
      this.cubeMesh.geometry.dispose();
      (this.cubeMesh.material as THREE.Material).dispose();
      this.scene.remove(this.cubeMesh);
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
    if (this.raycastSphere) {
      this.raycastSphere.geometry.dispose();
      (this.raycastSphere.material as THREE.Material).dispose();
      this.scene.remove(this.raycastSphere);
    }
  }
}
