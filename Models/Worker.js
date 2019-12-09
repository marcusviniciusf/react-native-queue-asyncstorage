/**
 * Worker Model
 */

export default class Worker {
  /**
   * Singleton map of all worker functions assigned to queue.
   */
  static workers = {}

  /**
   * Assign a worker function to the queue.
   * - Worker will be called to execute jobs associated with `name`.
   * @param {string} name Name associated with jobs assigned to this worker.
   * @param {function} worker The worker function that will execute jobs.
   * @param {object} options Worker options. See README.md for worker options info.
   */
  addWorker(name, worker, options = {}) {
    // Validate input.
    if (!name || !worker) {
      throw new Error("Job name and associated worker function must be supplied.")
    }

    // Attach options to worker
    worker.options = {
      concurrency: options.concurrency || 1,
      onStart: options.onStart || null,
      onSuccess: options.onSuccess || null,
      onFailure: options.onFailure || null,
      onFailed: options.onFailed || null,
      onComplete: options.onComplete || null,
    }

    Worker.workers[name] = worker
  }

  /**
   * Un-assign worker function from queue.
   * @param {string} name Name associated with jobs assigned to this worker.
   */
  removeWorker(name) {
    delete Worker.workers[name]
  }

  /**
   * Get the concurrency setting for a worker.
   * - Worker concurrency defaults to 1.
   * @param {string} name Name associated with jobs assigned to this worker.
   * @throws Throws error if no worker is currently assigned to passed in job name.
   * @return {number}
   */
  getConcurrency(name) {
    // If no worker assigned to job name, throw error.
    if (!Worker.workers[name]) {
      throw new Error(`Job ${name} does not have a worker assigned to it.`)
    }

    return Worker.workers[name].options.concurrency
  }

  /**
   * Execute the worker function assigned to the passed in job name.
   * - If job has a timeout setting, job will fail with a timeout exception upon reaching timeout.
   * @param {object} job Job to execute.
   * @throws Throws error if no worker is currently assigned to passed in job name.
   */
  async executeJob(job) {
    // If no worker assigned to job name, throw error.
    if (!Worker.workers[job.name]) {
      throw new Error(`Job ${job.name} does not have a worker assigned to it.`)
    }

    const id = job.id
    const name = job.name
    const timeout = job.timeout
    const payload = JSON.parse(job.payload)

    // Run job with timeout to enforce set timeout value.
    if (timeout > 0) {
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`TIMEOUT: Job id: ${id} timed out in ${timeout}ms.`))
        }, timeout)
      })

      return Promise.race([timeoutPromise, Worker.workers[name](id, payload)])
    }

    // If no timeout is set, run job normally.
    return Worker.workers[name](id, payload)
  }

  /**
   * Execute an asynchronous job lifecycle callback associated with related worker.
   * @param {string} callback Job lifecycle callback name.
   * @param {string} name Name associated with jobs assigned to related worker.
   * @param {string} id Unique id associated with job.
   * @param {object} payload Data payload associated with job.
   */
  async executeJobLifecycleCallback(callback, name, id, payload, error) {
    // Validate callback name
    const validCallbacks = ["onStart", "onSuccess", "onFailure", "onFailed", "onComplete"]

    if (!validCallbacks.includes(callback)) {
      throw new Error("Invalid job lifecycle callback name.")
    }

    // Fire job lifecycle callback if set.
    // Uses a try catch statement to gracefully degrade errors in production.
    if (Worker.workers[name].options[callback]) {
      try {
        await Worker.workers[name].options[callback](id, payload, error)
      } catch (error) {
        console.log("*** Worker - executeJobLifecycleCallback - error:", error)
      }
    }
  }
}
