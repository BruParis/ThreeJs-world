import * as THREE from 'three';
import {
  IcoNetGeometry,
  IcoNetCoordinates,
  HexaTriangle,
  buildHexaTriangles,
  HexagonBuildResult,
  buildHexagons,
  HexaCell,
  HexaTreeDecodeResult,
  generateHexagonVertices,
} from '../../core/iconet';

export interface ViewParams {
  showFaces: boolean;
  showWireframe: boolean;
  showVertices: boolean;
  showHexagons: boolean;
}

/**
 * Handles creation and management of map meshes, wireframes, and highlights.
 */
export class MapRenderer {
  private mapGroup: THREE.Group;

  // Geometry data
  public geometry: IcoNetGeometry | null = null;
  public coordinates: IcoNetCoordinates | null = null;
  public triangles: HexaTriangle[] = [];
  public subdivision: HexagonBuildResult | null = null;

  // Visual elements
  private triangleMesh: THREE.Mesh | null = null;
  private triangleWireframe: THREE.LineSegments | null = null;
  private vertexMarkers: THREE.Points | null = null;
  private hexagonEdges: THREE.LineSegments | null = null;

  // Triangle highlight
  private triangleHighlightMesh: THREE.Mesh | null = null;
  private triangleHighlightMaterial: THREE.MeshBasicMaterial | null = null;

  // Hexagon selection - individual triangle meshes for topology handling
  private hexagonSelectionMeshes: THREE.Mesh[] = [];
  private hexagonSelectionMaterial: THREE.MeshBasicMaterial | null = null;

  // HexaTree encoding visualization
  private hexaTreeGroup: THREE.Group | null = null;
  private hexaTreePointMesh: THREE.Mesh | null = null;
  private hexaTreeHexagonLines: THREE.LineSegments[] = [];

  constructor(private scene: THREE.Scene) {
    this.mapGroup = new THREE.Group();
  }

  /**
   * Builds all map geometry and adds it to the scene.
   */
  build(params: ViewParams): void {
    this.cleanup();

    this.mapGroup = new THREE.Group();

    // Build geometry data
    this.geometry = new IcoNetGeometry({ triangleSize: 1.0, numCols: 5 });
    this.coordinates = new IcoNetCoordinates(this.geometry);
    this.triangles = buildHexaTriangles(this.geometry);
    this.subdivision = buildHexagons(this.geometry);

    // Create visual elements
    const threeGeometry = this.createThreeGeometry();
    this.createTriangleMesh(threeGeometry, params);
    this.createWireframe(params);
    this.createVertexMarkers(params);
    this.createTriangleHighlightMesh();
    this.createHexagonEdges(params);
    this.createHexagonSelectionMesh();

    this.scene.add(this.mapGroup);
  }

  /**
   * Cleans up existing map elements.
   */
  private cleanup(): void {
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
  }

  /**
   * Creates Three.js BufferGeometry from IcoNetGeometry data.
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
  private createTriangleMesh(geometry: THREE.BufferGeometry, params: ViewParams): void {
    const geo = this.geometry!;

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

    const nonIndexedGeometry = geometry.toNonIndexed();
    nonIndexedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });

    this.triangleMesh = new THREE.Mesh(nonIndexedGeometry, material);
    this.triangleMesh.visible = params.showFaces;
    this.mapGroup.add(this.triangleMesh);
  }

  /**
   * Creates the triangle wireframe overlay.
   */
  private createWireframe(params: ViewParams): void {
    const geo = this.geometry!;

    const positions: number[] = [];
    for (const [i0, i1, i2] of geo.faces) {
      const v0 = geo.vertices[i0];
      const v1 = geo.vertices[i1];
      const v2 = geo.vertices[i2];

      positions.push(v0.x, 0.01, v0.y, v1.x, 0.01, v1.y);
      positions.push(v1.x, 0.01, v1.y, v2.x, 0.01, v2.y);
      positions.push(v2.x, 0.01, v2.y, v0.x, 0.01, v0.y);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });

