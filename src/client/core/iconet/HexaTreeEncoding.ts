/**
 * HexaTree Encoding System
 *
 * Decodes a hierarchical path to x,y coordinates on a 2D hexagonal lattice.
 *
 * Encoding format:
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

const SQRT3_OVER_3 = Math.sqrt(3) / 3;

/**
 * Decodes a HexaTree path to 2D centroid coordinates at each level.
 *
 * Algorithm (3 passes):
 *   1. Compute intermediate (i, j) at each level
 *   2. Apply boundary translation to each (i, j)
 *   3. Transform each translated (i, j) to (x, y)
 *
 * @param rootCentroid - The centroid position of the root hexagon
 * @param path - Array of values in {0, 1, 2, 3}
 * @param triangleSideLength - Side length of triangles
 * @returns Array of centroids, one per level
 */
export function decodeHexaTreePath(
  rootCentroid: Vec2,
  path: number[],
  triangleSideLength: number
): Vec2[] {
  console.log("===============================");

  // Validate path
  for (let k = 0; k < path.length; k++) {
    const a = path[k];
    if (a < 0 || a > 3) {
      throw new Error(`Invalid path value at index ${k}: ${a}. Must be 0, 1, 2, or 3.`);
    }
  }

  if (path.length === 0) {
    throw new Error('Path cannot be empty. Must have at least one level.');
  }

  const len = path.length;
  console.log("path: ", path);

  // ========================================
  // Pass 1: Compute (i, j) at each level
  // ========================================
  const ijCoords: Vec2[] = [];
  let i = 0;
  let j = 0;

  for (let level = 1; level <= len; level++) {
    const idx = level - 1;
    const a = path[idx];
    const w = W_VECTORS[a];
    const scale = Math.pow(2, level);
    i += scale * w.x;
    j += scale * w.y;
    ijCoords.push({ x: i, y: j });
  }

  console.log("Pass 1 - (i, j) coords:");
  for (let k = 0; k < ijCoords.length; k++) {
    console.log(`  level ${k + 1}: (i,j)=(${ijCoords[k].x}, ${ijCoords[k].y})`);
  }

  // ========================================
  // Pass 2: Apply boundary translation
  // ========================================
  const ijTranslated: Vec2[] = [];

  for (let level = 1; level <= len; level++) {
    const idx = level - 1;
    const { x: i, y: j } = ijCoords[idx];
    const threshold = Math.pow(2, level);

    let iTrans = i;
    let jTrans = j;

    if (2 * j - i > threshold) {
      jTrans = j - threshold;
    } else if (-i - j > threshold) {
      iTrans = i + threshold;
      jTrans = j + threshold;
    } else if (2 * i - j > threshold) {
      iTrans = i - threshold;
    }

    ijTranslated.push({ x: iTrans, y: jTrans });
  }
  console.log("Pass 2 - translated (i, j):");
  for (let k = 0; k < ijTranslated.length; k++) {
    console.log(`  level ${k + 1}: (${ijTranslated[k].x}, ${ijTranslated[k].y})`);
  }

  // ========================================
  // Pass 3: Transform (i, j) -> (x, y)
  // ========================================
  const centroids: Vec2[] = [];

  for (let level = 1; level <= len; level++) {
    const idx = level - 1;
    const { x: i, y: j } = ijTranslated[idx];

    const halfPowNPlus1 = Math.pow(0.5, level + 1);
    const halfPowN = Math.pow(0.5, level);

    const M00 = halfPowNPlus1;
    const M10 = -SQRT3_OVER_3 * halfPowNPlus1 * triangleSideLength;
    const M11 = SQRT3_OVER_3 * halfPowN * triangleSideLength;

    const x = M00 * i;
    const y = M10 * i + M11 * j;

    centroids.push({
      x: rootCentroid.x + x,
      y: rootCentroid.y + y,
    });
  }

  console.log("Pass 3 - centroids (x, y):");
  for (let k = 0; k < centroids.length; k++) {
    console.log(`  level ${k + 1}: (${centroids[k].x.toFixed(4)}, ${centroids[k].y.toFixed(4)})`);
  }

  return centroids;
}

/**
 * Parses a path string containing only digits 0-3.
 *
 * @param pathString - String like "0123" (only 0, 1, 2, 3 allowed)
 * @returns Array of path values
 */
export function parsePathString(pathString: string): number[] {
  const trimmed = pathString.trim();
  if (trimmed === '') {
    return [];
  }

  if (!/^[0-3]+$/.test(trimmed)) {
    throw new Error('Path must contain only digits 0, 1, 2, or 3.');
  }

  return trimmed.split('').map(c => parseInt(c, 10));
}

