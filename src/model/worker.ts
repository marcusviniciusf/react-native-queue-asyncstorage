import type {Job} from '../types/Job'
import type {WorkerOption, WorkerType} from '../types/Worker'

type Callbacks = keyof Omit<WorkerOption, 'concurrency'>

type Workers<T extends object> = Record<string, WorkerType<T>>

/**
 * Worker Model
 */
class Worker {
  /**
   * Singleton map of all worker functions assigned to queue.
   */
  static workers: Workers<any> = {}

  /**
   * Assign a worker function to the queue.
   * - Worker will be called to execute jobs associated with `name`.
   * @param {string} name Name associated with jobs assigned to this worker.
   * @param {function} worker The worker function that will execute jobs.
   * @param {object} options Worker options. See README.md for worker options info.
   */
  addWorker<T extends object>(name: string, worker: WorkerType<T>, options: WorkerOption = {}) {
    // Validate input.
    if (!name || !worker) {
      throw new Error('Job name and associated worker function must be supplied.')
    }

    // Attach options to worker
    worker.options = {
      concurrency: options.concurrency || 1,
      onStart: options.onStart || undefined,
      onSuccess: options.onSuccess || undefined,
      onFailure: options.onFailure || undefined,
      onFailed: options.onFailed || undefined,
      onComplete: options.onComplete || undefined,
    }

    Worker.workers[name] = worker
  }

  /**
   * Un-assign worker function from queue.
   * @param {string} name Name associated with jobs assigned to this worker.
   */
  removeWorker(name: string): void {
    delete Worker.workers[name]
  }

  /**
   * Get the concurrency setting for a worker.
   * - Worker concurrency defaults to 1.
   * @param {string} name Name associated with jobs assigned to this worker.
   * @throws Throws error if no worker is currently assigned to passed in job name.
   * @return {number}
   */
  getConcurrency(name: string): number {
    // If no worker assigned to job name, throw error.
    if (!Worker.workers[name]) {
      throw new Error(`Job ${name} does not have a worker assigned to it.`)
    }
    return Worker.workers[name].options?.concurrency ?? 1
  }

  get workers() {
    return Worker.workers
  }

  /**
   * Execute the worker function assigned to the passed in job name.
   * - If job has a timeout setting, job will fail with a timeout exception upon reaching timeout.
   * @param {object} job Job to execute.
   * @throws Throws error if no worker is currently assigned to passed in job name.
   */
  async executeJob(job: Job) {
    // If no worker assigned to job name, throw error.
    if (!Worker.workers[job.name]) {
      throw new Error(`Job ${job.name} does not have a worker assigned to it.`)
    }

    const jobId = job.id
    const jobName = job.name
    const jobTimeout = job.timeout
    const jobPayload = JSON.parse(job.payload) as Record<string, unknown>
    const workerPromise = Worker.workers[jobName](jobId, jobPayload)

    // Run job with timeout to enforce set timeout value.
    if (jobTimeout > 0) {
      const promise = new Promise((resolve, reject) => {
        const timeoutPromise = new Promise((_, rej) => {
          setTimeout(() => {
            rej(new Error(`TIMEOUT: Job id: ${jobId} timed out in ${jobTimeout} ms.`))
          }, jobTimeout)
        })
        try {
          const response = Promise.race([timeoutPromise, workerPromise])
          resolve(response)
        } catch (error) {
          reject(error)
        }
      })
      return promise
    }

    // If no timeout is set, run job normally.
    return workerPromise
  }

  /**
   * Execute an asynchronous job lifecycle callback associated with related worker.
   * @param {string} callback Job lifecycle callback name.
   * @param {string} name Name associated with jobs assigned to related worker.
   * @param {string} id Unique id associated with job.
   * @param {object} payload Data payload associated with job.
   */
  async executeJobLifecycleCallback(
    callbackName: Callbacks,
    jobName: string,
    jobId: string,
    job: Job,
    response?: any,
  ) {
    // Validate callback name
    const validCallbacks = ['onStart', 'onSuccess', 'onFailure', 'onFailed', 'onComplete']

    if (!validCallbacks.includes(callbackName)) {
      throw new Error('Invalid job lifecycle callback name.')
    }

    // Fire job lifecycle callback if set.
    // Uses a try catch statement to gracefully degrade errors in production.
    if (Worker.workers[jobName].options?.[callbackName]) {
      try {
        await Worker.workers[jobName].options?.[callbackName]?.(jobId, job, response)
      } catch (error) {
        console.log('*** Worker - executeJobLifecycleCallback - error:', error)
      }
    }
  }
}

export default Worker
