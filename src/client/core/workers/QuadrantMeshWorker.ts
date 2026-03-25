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
}

export interface QuadrantMeshOutput {
  // Float32Array of vertex positions (x, y, z, x, y, z, ...)
  positions: Float32Array;
  // Uint16Array or Uint32Array of triangle indices
  indices: Uint16Array | Uint32Array;
  // Float32Array of vertex colors (r, g, b, r, g, b, ...)
  colors: Float32Array;
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

/**
 * Projects a cube point to the sphere using Everett-Praun mapping.
 * Simplified version for the worker.
 */
function projectToSphere(x: number, y: number, z: number, offset: number): [number, number, number] {
  // Normalize to get point on unit sphere
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return [0, 0, 0];

  const scale = (1 + offset) / len;
  return [x * scale, y * scale, z * scale];
}

/**
 * Generates mesh data for a quadrant.
 */
function generateQuadrantMesh(input: QuadrantMeshInput): QuadrantMeshOutput {
  const { u0, u1, v0, v1, face, subdivisions, sphereMode, offset, color, quadrantId } = input;
  const n = Math.max(1, subdivisions);

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

      // Get point on cube surface
      let [px, py, pz] = faceUVToCubePoint(face, u, v);

      if (sphereMode) {
        // Project to sphere
        [px, py, pz] = projectToSphere(px, py, pz, offset);
      } else {
        // Apply offset along face normal for cube mode
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

  return {
    positions,
    indices,
    colors,
    quadrantId,
  };
}

// Worker message handler
self.onmessage = (event: MessageEvent<WorkerTaskInput<QuadrantMeshInput>>) => {
  const { taskId, type, data } = event.data;

  console.log(`[Worker] Received task: ${taskId}, type: ${type}`);

  try {
    if (type === 'generateQuadrantMesh') {
      const result = generateQuadrantMesh(data);

      console.log(`[Worker] Generated mesh: positions=${result.positions.length/3} vertices, indices=${result.indices.length/3} triangles`);

      const response: WorkerMessage<QuadrantMeshOutput> = {
        taskId,
        type: 'result',
        data: result,
      };

      // Transfer the typed arrays for zero-copy
      (self as unknown as Worker).postMessage(response, [
        result.positions.buffer,
        result.indices.buffer,
        result.colors.buffer,
      ] as Transferable[]);

      console.log(`[Worker] Sent response for task: ${taskId}`);
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
