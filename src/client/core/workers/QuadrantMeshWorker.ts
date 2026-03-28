/**
 * Web Worker for generating quadrant mesh geometry data.
 * This worker computes vertex positions and triangle indices for quadrant meshes,
 * which can then be used to create Three.js BufferGeometry on the main thread.
 *
 * Note: This worker is self-contained and doesn't import from other modules
 * to ensure it works correctly when bundled by webpack.
 */

// Worker message types (duplicated from WorkerPool to keep worker self-contained)
interface WorkerMessage<T = unknown> {
  taskId: string;
  type: 'result' | 'error';
  data?: T;
  error?: string;
}

interface WorkerTaskInput<T = unknown> {
  taskId: string;
  type: string;
  data: T;
}

// CubeFace enum (duplicated here since workers have separate context)
export const enum CubeFace {
  PLUS_X = 0,
  MINUS_X = 1,
  PLUS_Y = 2,
  MINUS_Y = 3,
  PLUS_Z = 4,
  MINUS_Z = 5,
}

// Projection type enum (duplicated for worker context)
export const enum ProjectionType {
  EVERETT_PRAUN = 'everett_praun',
  ARVO = 'arvo',
}

export interface QuadrantMeshInput {
  // UV bounds of the quadrant
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  // Cube face
  face: CubeFace;
  // Number of subdivisions per edge
  subdivisions: number;
  // Whether to project to sphere
  sphereMode: boolean;
  // Small offset to avoid z-fighting
  offset: number;
  // Color for the mesh (as RGB components 0-1)
  color: { r: number; g: number; b: number };
  // Unique identifier for this quadrant (for tracking)
  quadrantId: string;
  // Projection type (optional, defaults to EVERETT_PRAUN)
  projectionType?: ProjectionType;
}

export interface QuadrantMeshOutput {
  // Float32Array of vertex positions (x, y, z, x, y, z, ...)
  positions: Float32Array;
  // Uint16Array or Uint32Array of triangle indices
  indices: Uint16Array | Uint32Array;
  // Float32Array of vertex colors (r, g, b, r, g, b, ...)
  colors: Float32Array;
  // Float32Array of vertex normals (nx, ny, nz, nx, ny, nz, ...)
  normals: Float32Array;
  // The quadrant identifier
  quadrantId: string;
}

/**
 * Converts face UV coordinates to a 3D point on the cube surface.
 */
function faceUVToCubePoint(face: CubeFace, u: number, v: number): [number, number, number] {
  switch (face) {
    case CubeFace.PLUS_X:
      return [1, v, -u];
    case CubeFace.MINUS_X:
      return [-1, v, u];
    case CubeFace.PLUS_Y:
      return [u, 1, v];
    case CubeFace.MINUS_Y:
      return [u, -1, -v];
    case CubeFace.PLUS_Z:
      return [u, v, 1];
    case CubeFace.MINUS_Z:
      return [-u, v, -1];
    default:
      return [0, 0, 0];
  }
}

/**
 * Gets the outward normal for a cube face.
 */
function getCubeFaceNormal(face: CubeFace): [number, number, number] {
  switch (face) {
    case CubeFace.PLUS_X:
      return [1, 0, 0];
    case CubeFace.MINUS_X:
      return [-1, 0, 0];
    case CubeFace.PLUS_Y:
      return [0, 1, 0];
    case CubeFace.MINUS_Y:
      return [0, -1, 0];
    case CubeFace.PLUS_Z:
      return [0, 0, 1];
    case CubeFace.MINUS_Z:
      return [0, 0, -1];
    default:
      return [0, 0, 0];
  }
}

// ============================================================================
// Everett-Praun Projection Constants
// ============================================================================
const PI_OVER_4 = Math.PI / 4;

/**
 * Applies Everett-Praun tangent warp to UV coordinates.
 */
function everettPraunWarp(u: number, v: number): { xw: number; yw: number } {
  return {
    xw: Math.tan(u * PI_OVER_4),
    yw: Math.tan(v * PI_OVER_4),
  };
}

// ============================================================================
// Arvo Equal-Area Projection Constants
// ============================================================================
const PI_OVER_6 = Math.PI / 6;
const PI_OVER_3 = Math.PI / 3;
const SQRT2 = Math.sqrt(2);

/**
 * Applies Arvo equal-area transformation to UV coordinates.
 * From doc/arvo_mapping.md:
 * u' = sqrt(2) * tan(π*a / 6) / sqrt(1 - tan²(π*a / 6))
 * v' = b / sqrt(1 + (1 - b²) * cos(π*a / 3))
 */
