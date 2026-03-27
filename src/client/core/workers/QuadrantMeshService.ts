/**
 * Service for generating quadrant meshes using a worker pool.
 * Provides a high-level API for parallel mesh generation.
 */

import * as THREE from 'three';
import { WorkerPool } from './WorkerPool';
import type { QuadrantMeshInput, QuadrantMeshOutput, QuadrantMeshBatchInput, QuadrantMeshBatchOutput } from './QuadrantMeshWorker';

// Re-export CubeFace for convenience
export { CubeFace } from './QuadrantMeshWorker';

export interface QuadrantMeshRequest {
  // UV bounds of the quadrant
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  // Cube face (0-5)
  face: number;
  // Number of subdivisions per edge
  subdivisions: number;
  // Whether to project to sphere
  sphereMode: boolean;
  // Small offset to avoid z-fighting
  offset?: number;
  // Color for the mesh
  color: number;
  // Optional identifier
  id?: string;
}

export interface QuadrantMeshResult {
  mesh: THREE.Mesh;
  id: string;
}

/**
 * Service for parallel quadrant mesh generation using web workers.
 */
export class QuadrantMeshService {
  private pool: WorkerPool<QuadrantMeshInput, QuadrantMeshOutput> | null = null;
  private idCounter = 0;

  /**
   * Creates the worker pool lazily when first needed.
   */
  private getPool(): WorkerPool<QuadrantMeshInput, QuadrantMeshOutput> {
    if (!this.pool) {
      console.log(`[QuadrantMeshService] Creating worker pool with ${navigator.hardwareConcurrency || 4} workers`);
      this.pool = new WorkerPool<QuadrantMeshInput, QuadrantMeshOutput>(
        () => {
          console.log(`[QuadrantMeshService] Creating new worker`);
          return new Worker(new URL('./QuadrantMeshWorker.ts', import.meta.url));
        },
        navigator.hardwareConcurrency || 4
      );
    }
    return this.pool;
  }

  /**
   * Generates a single quadrant mesh.
   * @param request The mesh generation request
   * @returns Promise resolving to the generated mesh
   */
  async generateMesh(request: QuadrantMeshRequest): Promise<QuadrantMeshResult> {
    const pool = this.getPool();
    const quadrantId = request.id ?? `quadrant_${this.idCounter++}`;

    const color = new THREE.Color(request.color);
    const input: QuadrantMeshInput = {
      u0: request.u0,
      u1: request.u1,
      v0: request.v0,
      v1: request.v1,
      face: request.face,
      subdivisions: request.subdivisions,
      sphereMode: request.sphereMode,
      offset: request.offset ?? 0.001,
      color: { r: color.r, g: color.g, b: color.b },
      quadrantId,
    };

    const output = await pool.execute('generateQuadrantMesh', input);
    const mesh = this.createMeshFromOutput(output, request.color);

    return { mesh, id: output.quadrantId };
  }

  /**
   * Generates multiple quadrant meshes in parallel.
   * @param requests Array of mesh generation requests
   * @returns Promise resolving to array of generated meshes
   */
  async generateMeshes(requests: QuadrantMeshRequest[]): Promise<QuadrantMeshResult[]> {
    const pool = this.getPool();

    const tasks = requests.map((request) => {
      const quadrantId = request.id ?? `quadrant_${this.idCounter++}`;
      const color = new THREE.Color(request.color);

      const input: QuadrantMeshInput = {
        u0: request.u0,
        u1: request.u1,
        v0: request.v0,
        v1: request.v1,
        face: request.face,
        subdivisions: request.subdivisions,
        sphereMode: request.sphereMode,
        offset: request.offset ?? 0.001,
        color: { r: color.r, g: color.g, b: color.b },
        quadrantId,
      };

      return { type: 'generateQuadrantMesh', data: input };
    });

    const outputs = await pool.executeAll(tasks);

    return outputs.map((output, index) => ({
      mesh: this.createMeshFromOutput(output, requests[index].color),
      id: output.quadrantId,
    }));
  }

