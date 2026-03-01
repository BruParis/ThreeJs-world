/**
 * HexaTree Encoding System
 *
 * Converts encoding scheme to x,y coordinates on a 2D hexagonal lattice.
 *
 * Encoding format:
 * - root: ID of the root hexagon
 * - path: array of values in {0, 1, 2, 3} representing the hierarchical path
 */

import { Vec2 } from './IcoNetGeometry';

// Direction vectors for each encoding value
const W_VECTORS: Vec2[] = [
  { x: 0, y: 0 },   // w(0)
  { x: 0, y: 1 },   // w(1)
  { x: -1, y: -1 }, // w(2)
  { x: 1, y: 0 },   // w(3)
];

/**
 * Result of decoding a HexaTree path
 */
export interface HexaTreeDecodeResult {
  /** Final (x, y) coordinates on the 2D lattice */
  position: Vec2;

  /** Intermediate (i, j) coordinates before matrix transformation */
  intermediateCoords: Vec2;

  /** Parent hexagon centroids at each resolution level */
  parentCentroids: HexaTreeLevel[];
}

/**
 * Information about a hexagon at a specific resolution level
 */
export interface HexaTreeLevel {
  /** Resolution level (0 = root, n-1 = leaf) */
  level: number;

  /** Centroid position at this level */
  centroid: Vec2;

  /** Side length of the hexagon at this level */
  sideLength: number;

  /** The path prefix up to this level */
  pathPrefix: number[];
}

/**
 * Decodes a HexaTree encoding to 2D coordinates.
 *
 * @param rootCentroid - The centroid position of the root hexagon
 * @param path - Array of values in {0, 1, 2, 3}
 * @param rootSideLength - Side length of the root hexagon (L)
 * @returns Decoded position and parent hexagon information
 */
export function decodeHexaTreePath(
  rootCentroid: Vec2,
  path: number[],
  rootSideLength: number
): HexaTreeDecodeResult {
  const n = path.length;

  if (n === 0) {
    return {
      position: { ...rootCentroid },
      intermediateCoords: { x: 0, y: 0 },
      parentCentroids: [{
        level: 0,
        centroid: { ...rootCentroid },
        sideLength: rootSideLength,
        pathPrefix: [],
      }],
    };
  }

  // Compute intermediate (i, j) coordinates
  // (i, j) = sum_{k=0}^{n-1} (2^k * w(a_k))
  let i = 0;
  let j = 0;

  for (let k = 0; k < n; k++) {
    const a = path[k];
    if (a < 0 || a > 3) {
      throw new Error(`Invalid path value at index ${k}: ${a}. Must be 0, 1, 2, or 3.`);
    }

    const w = W_VECTORS[a];
    const scale = Math.pow(2, k);
    i += scale * w.x;
    j += scale * w.y;
  }

  // Apply boundary corrections using 2^(n-1)
  const twoNminus1 = Math.pow(2, n - 1);

  if (2 * (j - i) > twoNminus1) {
    j = j - twoNminus1;
  } else if (-i - j > twoNminus1) {
    i = i + twoNminus1;
    j = j - twoNminus1;
  } else if (2 * i - j > twoNminus1) {
    i = i - twoNminus1;
  }

  const intermediateCoords: Vec2 = { x: i, y: j };

  // Transform to (x, y) using matrix M
  // M = [[M00, 0], [M10, M11]]
  // where:
  //   M00 = (1/2)^n
  //   M10 = -(sqrt(3)/3) * (1/2)^n * L
  //   M11 = (sqrt(3)/3) * (1/2)^(n-1) * L
  const L = rootSideLength;
  const sqrt3over3 = Math.sqrt(3) / 3;
  const halfPowN = Math.pow(0.5, n);
  const halfPowNminus1 = Math.pow(0.5, n - 1);

  const M00 = halfPowN;
  const M10 = -sqrt3over3 * halfPowN * L;
  const M11 = sqrt3over3 * halfPowNminus1 * L;

  const x = M00 * i;
  const y = M10 * i + M11 * j;

  // Final position relative to root centroid
  const position: Vec2 = {
    x: rootCentroid.x + x,
    y: rootCentroid.y + y,
  };

  // Compute parent centroids at each level
  const parentCentroids: HexaTreeLevel[] = [];

  for (let level = 0; level <= n; level++) {
    const pathPrefix = path.slice(0, level);
    const levelResult = computeLevelCentroid(rootCentroid, pathPrefix, rootSideLength);

    parentCentroids.push({
      level,
      centroid: levelResult.centroid,
      sideLength: levelResult.sideLength,
      pathPrefix,
    });
  }

  return {
    position,
    intermediateCoords,
    parentCentroids,
  };
}

