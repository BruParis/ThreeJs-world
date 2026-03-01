/**
 * Icosahedral Net Coordinate Conversion
 *
 * Converts between 2D net vertex positions and geographic coordinates (lat/lon).
 *
 * This conversion is ONLY valid for the triangle vertices, not for arbitrary
 * points on the 2D plane. The icosahedral projection is non-linear, so
 * interpolating between vertices requires spherical calculations.
 *
 * Geographic constants for the icosahedron:
 *   - Row half-width (latitude of upper/lower rings): 26.5605°
 *   - Triangle half-base (longitude half-step): 36°
 *   - Longitude step between adjacent vertices in a row: 72°
 */

import { IcoNetGeometry } from './IcoNetGeometry';

export interface LatLon {
  /** Latitude in degrees (-90 to 90) */
  lat: number;
  /** Longitude in degrees (0 to 360) */
  lon: number;
}

/** Latitude of the upper icosahedron ring (arctan(1/2) in degrees) */
export const RING_LATITUDE = 26.5605;

/** Longitude step between adjacent vertices in a row */
export const LON_STEP = 72;

/** Half of the longitude step (offset between upper and lower rings) */
export const LON_HALF_STEP = 36;

/**
 * Provides latitude/longitude coordinates for icosahedral net vertices.
 *
 * The icosahedron has 12 unique vertices on the sphere:
 *   - North pole (lat = 90°)
 *   - Upper ring: 5 vertices at lat = 26.5605°
 *   - Lower ring: 5 vertices at lat = -26.5605°
 *   - South pole (lat = -90°)
 *
 * In the unfolded net, some vertices are duplicated:
 *   - Row 0: 5 vertices, all representing the north pole
 *   - Row 1: 6 vertices, upper ring (with wrap-around)
 *   - Row 2: 6 vertices, lower ring (with wrap-around)
 *   - Row 3: 5 vertices, all representing the south pole
 */
export class IcoNetCoordinates {
  private readonly geometry: IcoNetGeometry;
  private readonly vertexLatLon: LatLon[];

  constructor(geometry: IcoNetGeometry) {
    this.geometry = geometry;
    this.vertexLatLon = this.computeVertexCoordinates();
  }

  /**
   * Computes lat/lon for all vertices in the net.
   */
  private computeVertexCoordinates(): LatLon[] {
    const coords: LatLon[] = [];
    const numCols = this.geometry.numCols;

    // Row 0: North pole vertices
    // Each pole vertex is assigned the longitude midpoint of the triangle it connects to
    for (let i = 0; i < numCols; i++) {
      coords.push({
        lat: 90,
        lon: LON_HALF_STEP + i * LON_STEP,
      });
    }

    // Row 1: Upper ring vertices at lat = +26.5605°
    // Longitude: 0°, 72°, 144°, 216°, 288°, 360° (wraps to 0°)
    for (let i = 0; i < numCols + 1; i++) {
      coords.push({
        lat: RING_LATITUDE,
        lon: i * LON_STEP,
      });
    }

    // Row 2: Lower ring vertices at lat = -26.5605°
    // Longitude offset by 36°: 36°, 108°, 180°, 252°, 324°, 396° (wraps to 36°)
    for (let i = 0; i < numCols + 1; i++) {
      coords.push({
        lat: -RING_LATITUDE,
        lon: LON_HALF_STEP + i * LON_STEP,
      });
    }

    // Row 3: South pole vertices
    // Each pole vertex is assigned the longitude midpoint of the triangle it connects to
    for (let i = 0; i < numCols; i++) {
      coords.push({
        lat: -90,
        lon: LON_STEP + i * LON_STEP,
      });
    }

    return coords;
  }

  /**
   * Gets the latitude/longitude for a vertex by index.
   */
  getVertexLatLon(vertexIndex: number): LatLon {
    if (vertexIndex < 0 || vertexIndex >= this.vertexLatLon.length) {
      throw new Error(`Vertex index ${vertexIndex} out of range [0, ${this.vertexLatLon.length})`);
    }
    return this.vertexLatLon[vertexIndex];
  }

  /**
   * Gets the vertex row (0-3) for a given vertex index.
   */
  getVertexRow(vertexIndex: number): number {
    const { row1, row2, row3 } = this.geometry.rowStarts;
    if (vertexIndex < row1) return 0;
    if (vertexIndex < row2) return 1;
    if (vertexIndex < row3) return 2;
    return 3;
  }

  /**
   * Returns whether the vertex is at a pole (north or south).
   */
  isPolVertex(vertexIndex: number): boolean {
    const row = this.getVertexRow(vertexIndex);
    return row === 0 || row === 3;
  }

  /**
   * Gets lat/lon coordinates for all three vertices of a face.
   */
  getFaceVertexCoordinates(faceIndex: number): [LatLon, LatLon, LatLon] {
    const [i0, i1, i2] = this.geometry.getFace(faceIndex);
    return [
      this.getVertexLatLon(i0),
      this.getVertexLatLon(i1),
      this.getVertexLatLon(i2),
    ];
  }

  /**
   * Returns all vertex coordinates.
   */
  get allCoordinates(): readonly LatLon[] {
    return this.vertexLatLon;
  }

  /**
   * Normalizes a longitude to [0, 360) range.
   */
  static normalizeLon(lon: number): number {
    return ((lon % 360) + 360) % 360;
  }

  /**
   * Converts degrees to radians.
   */
  static toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Converts radians to degrees.
   */
  static toDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }
}