function arvoWarp(a: number, b: number): { xw: number; yw: number } {
  const tanA = Math.tan(a * PI_OVER_6);
  const tanA2 = tanA * tanA;

  const denom = 1 - tanA2;
  let xw: number;
  if (Math.abs(denom) < 1e-10) {
    xw = a > 0 ? 1e6 : -1e6;
  } else {
    xw = SQRT2 * tanA / Math.sqrt(Math.abs(denom));
    if (denom < 0) xw = -xw;
  }

  const cosA3 = Math.cos(a * PI_OVER_3);
  const vDenom = Math.sqrt(1 + (1 - b * b) * cosA3);
  const yw = b / vDenom;

  return { xw, yw };
}

/**
 * Gets warped coordinates based on projection type.
 */
function getWarpedCoords(u: number, v: number, projectionType: ProjectionType): { xw: number; yw: number } {
  switch (projectionType) {
    case ProjectionType.ARVO:
      return arvoWarp(u, v);
    case ProjectionType.EVERETT_PRAUN:
    default:
      return everettPraunWarp(u, v);
  }
}

/**
 * Projects warped coordinates to 3D point based on face, then normalizes to sphere.
 */
function warpedToSpherePoint(
  face: CubeFace,
  xw: number,
  yw: number,
  offset: number
): [number, number, number] {
  let px: number, py: number, pz: number;

  switch (face) {
    case CubeFace.PLUS_X:
      px = 1; py = yw; pz = -xw;
      break;
    case CubeFace.MINUS_X:
      px = -1; py = yw; pz = xw;
      break;
    case CubeFace.PLUS_Y:
      px = xw; py = 1; pz = yw;
      break;
    case CubeFace.MINUS_Y:
      px = xw; py = -1; pz = -yw;
      break;
    case CubeFace.PLUS_Z:
      px = xw; py = yw; pz = 1;
      break;
    case CubeFace.MINUS_Z:
      px = -xw; py = yw; pz = -1;
      break;
    default:
      px = 0; py = 0; pz = 1;
  }

  // Normalize to sphere
  const len = Math.sqrt(px * px + py * py + pz * pz);
  if (len === 0) return [0, 0, 0];

  const scale = (1 + offset) / len;
  return [px * scale, py * scale, pz * scale];
}

/**
 * Computes vertex normals from positions and indices.
 * Accumulates face normals at each vertex and normalizes.
 */
function computeVertexNormals(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  numVertices: number
): Float32Array {
  const normals = new Float32Array(numVertices * 3);

  // Accumulate face normals at each vertex
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];

    // Get vertex positions
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];

    const bx = positions[ib * 3];
    const by = positions[ib * 3 + 1];
    const bz = positions[ib * 3 + 2];

    const cx = positions[ic * 3];
    const cy = positions[ic * 3 + 1];
    const cz = positions[ic * 3 + 2];

    // Compute edge vectors
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;

    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    // Cross product for face normal
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    // Accumulate at each vertex
    normals[ia * 3] += nx;
    normals[ia * 3 + 1] += ny;
    normals[ia * 3 + 2] += nz;

    normals[ib * 3] += nx;
    normals[ib * 3 + 1] += ny;
    normals[ib * 3 + 2] += nz;

    normals[ic * 3] += nx;
    normals[ic * 3 + 1] += ny;
    normals[ic * 3 + 2] += nz;
  }

  // Normalize all vertex normals
  for (let i = 0; i < numVertices; i++) {
    const idx = i * 3;
    const nx = normals[idx];
    const ny = normals[idx + 1];
    const nz = normals[idx + 2];

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      normals[idx] = nx / len;
      normals[idx + 1] = ny / len;
      normals[idx + 2] = nz / len;
    }
  }

  return normals;
}

/**
 * Generates mesh data for a quadrant.
 */
function generateQuadrantMesh(input: QuadrantMeshInput): QuadrantMeshOutput {
  const { u0, u1, v0, v1, face, subdivisions, sphereMode, offset, color, quadrantId, projectionType } = input;
  const n = Math.max(1, subdivisions);
  const projection = projectionType ?? ProjectionType.EVERETT_PRAUN;

  const numVertices = (n + 1) * (n + 1);
  const numTriangles = n * n * 2;

  const positions = new Float32Array(numVertices * 3);
  const colors = new Float32Array(numVertices * 3);
  const indices = numVertices > 65536 ? new Uint32Array(numTriangles * 3) : new Uint16Array(numTriangles * 3);

  const faceNormal = getCubeFaceNormal(face);

  // Generate vertices
  let vertexIndex = 0;
  for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * (i / n);
    for (let j = 0; j <= n; j++) {
      const v = v0 + (v1 - v0) * (j / n);

      let px: number, py: number, pz: number;

      if (sphereMode) {
        // Apply warping based on projection type, then project to sphere
        const { xw, yw } = getWarpedCoords(u, v, projection);
        [px, py, pz] = warpedToSpherePoint(face, xw, yw, offset);
      } else {
        // Cube mode: just get point on cube surface with offset
        [px, py, pz] = faceUVToCubePoint(face, u, v);
        px += faceNormal[0] * offset;
        py += faceNormal[1] * offset;
        pz += faceNormal[2] * offset;
      }

      const idx = vertexIndex * 3;
      positions[idx] = px;
      positions[idx + 1] = py;
      positions[idx + 2] = pz;

      colors[idx] = color.r;
      colors[idx + 1] = color.g;
      colors[idx + 2] = color.b;

      vertexIndex++;
    }
  }

  // Generate indices
  let indexOffset = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const topLeft = i * (n + 1) + j;
      const topRight = topLeft + 1;
      const bottomLeft = (i + 1) * (n + 1) + j;
      const bottomRight = bottomLeft + 1;

      // Two triangles per quad
      indices[indexOffset++] = topLeft;
      indices[indexOffset++] = bottomLeft;
      indices[indexOffset++] = topRight;

      indices[indexOffset++] = topRight;
      indices[indexOffset++] = bottomLeft;
      indices[indexOffset++] = bottomRight;
    }
  }

  // Compute vertex normals
  const normals = computeVertexNormals(positions, indices, numVertices);

  return {
    positions,
    indices,
    colors,
    normals,
    quadrantId,
  };
}