    this.triangleWireframe = new THREE.LineSegments(geometry, material);
    this.triangleWireframe.visible = params.showWireframe;
    this.mapGroup.add(this.triangleWireframe);
  }

  /**
   * Creates vertex marker points.
   */
  private createVertexMarkers(params: ViewParams): void {
    const geo = this.geometry!;

    const positions: number[] = [];
    for (const v of geo.vertices) {
      positions.push(v.x, 0.02, v.y);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xff0000,
      size: 0.1,
    });

    this.vertexMarkers = new THREE.Points(geometry, material);
    this.vertexMarkers.visible = params.showVertices;
    this.mapGroup.add(this.vertexMarkers);
  }

  /**
   * Creates the triangle highlight mesh.
   */
  private createTriangleHighlightMesh(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(9);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.triangleHighlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    this.triangleHighlightMesh = new THREE.Mesh(geometry, this.triangleHighlightMaterial);
    this.triangleHighlightMesh.renderOrder = 999;
    this.triangleHighlightMesh.visible = false;
    this.mapGroup.add(this.triangleHighlightMesh);
  }

  /**
   * Creates hexagon edge lines.
   */
  private createHexagonEdges(params: ViewParams): void {
    const positions: number[] = [];
    const edgeY = 0.015;

    for (const cell of this.subdivision!.hexaCells) {
      const vertices = cell.vertices;
      const localCenters = cell.localCenters;
      const n = vertices.length;

      for (let i = 0; i < n; i++) {
        const v1 = vertices[i].position;
        const v2 = vertices[(i + 1) % n].position;

        // For incomplete hexagons, skip edges that cross between different original vertices
        if (!cell.isComplete) {
          const center1 = localCenters[i];
          const center2 = localCenters[(i + 1) % n];
          const centerDx = center2.x - center1.x;
          const centerDy = center2.y - center1.y;
          const centerDist = Math.sqrt(centerDx * centerDx + centerDy * centerDy);
          if (centerDist > 0.01) {
            continue;
          }
        }

        positions.push(v1.x, edgeY, v1.y);
        positions.push(v2.x, edgeY, v2.y);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8,
    });

    this.hexagonEdges = new THREE.LineSegments(geometry, material);
    this.hexagonEdges.visible = params.showHexagons;
    this.mapGroup.add(this.hexagonEdges);
  }

  /**
   * Creates individual triangle meshes for hexagon selection.
   * Each triangle is a separate mesh to handle topology wrapping correctly.
   */
  private createHexagonSelectionMesh(): void {
    // Use cyan/blue color to distinguish from yellow triangle hover
    this.hexagonSelectionMaterial = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    // Create a pool of triangle meshes for hexagon selection
    // Incomplete hexagons can have up to 10 edge vertices (5 original vertices × 2 edges each)
    const maxTriangles = 12;
    for (let i = 0; i < maxTriangles; i++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(9); // 3 vertices * 3 components
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mesh = new THREE.Mesh(geometry, this.hexagonSelectionMaterial);
      mesh.renderOrder = 998;
      mesh.visible = false;
      this.hexagonSelectionMeshes.push(mesh);
      this.mapGroup.add(mesh);
    }
  }

  /**
   * Highlights the given triangle.
   */
  highlightTriangle(triangle: HexaTriangle | null): void {
    if (!this.triangleHighlightMesh) return;

    if (!triangle) {
      this.triangleHighlightMesh.visible = false;
      return;
    }

    const positions = this.triangleHighlightMesh.geometry.attributes.position as THREE.BufferAttribute;
    const y = 0.005;

    positions.setXYZ(0, triangle.v0.x, y, triangle.v0.y);
    positions.setXYZ(1, triangle.v1.x, y, triangle.v1.y);
    positions.setXYZ(2, triangle.v2.x, y, triangle.v2.y);
    positions.needsUpdate = true;

    this.triangleHighlightMesh.visible = true;
  }

  /**
   * Selects and highlights the given hexagon cell using individual triangle meshes.
   * Each triangle (center-vertex_i-vertex_i+1) is a separate mesh to handle
   * topology wrapping correctly when the 2D map wraps around a sphere.
   *
   * For incomplete hexagons that span multiple 2D positions, triangles that
   * cross between different original vertices are filtered out.
   */
  selectHexagon(cell: HexaCell | null): void {
    if (this.hexagonSelectionMeshes.length === 0) return;

    // Hide all triangle meshes first
    for (const mesh of this.hexagonSelectionMeshes) {
      mesh.visible = false;
    }

    if (!cell) {
      return;
    }

    const vertices = cell.vertices;
    const localCenters = cell.localCenters;
    const n = vertices.length;
    const y = 0.008;

    // Update and show only valid triangle meshes
    let meshIndex = 0;
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i].position;
      const v2 = vertices[(i + 1) % n].position;
      const center1 = localCenters[i];
      const center2 = localCenters[(i + 1) % n];

      // For incomplete hexagons, only draw triangles where both vertices
      // belong to the same original vertex (same local center)
      if (!cell.isComplete) {
        const centerDx = center2.x - center1.x;
        const centerDy = center2.y - center1.y;
        const centerDist = Math.sqrt(centerDx * centerDx + centerDy * centerDy);
        if (centerDist > 0.01) {
          // Different original vertices, skip this cross-boundary triangle
          continue;
        }
      }

      if (meshIndex >= this.hexagonSelectionMeshes.length) break;

      const mesh = this.hexagonSelectionMeshes[meshIndex];
      const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute;

      posAttr.setXYZ(0, center1.x, y, center1.y);
      posAttr.setXYZ(1, v1.x, y, v1.y);
      posAttr.setXYZ(2, v2.x, y, v2.y);
      posAttr.needsUpdate = true;

      mesh.visible = true;
      meshIndex++;
    }
  }

  /**
   * Sets visibility of visual elements.
   */
  setVisibility(key: keyof ViewParams, visible: boolean): void {
    switch (key) {
      case 'showFaces':
        if (this.triangleMesh) this.triangleMesh.visible = visible;
        break;
      case 'showWireframe':
        if (this.triangleWireframe) this.triangleWireframe.visible = visible;
        break;
      case 'showVertices':
        if (this.vertexMarkers) this.vertexMarkers.visible = visible;
        break;
      case 'showHexagons':
        if (this.hexagonEdges) this.hexagonEdges.visible = visible;
        break;
    }
  }

  /**
   * Displays a HexaTree encoding result on the map.
   * Shows a dot at the final position and parent hexagons at each level.
   *
   * @param result - The decoded HexaTree path result, or null to clear
   */
  displayHexaTreeEncoding(result: HexaTreeDecodeResult | null): void {
    // Clear previous visualization
    this.clearHexaTreeVisualization();

    if (!result) {
      return;
    }

    // Create group for HexaTree visualization
    this.hexaTreeGroup = new THREE.Group();
    this.mapGroup.add(this.hexaTreeGroup);

    const y = 0.02; // Height above the map

    // Draw parent hexagons at each level (from largest to smallest)
    const colors = [
      0xff0000, // Level 0 - red
      0xff8800, // Level 1 - orange
      0xffff00, // Level 2 - yellow
      0x88ff00, // Level 3 - lime
      0x00ff00, // Level 4 - green
      0x00ff88, // Level 5 - cyan-green
      0x00ffff, // Level 6 - cyan
      0x0088ff, // Level 7 - light blue
      0x0000ff, // Level 8 - blue
      0x8800ff, // Level 9 - purple
    ];

    for (let i = 0; i < result.parentCentroids.length; i++) {
      const level = result.parentCentroids[i];
      const vertices = generateHexagonVertices(level.centroid, level.sideLength);

      // Create line segments for the hexagon
      const positions: number[] = [];
      for (let j = 0; j < 6; j++) {
        const v1 = vertices[j];
        const v2 = vertices[(j + 1) % 6];
        positions.push(v1.x, y + i * 0.002, v1.y);
        positions.push(v2.x, y + i * 0.002, v2.y);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

      const color = colors[i % colors.length];
      const material = new THREE.LineBasicMaterial({
        color,
        linewidth: 2,
        transparent: true,
        opacity: 0.8 - i * 0.05, // Fade out higher levels
      });

      const lineSegments = new THREE.LineSegments(geometry, material);
      this.hexaTreeHexagonLines.push(lineSegments);
      this.hexaTreeGroup.add(lineSegments);
    }

    // Draw the final point
    const pointGeometry = new THREE.SphereGeometry(0.02, 16, 16);
    const pointMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff, // Magenta
    });
    this.hexaTreePointMesh = new THREE.Mesh(pointGeometry, pointMaterial);
    this.hexaTreePointMesh.position.set(
      result.position.x,
      y + result.parentCentroids.length * 0.002,
      result.position.y
    );
    this.hexaTreeGroup.add(this.hexaTreePointMesh);
  }

  /**
   * Clears the HexaTree visualization.
   */
  private clearHexaTreeVisualization(): void {
    if (this.hexaTreeGroup) {
      this.mapGroup.remove(this.hexaTreeGroup);

      // Dispose geometries and materials
      for (const line of this.hexaTreeHexagonLines) {
        line.geometry.dispose();
        if (line.material instanceof THREE.Material) {
          line.material.dispose();
        }
      }
      this.hexaTreeHexagonLines = [];

      if (this.hexaTreePointMesh) {
        this.hexaTreePointMesh.geometry.dispose();
        if (this.hexaTreePointMesh.material instanceof THREE.Material) {
          this.hexaTreePointMesh.material.dispose();
        }
        this.hexaTreePointMesh = null;
      }

      this.hexaTreeGroup = null;
    }
  }

  /**
   * Disposes of all resources.
   */
  dispose(): void {
    this.clearHexaTreeVisualization();
    this.cleanup();
  }
}