  /**
   * Generates multiple quadrant meshes with progress callback.
   * Meshes are returned as they complete, allowing progressive rendering.
   * @param requests Array of mesh generation requests
   * @param onMeshReady Callback called when each mesh is ready
   * @returns Promise that resolves when all meshes are complete
   */
  async generateMeshesWithProgress(
    requests: QuadrantMeshRequest[],
    onMeshReady: (result: QuadrantMeshResult, index: number) => void
  ): Promise<void> {
    const pool = this.getPool();

    const tasks = requests.map((request) => {
      const quadrantId = request.id ?? `quadrant_${this.idCounter++}`;
      const color = new THREE.Color(request.color);

      const input: QuadrantMeshInput = {
        u0: request.u0,
        u1: request.u1,
        v0: request.v0,
        v1: request.v1,
        face: request.face,
        subdivisions: request.subdivisions,
        sphereMode: request.sphereMode,
        offset: request.offset ?? 0.001,
        color: { r: color.r, g: color.g, b: color.b },
        quadrantId,
      };

      return { type: 'generateQuadrantMesh', data: input };
    });

    await pool.executeWithProgress(tasks, (output, index) => {
      const mesh = this.createMeshFromOutput(output, requests[index].color);
      onMeshReady({ mesh, id: output.quadrantId }, index);
    });
  }

  /**
   * Generates multiple quadrant meshes in a single batched worker task.
   * This minimizes message passing overhead by sending all requests in one message.
   * @param requests Array of mesh generation requests
   * @returns Promise resolving to array of generated meshes
   */
  async generateMeshesBatched(requests: QuadrantMeshRequest[]): Promise<QuadrantMeshResult[]> {
    if (requests.length === 0) return [];

    const pool = this.getPool();
    const batchStart = performance.now();

    // Build batch input
    const quadrants: QuadrantMeshInput[] = requests.map((request) => {
      const quadrantId = request.id ?? `quadrant_${this.idCounter++}`;
      const color = new THREE.Color(request.color);

      return {
        u0: request.u0,
        u1: request.u1,
        v0: request.v0,
        v1: request.v1,
        face: request.face,
        subdivisions: request.subdivisions,
        sphereMode: request.sphereMode,
        offset: request.offset ?? 0.001,
        color: { r: color.r, g: color.g, b: color.b },
        quadrantId,
      };
    });

    const batchInput: QuadrantMeshBatchInput = { quadrants };

    // Execute single batched task
    const output = await pool.execute('generateQuadrantMeshBatch', batchInput as unknown as QuadrantMeshInput) as unknown as QuadrantMeshBatchOutput;

    const batchEnd = performance.now();
    console.log(`[QuadrantMeshService] Batch: ${requests.length} meshes, roundTrip=${(batchEnd - batchStart).toFixed(2)}ms, workerCompute=${output.workerComputeTimeMs.toFixed(2)}ms, overhead=${(batchEnd - batchStart - output.workerComputeTimeMs).toFixed(2)}ms`);

    // Convert outputs to meshes
    return output.results.map((result, index) => ({
      mesh: this.createMeshFromOutput(result, requests[index].color),
      id: result.quadrantId,
    }));
  }

  /**
   * Creates a Three.js Mesh from worker output.
   */
  private createMeshFromOutput(output: QuadrantMeshOutput, color: number): THREE.Mesh {

    const geometry = new THREE.BufferGeometry();

    // Ensure we have valid typed arrays
    const positions = output.positions instanceof Float32Array
      ? output.positions
      : new Float32Array(output.positions);
    const colors = output.colors instanceof Float32Array
      ? output.colors
      : new Float32Array(output.colors);
    const indices = output.indices instanceof Uint16Array || output.indices instanceof Uint32Array
      ? output.indices
      : new Uint16Array(output.indices);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
      vertexColors: false,
    });

    return new THREE.Mesh(geometry, material);
  }

  /**
   * Gets the number of pending tasks.
   */
  get pendingTasks(): number {
    return this.pool?.pendingTasks ?? 0;
  }

  /**
   * Gets the number of active workers.
   */
  get activeWorkers(): number {
    return this.pool?.activeWorkers ?? 0;
  }

  /**
   * Terminates the worker pool and releases resources.
   */
  terminate(): void {
    if (this.pool) {
      this.pool.terminate();
      this.pool = null;
    }
  }
}

// Singleton instance for convenience
let defaultService: QuadrantMeshService | null = null;

/**
 * Gets the default QuadrantMeshService instance.
 */
export function getQuadrantMeshService(): QuadrantMeshService {
  if (!defaultService) {
    defaultService = new QuadrantMeshService();
  }
  return defaultService;
}

/**
 * Terminates the default service and releases resources.
 */
export function terminateQuadrantMeshService(): void {
  if (defaultService) {
    defaultService.terminate();
    defaultService = null;
  }
}