/**
 * Computes the centroid and side length for a hexagon at a specific level.
 */
function computeLevelCentroid(
  rootCentroid: Vec2,
  pathPrefix: number[],
  rootSideLength: number
): { centroid: Vec2; sideLength: number } {
  const n = pathPrefix.length;

  if (n === 0) {
    return {
      centroid: { ...rootCentroid },
      sideLength: rootSideLength,
    };
  }

  // Compute intermediate coordinates for this prefix
  let i = 0;
  let j = 0;

  for (let k = 0; k < n; k++) {
    const a = pathPrefix[k];
    const w = W_VECTORS[a];
    const scale = Math.pow(2, k);
    i += scale * w.x;
    j += scale * w.y;
  }

  // Apply boundary corrections using 2^(n-1)
  const twoNminus1 = Math.pow(2, n - 1);

  if (2 * j - i > twoNminus1) {
    j = j - twoNminus1;
  } else if (-i - j > twoNminus1) {
    i = i + twoNminus1;
    j = j + twoNminus1;
  } else if (2 * i - j > twoNminus1) {
    i = i - twoNminus1;
  }

  // Transform to (x, y)
  const L = rootSideLength;
  const sqrt3over3 = Math.sqrt(3) / 3;
  const halfPowN = Math.pow(0.5, n);
  const halfPowNminus1 = Math.pow(0.5, n - 1);

  const M00 = halfPowN;
  const M10 = -sqrt3over3 * halfPowN * L;
  const M11 = sqrt3over3 * halfPowNminus1 * L;

  const x = M00 * i;
  const y = M10 * i + M11 * j;

  // Side length decreases by factor of 2 at each level
  const sideLength = rootSideLength * Math.pow(0.5, n);

  return {
    centroid: {
      x: rootCentroid.x + x,
      y: rootCentroid.y + y,
    },
    sideLength,
  };
}

/**
 * Parses a comma-separated string of path values.
 *
 * @param pathString - String like "0,1,2,3" or "0123"
 * @returns Array of path values
 */
export function parsePathString(pathString: string): number[] {
  const trimmed = pathString.trim();
  if (trimmed === '') {
    return [];
  }

  // Try comma-separated format first
  if (trimmed.includes(',')) {
    return trimmed.split(',').map(s => {
      const n = parseInt(s.trim(), 10);
      if (isNaN(n) || n < 0 || n > 3) {
        throw new Error(`Invalid path value: ${s}. Must be 0, 1, 2, or 3.`);
      }
      return n;
    });
  }

  // Try digit-by-digit format
  return trimmed.split('').map(c => {
    const n = parseInt(c, 10);
    if (isNaN(n) || n < 0 || n > 3) {
      throw new Error(`Invalid path value: ${c}. Must be 0, 1, 2, or 3.`);
    }
    return n;
  });
}

/**
 * Generates vertices for a regular hexagon centered at a point.
 *
 * @param center - Center position
 * @param sideLength - Side length of the hexagon
 * @returns Array of 6 vertices
 */
export function generateHexagonVertices(center: Vec2, sideLength: number): Vec2[] {
  const vertices: Vec2[] = [];

  // Angle offset = 0 for flat-top hexagon (horizontal edges at top and bottom)
  // This matches the orientation of root hexagons in the 2D lattice
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    vertices.push({
      x: center.x + sideLength * Math.cos(angle),
      y: center.y + sideLength * Math.sin(angle),
    });
  }

  return vertices;
}
