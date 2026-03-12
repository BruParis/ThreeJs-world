/**
 * IcoTree Encoding System
 *
 * Decodes a hierarchical path to triangle coordinates on an icosahedral net.
 *
 * Triangle subdivision rules:
 * - Each triangle subdivides into 4 inner triangles
 * - Code 0: Central triangle (inverted orientation)
 * - Code 1: Triangle at the apex (top for up-pointing, bottom for down-pointing)
 * - Code 2: Triangle at bottom-right corner (relative to orientation)
 * - Code 3: Triangle at bottom-left corner (relative to orientation)
 */

import { Vec2 } from './IcoNetGeometry';
import { RootTriangle } from './RootTriangle';

/**
 * Result of decoding an IcoTree path at a single level.
 */
export interface IcoTreeLevel {
  /** Centroid of the triangle at this level */
  centroid: Vec2;
  /** Vertices of the triangle at this level */
  vertices: [Vec2, Vec2, Vec2];
  /** Whether this triangle is up-pointing */
  isUpPointing: boolean;
}

/**
 * Full result of decoding an IcoTree path.
 */
export interface IcoTreeDecodeResult {
  /** Triangle data at each level (index 0 = first subdivision level) */
  levels: IcoTreeLevel[];
  /** The root triangle used */
  rootTriangle: RootTriangle;
}

/**
 * Computes the midpoint between two 2D points.
 */
function midpoint(a: Vec2, b: Vec2): Vec2 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

/**
 * Computes the centroid of a triangle.
 */
function triangleCentroid(v0: Vec2, v1: Vec2, v2: Vec2): Vec2 {
  return {
    x: (v0.x + v1.x + v2.x) / 3,
    y: (v0.y + v1.y + v2.y) / 3,
  };
}

/**
 * Subdivides a triangle into 4 inner triangles and returns the requested one.
 *
 * Triangle vertex conventions (counter-clockwise from apex):
 * - For up-pointing: v0=apex(top), v1=bottom-right, v2=bottom-left
 * - For down-pointing: v0=apex(bottom), v1=top-right, v2=top-left
 *
 * Subdivision codes:
 * - 0: Center triangle (INVERTED orientation)
 * - 1: Apex triangle (contains v0, SAME orientation)
 * - 2: Triangle containing v1 (SAME orientation)
 * - 3: Triangle containing v2 (SAME orientation)
 *
 * @param v0 - First vertex (apex)
 * @param v1 - Second vertex
 * @param v2 - Third vertex
 * @param isUpPointing - Current triangle orientation
 * @param code - Subdivision code (0-3)
 * @returns The selected sub-triangle's vertices and orientation
 */
function subdivideTriangle(
  v0: Vec2,
  v1: Vec2,
  v2: Vec2,
  isUpPointing: boolean,
  code: number
): { vertices: [Vec2, Vec2, Vec2]; isUpPointing: boolean } {
  // Compute edge midpoints
  const m01 = midpoint(v0, v1); // midpoint of v0-v1
  const m12 = midpoint(v1, v2); // midpoint of v1-v2
  const m20 = midpoint(v2, v0); // midpoint of v2-v0

  if (isUpPointing) {
    // Parent is UP-POINTING (apex at top)
    // Corner sub-triangles are also up-pointing
    // Center sub-triangle is down-pointing
    switch (code) {
      case 0:
        // Center triangle - DOWN-POINTING (apex at m12, bottom)
        // Counter-clockwise from apex: m12 -> m01 -> m20
        return {
          vertices: [m12, m01, m20],
          isUpPointing: false,
        };
      case 1:
        // Top triangle - UP-POINTING (apex at v0)
        // Counter-clockwise from apex: v0 -> m01 -> m20
        return {
          vertices: [v0, m01, m20],
          isUpPointing: true,
        };
      case 2:
        // Bottom-right triangle - UP-POINTING (apex at m01)
        // Counter-clockwise from apex: m01 -> v1 -> m12
        return {
          vertices: [m01, v1, m12],
          isUpPointing: true,
        };
      case 3:
        // Bottom-left triangle - UP-POINTING (apex at m20)
        // Counter-clockwise from apex: m20 -> m12 -> v2
        return {
          vertices: [m20, m12, v2],
          isUpPointing: true,
        };
      default:
        throw new Error(`Invalid subdivision code: ${code}. Must be 0, 1, 2, or 3.`);
    }
  } else {
    // Parent is DOWN-POINTING (apex at bottom)
    // Corner sub-triangles are also down-pointing
    // Center sub-triangle is up-pointing
    switch (code) {
      case 0:
        // Center triangle - UP-POINTING (apex at m12, top)
        // Counter-clockwise from apex: m12 -> m20 -> m01
        return {
          vertices: [m12, m20, m01],
          isUpPointing: true,
        };
      case 1:
        // Bottom triangle - DOWN-POINTING (apex at v0)
        // Counter-clockwise from apex: v0 -> m01 -> m20
        return {
          vertices: [v0, m01, m20],
          isUpPointing: false,
        };
      case 2:
        // Top-right triangle - DOWN-POINTING (apex at m01)
        // Counter-clockwise from apex: m01 -> m12 -> v1
        return {
          vertices: [m01, m12, v1],
          isUpPointing: false,
        };
      case 3:
        // Top-left triangle - DOWN-POINTING (apex at m20)
        // Counter-clockwise from apex: m20 -> v2 -> m12
        return {
          vertices: [m20, v2, m12],
          isUpPointing: false,
        };
      default:
        throw new Error(`Invalid subdivision code: ${code}. Must be 0, 1, 2, or 3.`);
    }
  }
}

