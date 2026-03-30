/**
 * Service for generating quadrant meshes using a worker pool.
 * Provides a high-level API for parallel mesh generation.
 */

import * as THREE from 'three';
import { WorkerPool } from './WorkerPool';
import type { QuadrantMeshInput, QuadrantMeshOutput, QuadrantMeshBatchInput, QuadrantMeshBatchOutput } from './QuadrantMeshWorker';
import { ProjectionManager, ProjectionType } from '@core/geometry/SphereProjection';

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
  // Projection type (optional, defaults to current ProjectionManager setting)
  projectionType?: ProjectionType;
}

export interface QuadrantMeshResult {
  mesh: THREE.Mesh;
  id: string;
}

// Union types for worker pool to support both single and batch operations
type WorkerInput = QuadrantMeshInput | QuadrantMeshBatchInput;
type WorkerOutput = QuadrantMeshOutput | QuadrantMeshBatchOutput;

/**
 * Service for parallel quadrant mesh generation using web workers.
 */
export class QuadrantMeshService {
  private pool: WorkerPool<WorkerInput, WorkerOutput> | null = null;
  private idCounter = 0;

  /**
   * Creates the worker pool lazily when first needed.
   */
  private getPool(): WorkerPool<WorkerInput, WorkerOutput> {
    if (!this.pool) {
      console.log(`[QuadrantMeshService] Creating worker pool with ${navigator.hardwareConcurrency || 4} workers`);
      this.pool = new WorkerPool<WorkerInput, WorkerOutput>(
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
    // Use request projection type or fall back to current ProjectionManager setting
    const projectionType = request.projectionType ?? ProjectionManager.getProjection();
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
      projectionType: projectionType as unknown as import('./QuadrantMeshWorker').ProjectionType,
    };

    const output = await pool.execute('generateQuadrantMesh', input) as QuadrantMeshOutput;
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

      const projectionType = request.projectionType ?? ProjectionManager.getProjection();
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
        projectionType: projectionType as unknown as import('./QuadrantMeshWorker').ProjectionType,
      };

      return { type: 'generateQuadrantMesh', data: input };
    });

    const outputs = await pool.executeAll(tasks) as QuadrantMeshOutput[];

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
      const projectionType = request.projectionType ?? ProjectionManager.getProjection();

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
        projectionType: projectionType as unknown as import('./QuadrantMeshWorker').ProjectionType,
      };

      return { type: 'generateQuadrantMesh', data: input };
    });

    await pool.executeWithProgress(tasks, (result, index) => {
      const output = result as QuadrantMeshOutput;
      const mesh = this.createMeshFromOutput(output, requests[index].color);
      onMeshReady({ mesh, id: output.quadrantId }, index);
    });
  }

  /**
   * Generates multiple quadrant meshes distributed across all workers.
   * Results are returned progressively as each worker completes its batch.
   * @param requests Array of mesh generation requests
   * @param onBatchReady Callback called when each worker completes its batch
   * @returns Promise that resolves when all batches are complete
   */
  async generateMeshesBatchedParallel(
    requests: QuadrantMeshRequest[],
    onBatchReady: (results: QuadrantMeshResult[]) => void
  ): Promise<void> {
    if (requests.length === 0) return;

    const pool = this.getPool();
    const numWorkers = pool.maxPoolSize;
    const batchStart = performance.now();

    // Convert requests to worker inputs
    const allInputs: { input: QuadrantMeshInput; originalRequest: QuadrantMeshRequest }[] = requests.map((request) => {
      const quadrantId = request.id ?? `quadrant_${this.idCounter++}`;
      const color = new THREE.Color(request.color);
      const projectionType = request.projectionType ?? ProjectionManager.getProjection();

      return {
        input: {
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
          projectionType: projectionType as unknown as import('./QuadrantMeshWorker').ProjectionType,
        },
        originalRequest: request,
      };
    });

    // Split into sub-batches, one per worker
    const subBatches: typeof allInputs[] = [];
    const batchSize = Math.ceil(allInputs.length / numWorkers);

    for (let i = 0; i < allInputs.length; i += batchSize) {
      subBatches.push(allInputs.slice(i, i + batchSize));
    }

    console.log(`[QuadrantMeshService] Distributing ${requests.length} meshes across ${subBatches.length} workers (batch size: ${batchSize})`);

    // Execute all sub-batches in parallel, with progressive callbacks
    const batchPromises = subBatches.map(async (subBatch, workerIndex) => {
      const batchInput: QuadrantMeshBatchInput = {
        quadrants: subBatch.map(item => item.input)
      };

      const workerStart = performance.now();
      const output = await pool.execute('generateQuadrantMeshBatch', batchInput) as QuadrantMeshBatchOutput;
      const workerEnd = performance.now();

      console.log(`[QuadrantMeshService] Worker ${workerIndex}: ${subBatch.length} meshes, ` +
                  `roundTrip=${(workerEnd - workerStart).toFixed(2)}ms, ` +
                  `compute=${output.workerComputeTimeMs.toFixed(2)}ms`);

      // Convert outputs to meshes and call the callback immediately
      const results = output.results.map((result, index) => ({
        mesh: this.createMeshFromOutput(result, subBatch[index].originalRequest.color),
        id: result.quadrantId,
      }));

      // Progressive callback - render these meshes immediately
      onBatchReady(results);

      return results;
    });

    await Promise.all(batchPromises);

    const batchEnd = performance.now();
    console.log(`[QuadrantMeshService] Total: ${requests.length} meshes in ${(batchEnd - batchStart).toFixed(2)}ms across ${subBatches.length} workers`);
  }

  /**
   * Generates multiple quadrant meshes in a single batched worker task.
   * @deprecated Use generateMeshesBatchedParallel for better performance
   * @param requests Array of mesh generation requests
   * @returns Promise resolving to array of generated meshes
   */
  async generateMeshesBatched(requests: QuadrantMeshRequest[]): Promise<QuadrantMeshResult[]> {
    if (requests.length === 0) return [];

    const results: QuadrantMeshResult[] = [];

    await this.generateMeshesBatchedParallel(requests, (batchResults) => {
      results.push(...batchResults);
    });

    return results;
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
    const normals = output.normals instanceof Float32Array
      ? output.normals
      : new Float32Array(output.normals);
    const indices = output.indices instanceof Uint16Array || output.indices instanceof Uint32Array
      ? output.indices
      : new Uint16Array(output.indices);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // Normals are now pre-computed in the worker

    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.FrontSide,
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
