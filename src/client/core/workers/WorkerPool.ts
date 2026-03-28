/**
 * Generic Worker Pool implementation for parallel task execution.
 * Workers are created lazily and reused across tasks.
 */

export interface WorkerTask<TInput, TOutput> {
  id: string;
  type: string;
  data: TInput; transferables?: Transferable[];
  resolve: (result: TOutput) => void;
  reject: (error: Error) => void;
  sendTime?: number; // For timing measurements
}

export interface WorkerMessage<T = unknown> {
  taskId: string;
  type: 'result' | 'error';
  data?: T;
  error?: string;
}

export interface WorkerTaskInput<T = unknown> {
  taskId: string;
  type: string;
  data: T;
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  currentTaskId: string | null;
}

/**
 * A generic pool of web workers for parallel task execution.
 *
 * Usage:
 * ```typescript
 * const pool = new WorkerPool(() => new Worker(new URL('./myWorker.ts', import.meta.url)), 4);
 * const result = await pool.execute('myTask', inputData);
 * pool.terminate();
 * ```
 */
export class WorkerPool<TInput = unknown, TOutput = unknown> {
  private workers: PooledWorker[] = [];
  private taskQueue: WorkerTask<TInput, TOutput>[] = [];
  private taskIdCounter = 0;
  private workerFactory: () => Worker;
  private maxWorkers: number;
  private terminated = false;

