import * as THREE from 'three';
import {
  IcoNetCoordinates,
  HexaTriangle,
  findTriangleAtPoint,
  interpolateLatLon,
  findCellAtPoint,
  Vec2,
} from '../../core/iconet';
import { MapRenderer } from './MapRenderer';

/** Distance threshold for vertex proximity detection */
const VERTEX_PROXIMITY_THRESHOLD = 0.08;

export interface HoverInfo {
  triangleId: number;
  hexagonId: number;
  nearbyVertexId: number;
  lat: number;
  lon: number;
  latDisplay: string;
  lonDisplay: string;
}

/** Information about a nearby vertex */
interface NearbyVertex {
  id: number;
  distance: number;
}

/**
 * Handles mouse interaction and raycasting for hover detection.
 */
export class InteractionHandler {
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private hoverPlane: THREE.Plane;

  public hoverInfo: HoverInfo = {
    triangleId: -1,
    hexagonId: -1,
    nearbyVertexId: -1,
    lat: 0,
    lon: 0,
    latDisplay: '',
    lonDisplay: '',
  };

  private boundOnMouseMove: (event: MouseEvent) => void;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private rendererElement: HTMLElement,
    private getContentArea: () => HTMLElement,
    private mapRenderer: MapRenderer
  ) {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoverPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.boundOnMouseMove = this.onMouseMove.bind(this);
  }

  /**
   * Starts listening for mouse events.
   */
  activate(): void {
    this.rendererElement.addEventListener('mousemove', this.boundOnMouseMove);
  }

  /**
   * Stops listening for mouse events.
   */
  deactivate(): void {
    this.rendererElement.removeEventListener('mousemove', this.boundOnMouseMove);
  }

  /**
   * Handles mouse move for hover detection (triangle mode only).
   */
  private onMouseMove(event: MouseEvent): void {
    const { coordinates, triangles } = this.mapRenderer;
    if (!coordinates || !triangles.length) return;

    const contentArea = this.getContentArea();
    const rect = contentArea.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersectPoint = new THREE.Vector3();
    const intersects = this.raycaster.ray.intersectPlane(this.hoverPlane, intersectPoint);

    if (!intersects) {
      this.clearHover();
      return;
    }

    const point2D = { x: intersectPoint.x, y: intersectPoint.z };
    this.handleTriangleHover(point2D, triangles, coordinates);
  }

  /**
   * Handles hover in triangle mode.
   */
  private handleTriangleHover(
    point2D: { x: number; y: number },
    triangles: HexaTriangle[],
    coordinates: IcoNetCoordinates
  ): void {
    const triangle = findTriangleAtPoint(point2D, triangles);

    if (triangle) {
      const latLon = interpolateLatLon(point2D, triangle, coordinates);
      const formatted = this.formatLatLon(latLon.lat, latLon.lon);

      // Check for nearby vertex
      const nearbyVertex = this.findNearbyVertex(point2D, triangle);

      // Find the hexagon containing this point
      const hexaCells = this.mapRenderer.subdivision?.hexaCells ?? [];
      const hexagon = findCellAtPoint(point2D, hexaCells);

      this.hoverInfo.triangleId = triangle.id;
      this.hoverInfo.hexagonId = hexagon?.id ?? -1;
      this.hoverInfo.nearbyVertexId = nearbyVertex?.id ?? -1;
      this.hoverInfo.lat = latLon.lat;
      this.hoverInfo.lon = latLon.lon;
      this.hoverInfo.latDisplay = formatted.latDisplay;
      this.hoverInfo.lonDisplay = formatted.lonDisplay;

      this.mapRenderer.highlightTriangle(triangle);
    } else {
      this.clearHover();
    }
  }

  /**
   * Finds the nearest vertex within the proximity threshold.
   */
  private findNearbyVertex(point: Vec2, triangle: HexaTriangle): NearbyVertex | null {
    const vertices = [
      { id: triangle.vertexIndices[0], pos: triangle.v0 },
      { id: triangle.vertexIndices[1], pos: triangle.v1 },
      { id: triangle.vertexIndices[2], pos: triangle.v2 },
    ];

    let nearest: NearbyVertex | null = null;
    let minDist = VERTEX_PROXIMITY_THRESHOLD;

    for (const v of vertices) {
      const dx = point.x - v.pos.x;
      const dy = point.y - v.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist) {
        minDist = dist;
        nearest = { id: v.id, distance: dist };
      }
    }

    return nearest;
  }

  /**
   * Clears triangle hover state (does not affect hexagon selection).
   */
  clearHover(): void {
    this.mapRenderer.highlightTriangle(null);
    this.clearHoverInfo();
  }

  /**
   * Clears hover info values.
   */
  private clearHoverInfo(): void {
    this.hoverInfo.triangleId = -1;
    this.hoverInfo.hexagonId = -1;
    this.hoverInfo.nearbyVertexId = -1;
    this.hoverInfo.lat = 0;
    this.hoverInfo.lon = 0;
    this.hoverInfo.latDisplay = '';
    this.hoverInfo.lonDisplay = '';
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

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.deactivate();
  }
}