// Detailed timing breakdown for profiling communication overhead
export interface WorkerTimingBreakdown {
  t_mainPostMessage?: number;    // When main thread called postMessage
  t_workerReceive: number;       // When worker received message
  t_computeStart: number;        // Before compute
  t_computeEnd: number;          // After compute
  t_beforePostMessage: number;   // Before worker posts result
}

// Extended output with timing info
interface QuadrantMeshOutputWithTiming extends QuadrantMeshOutput {
  workerComputeTimeMs: number;
  timing: WorkerTimingBreakdown;
}

// Batch input/output types
export interface QuadrantMeshBatchInput {
  quadrants: QuadrantMeshInput[];
}

export interface QuadrantMeshBatchOutput {
  results: QuadrantMeshOutput[];
  workerComputeTimeMs: number;
  timing: WorkerTimingBreakdown;
}

// Extended task input with optional timing from main thread
interface WorkerTaskInputWithTiming<T = unknown> extends WorkerTaskInput<T> {
  t_mainPostMessage?: number;
}

// Helper to get absolute timestamp synchronized across threads
function absoluteNow(): number {
  return performance.timeOrigin + performance.now();
}

// Worker message handler
self.onmessage = (event: MessageEvent<WorkerTaskInputWithTiming<QuadrantMeshInput | QuadrantMeshBatchInput>>) => {
  const t_workerReceive = absoluteNow();
  const { taskId, type, data, t_mainPostMessage } = event.data;

  try {
    if (type === 'generateQuadrantMesh') {
      const t_computeStart = absoluteNow();
      const result = generateQuadrantMesh(data as QuadrantMeshInput);
      const t_computeEnd = absoluteNow();
      const computeTimeMs = t_computeEnd - t_computeStart;

      const t_beforePostMessage = absoluteNow();

      const response: WorkerMessage<QuadrantMeshOutputWithTiming> = {
        taskId,
        type: 'result',
        data: {
          ...result,
          workerComputeTimeMs: computeTimeMs,
          timing: {
            t_mainPostMessage,
            t_workerReceive,
            t_computeStart,
            t_computeEnd,
            t_beforePostMessage,
          },
        },
      };

      // Transfer the typed arrays for zero-copy
      (self as unknown as Worker).postMessage(response, [
        result.positions.buffer,
        result.indices.buffer,
        result.colors.buffer,
        result.normals.buffer,
      ] as Transferable[]);
    } else if (type === 'generateQuadrantMeshBatch') {
      const batchInput = data as QuadrantMeshBatchInput;
      const t_computeStart = absoluteNow();

      const results: QuadrantMeshOutput[] = [];
      const transferables: Transferable[] = [];

      for (const quadrant of batchInput.quadrants) {
        const result = generateQuadrantMesh(quadrant);
        results.push(result);
        transferables.push(result.positions.buffer, result.indices.buffer, result.colors.buffer, result.normals.buffer);
      }

      const t_computeEnd = absoluteNow();
      const computeTimeMs = t_computeEnd - t_computeStart;

      const t_beforePostMessage = absoluteNow();

      const response: WorkerMessage<QuadrantMeshBatchOutput> = {
        taskId,
        type: 'result',
        data: {
          results,
          workerComputeTimeMs: computeTimeMs,
          timing: {
            t_mainPostMessage,
            t_workerReceive,
            t_computeStart,
            t_computeEnd,
            t_beforePostMessage,
          },
        },
      };

      // Transfer all typed arrays for zero-copy
      (self as unknown as Worker).postMessage(response, transferables);
    } else {
      throw new Error(`Unknown task type: ${type}`);
    }
  } catch (error) {
    console.error(`[Worker] Error:`, error);
    const response: WorkerMessage = {
      taskId,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

// Export for type checking (not used at runtime in worker)
export {};