  /**
   * Creates a new WorkerPool.
   * @param workerFactory Function that creates a new Worker instance
   * @param maxWorkers Maximum number of workers in the pool (defaults to navigator.hardwareConcurrency or 4)
   */
  constructor(workerFactory: () => Worker, maxWorkers?: number) {
    this.workerFactory = workerFactory;
    this.maxWorkers = maxWorkers ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) ?? 4;
  }

  /**
   * Executes a task on an available worker.
   * @param type The task type (used by the worker to determine what to do)
   * @param data The input data for the task
   * @param transferables Optional array of transferable objects for zero-copy transfer
   * @returns Promise that resolves with the task result
   */
  execute(type: string, data: TInput, transferables?: Transferable[]): Promise<TOutput> {
    if (this.terminated) {
      return Promise.reject(new Error('WorkerPool has been terminated'));
    }

    return new Promise((resolve, reject) => {
      const task: WorkerTask<TInput, TOutput> = {
        id: `task_${this.taskIdCounter++}`,
        type,
        data,
        transferables,
        resolve,
        reject,
      };

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * Executes multiple tasks in parallel and returns when all complete.
   * @param tasks Array of { type, data, transferables } objects
   * @returns Promise that resolves with array of results in the same order
   */
  executeAll(tasks: Array<{ type: string; data: TInput; transferables?: Transferable[] }>): Promise<TOutput[]> {
    return Promise.all(tasks.map(t => this.execute(t.type, t.data, t.transferables)));
  }

  /**
   * Executes multiple tasks in parallel with a callback for each completed task.
   * Useful for progressive rendering.
   * @param tasks Array of { type, data, transferables } objects
   * @param onComplete Callback called when each task completes
   * @returns Promise that resolves when all tasks complete
   */
  async executeWithProgress(
    tasks: Array<{ type: string; data: TInput; transferables?: Transferable[] }>,
    onComplete: (result: TOutput, index: number) => void
  ): Promise<void> {
    const promises = tasks.map((t, index) =>
      this.execute(t.type, t.data, t.transferables).then(result => {
        onComplete(result, index);
        return result;
      })
    );
    await Promise.all(promises);
  }

  /**
   * Gets the number of pending tasks in the queue.
   */
  get pendingTasks(): number {
    return this.taskQueue.length;
  }

  /**
   * Gets the number of active workers.
   */
  get activeWorkers(): number {
    return this.workers.filter(w => w.busy).length;
  }

  /**
   * Gets the total number of workers currently in the pool.
   */
  get totalWorkers(): number {
    return this.workers.length;
  }

  /**
   * Gets the maximum number of workers the pool can have.
   */
  get maxPoolSize(): number {
    return this.maxWorkers;
  }

  /**
   * Terminates all workers and clears the task queue.
   * Pending tasks will be rejected.
   */
  terminate(): void {
    this.terminated = true;

    // Reject all pending tasks
    for (const task of this.taskQueue) {
      task.reject(new Error('WorkerPool terminated'));
    }
    this.taskQueue = [];

    // Terminate all workers
    for (const pooledWorker of this.workers) {
      pooledWorker.worker.terminate();
    }
    this.workers = [];
  }

  /**
   * Processes the task queue, assigning tasks to available workers.
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0) return;

    // Find an available worker
    let availableWorker = this.workers.find(w => !w.busy);

    // If no available worker and we can create more, create one
    if (!availableWorker && this.workers.length < this.maxWorkers) {
      availableWorker = this.createWorker();
    }

    // If we have an available worker, assign the next task
    if (availableWorker) {
      const task = this.taskQueue.shift();
      if (task) {
        this.assignTask(availableWorker, task);
      }
    }
  }

  /**
   * Creates a new worker and adds it to the pool.
   */
  private createWorker(): PooledWorker {
    const worker = this.workerFactory();
    const pooledWorker: PooledWorker = {
      worker,
      busy: false,
      currentTaskId: null,
    };

    worker.onmessage = (event: MessageEvent<WorkerMessage<TOutput>>) => {
      this.handleWorkerMessage(pooledWorker, event.data);
    };

    worker.onerror = (error: ErrorEvent) => {
      this.handleWorkerError(pooledWorker, error);
    };

    this.workers.push(pooledWorker);
    return pooledWorker;
  }

  /**
   * Assigns a task to a worker.
   */
  private assignTask(pooledWorker: PooledWorker, task: WorkerTask<TInput, TOutput>): void {
    pooledWorker.busy = true;
    pooledWorker.currentTaskId = task.id;

    // Record send time for round-trip measurement
    task.sendTime = performance.now();

    // Store the task callbacks for later
    (pooledWorker as unknown as { pendingTask: WorkerTask<TInput, TOutput> }).pendingTask = task;

    const message: WorkerTaskInput<TInput> = {
      taskId: task.id,
      type: task.type,
      data: task.data,
    };

    if (task.transferables && task.transferables.length > 0) {
      pooledWorker.worker.postMessage(message, task.transferables);
    } else {
      pooledWorker.worker.postMessage(message);
    }
  }

  /**
   * Handles a message from a worker.
   */
  private handleWorkerMessage(pooledWorker: PooledWorker, message: WorkerMessage<TOutput>): void {

    const task = (pooledWorker as unknown as { pendingTask: WorkerTask<TInput, TOutput> }).pendingTask;

    if (!task || task.id !== message.taskId) {
      console.warn('[WorkerPool] Received message for unknown task:', message.taskId);
      return;
    }

    // Clear the pending task
    (pooledWorker as unknown as { pendingTask: undefined }).pendingTask = undefined;
    pooledWorker.busy = false;
    pooledWorker.currentTaskId = null;

    if (message.type === 'result') {
      task.resolve(message.data!);
    } else if (message.type === 'error') {
      console.error(`[WorkerPool] Task error: ${message.error}`);
      task.reject(new Error(message.error || 'Unknown worker error'));
    }

    // Process next task in queue
    this.processQueue();
  }

  /**
   * Handles an error from a worker.
   */
  private handleWorkerError(pooledWorker: PooledWorker, error: ErrorEvent): void {
    const task = (pooledWorker as unknown as { pendingTask: WorkerTask<TInput, TOutput> }).pendingTask;

    if (task) {
      task.reject(new Error(error.message || 'Worker error'));
      (pooledWorker as unknown as { pendingTask: undefined }).pendingTask = undefined;
    }

    pooledWorker.busy = false;
    pooledWorker.currentTaskId = null;

    // Process next task in queue
    this.processQueue();
  }
}