/**
 * Decodes an IcoTree path starting from a root triangle.
 *
 * @param rootTriangle - The root triangle to start from
 * @param path - Array of subdivision codes (0-3)
 * @returns Decode result with triangle data at each level
 */
export function decodeIcoTreePath(
  rootTriangle: RootTriangle,
  path: number[]
): IcoTreeDecodeResult {
  // Validate path
  for (let k = 0; k < path.length; k++) {
    const code = path[k];
    if (code < 0 || code > 3) {
      throw new Error(`Invalid path code at index ${k}: ${code}. Must be 0, 1, 2, or 3.`);
    }
  }

  const levels: IcoTreeLevel[] = [];

  // Start with root triangle
  let currentV0: Vec2 = rootTriangle.v0;
  let currentV1: Vec2 = rootTriangle.v1;
  let currentV2: Vec2 = rootTriangle.v2;
  let currentIsUpPointing = rootTriangle.isUpPointing;

  // Process each level
  for (const code of path) {
    const result = subdivideTriangle(
      currentV0,
      currentV1,
      currentV2,
      currentIsUpPointing,
      code
    );

    const centroid = triangleCentroid(
      result.vertices[0],
      result.vertices[1],
      result.vertices[2]
    );

    levels.push({
      centroid,
      vertices: result.vertices,
      isUpPointing: result.isUpPointing,
    });

    // Update for next iteration
    currentV0 = result.vertices[0];
    currentV1 = result.vertices[1];
    currentV2 = result.vertices[2];
    currentIsUpPointing = result.isUpPointing;
  }

  return {
    levels,
    rootTriangle,
  };
}

/**
 * Parses an IcoTree path string.
 * Format: "rootId:path" where rootId is the root triangle ID and path is digits 0-3.
 * Example: "5:0123" means root triangle 5, then codes 0, 1, 2, 3.
 *
 * @param pathString - String like "5:0123"
 * @returns Parsed root ID and path array
 */
export function parseIcoTreePathString(pathString: string): { rootId: number; path: number[] } {
  const trimmed = pathString.trim();

  if (!trimmed.includes(':')) {
    throw new Error('Path must be in format "rootId:path" (e.g., "5:0123")');
  }

  const [rootIdStr, pathPart] = trimmed.split(':');

  const rootId = parseInt(rootIdStr, 10);
  if (isNaN(rootId) || rootId < 0 || rootId > 19) {
    throw new Error(`Invalid root triangle ID: ${rootIdStr}. Must be 0-19.`);
  }

  if (pathPart === '') {
    return { rootId, path: [] };
  }

  if (!/^[0-3]+$/.test(pathPart)) {
    throw new Error('Path must contain only digits 0, 1, 2, or 3.');
  }

  const path = pathPart.split('').map(c => parseInt(c, 10));
  return { rootId, path };
}
