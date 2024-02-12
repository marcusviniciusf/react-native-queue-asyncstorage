/**
 * Queue Model
 */

import _ from 'lodash'

// Utils
import {Uuid} from '../utils/uuid'
import promiseReflect from '../utils/promise-reflect'
// Db
import JobDb from '../storage/database'
// Worker
import Worker from './worker'
// Types
import type {Job, JobMetaData, JobOption} from '../types/Job'
import type {WorkerOption, WorkerType} from '../types/Worker'

export class Queue {
  private database: JobDb | null
  private worker: Worker
  private status: string
  private executeFailedJobsOnStart: boolean

  /**
   * Set initial class properties.
   * @constructor
   * @param {boolean} executeFailedJobsOnStart Indicates if previously failed jobs will be executed on start (actually when created new job).
   */
  constructor(executeFailedJobsOnStart = false) {
    this.database = null
    this.worker = new Worker()
    this.status = 'inactive'
    this.executeFailedJobsOnStart = executeFailedJobsOnStart
  }

  /**
   * Initializes the queue by connecting to the database.
   */
  init = async () => {
    if (this.database === null) {
      this.database = new JobDb()
      await this.database.init()
    }
  }

  /**
   * @returns true if the Queue is running and false otherwise
   */
  get isRunning(): boolean {
    return this.status === 'active'
  }

  /**
   * Add a worker to the queue.
   * - Worker will be called to execute jobs associated with `name`.
   * @param {string} name Name associated with jobs assigned to this worker.
   * @param {function} worker The worker function that will execute jobs.
   * @param {object} options Worker options. See README.md for worker options info.
   */
  addWorker<T extends object>(name: string, worker: WorkerType<T>, options: WorkerOption = {}) {
    this.worker.addWorker<T>(name, worker, options)
  }

  /**
   * Delete worker from queue.
   * @param {string} name Name associated with jobs assigned to this worker.
   */
  removeWorker(name: string) {
    this.worker.removeWorker(name)
  }

  /**
   * @returns the workers map (readonly)
   */
  get registeredWorkers() {
    return this.worker.workers
  }

  /**
   * @param job the job which should be requeued
   */
  requeueJob(job: Job) {
    this.database?.update({...job, failed: null})
  }

  /**
   * Creates a new job and adds it to queue.
   * - Queue will automatically start processing unless `start` is set to false. Otherwise `queue.start()`
   * will have to be called manually.
   * @param {string} name Name associated with job.
   * @param {object} payload Object of arbitrary data to be passed into worker function when job executes.
   * @param {object} options Job related options like timeout etc. See README.md for job options info.
   * @param {boolean} start Whether or not to immediately begin processing queue.
   */
  createJob(name: string, payload = {}, options: JobOption = {}, start = true) {
    // // Check if name is supplied.
    if (!name) {
      throw new Error('Job name must be supplied.')
    }

    // If `executeFailedJobsOnStart` is true, reset all `failed` params.
    if (this.executeFailedJobsOnStart) {
      const jobs = this.database?.objects() ?? []

      for (let i = 0; i < jobs.length; i += 1) {
        jobs[i].failed = null
      }

      this.database?.updateAll(jobs)

      this.executeFailedJobsOnStart = false
    }

    // Create and add the new job to the database.

    const timeout = options?.timeout !== undefined && options.timeout >= 0 ? options.timeout : 25000
    const job: Job = {
      id: Uuid.v4(),
      name,
      payload: JSON.stringify(payload),
      metaData: JSON.stringify({
        failedAttempts: 0,
        errors: [],
        attempts: options.attempts || 1,
      }),
      priority: options.priority || 0,
      active: false,
      timeout,
      created: new Date(),
      failed: null,
    }
    this.database?.addJob(job)

    // Start queue.
    if (start && this.status === 'inactive') {
      void this.start()
    }
  }

  /**
   * Start processing the queue.
   * - If queue.start() has already been called, return `false`.
   * - Jobs with timeout set to 0 that run indefinitely will not be processed if the queue is running with a lifespan.
   * @param {number} lifespan If lifespan is passed, the queue will start up and run for lifespan ms, then queue will stop.
   * @return {boolean|undefined} False if queue is already started. Otherwise nothing is returned when queue finishes processing.
   */
  async start(lifespan = 0) {
    // If queue is already running, don't fire up concurrent loop.
    try {
      if (this.status === 'active') {
        return false
      }

      this.status = 'active'

      // Get jobs to process
      const startTime = Date.now()
      let lifespanRemaining = null
      let concurrentJobs = []

      // Get jobs that can be ran during the remaining lifespan.
      if (lifespan !== 0) {
        lifespanRemaining = lifespan - (Date.now() - startTime)
        lifespanRemaining = lifespanRemaining === 0 ? -1 : lifespanRemaining // Handle exactly zero lifespan remaining edge case.
        concurrentJobs = this.getConcurrentJobs(lifespanRemaining)
      } else {
        concurrentJobs = this.getConcurrentJobs()
      }

      while (this.status === 'active' && concurrentJobs.length) {
        // Loop over jobs and process them concurrently.
        const processingJobs = concurrentJobs.map((job) => {
          return this.processJob(job)
        })

        // Promise Reflect ensures all processingJobs resolve so
        // we don't break await early if one of the jobs fails.
        await Promise.all(processingJobs.map(promiseReflect))

        // Get next batch of jobs.
        if (lifespan !== 0) {
          lifespanRemaining = lifespan - (Date.now() - startTime)
          lifespanRemaining = lifespanRemaining === 0 ? -1 : lifespanRemaining // Handle exactly zero lifespan remaining edge case.
          concurrentJobs = this.getConcurrentJobs(lifespanRemaining)
        } else {
          concurrentJobs = this.getConcurrentJobs()
        }
      }
    } catch (error) {
      console.log('*** Error processing queue:', JSON.stringify(error))
      return false
    }

    this.status = 'inactive'
    return true
  }

  /**
   * Stop processing queue.
   * - If queue.stop() is called, queue will stop processing until
   * queue is restarted by either queue.createJob() or queue.start().
   */
  stop() {
    this.status = 'inactive'
  }

  /**
   * Get a collection of all the jobs in the queue.
   * @param {boolean} sync This should be true if you want to guarantee job data is fresh. Otherwise you could receive job data that is not up to date if a write transaction is occuring concurrently.
   * @return {promise} Promise that resolves to a collection of all the jobs in the queue.
   */
  getJobs() {
    return this.database?.objects() ?? []
  }

  removeJob(job: Job) {
    this.database?.delete(job)
  }

  /**
   * Get the next job(s) that should be processed by the queue.
   * - If the next job to be processed by the queue is associated with a
   * worker function that has concurrency X > 1, then X related (jobs with same name)
   * jobs will be returned.
   * - If queue is running with a lifespan, only jobs with timeouts at least 500ms < than REMAINING lifespan
   * AND a set timeout (ie timeout > 0) will be returned. See Queue.start() for more info.
   * @param {number} queueLifespanRemaining The remaining lifespan of the current queue process (defaults to indefinite).
   * @return {promise} Promise resolves to an array of job(s) to be processed next by the queue.
   */
  getConcurrentJobs(queueLifespanRemaining = 0) {
    let concurrentJobs: Job[] = []
    // Get next job from queue.
    let nextJob: Job | null = null

    // Build query string
    const timeoutUpperBound = queueLifespanRemaining - 500 > 0 ? queueLifespanRemaining - 499 : 0 // Only get jobs with timeout at least 500ms < queueLifespanRemaining.

    let jobs = this.database?.objects() ?? []
    jobs = queueLifespanRemaining
      ? jobs.filter(
          (j) => !j.active && j.failed === null && j.timeout > 0 && j.timeout < timeoutUpperBound,
        )
      : jobs.filter((j) => !j.active && j.failed === null)
    jobs = _.orderBy(jobs, ['priority', 'created'], ['asc', 'asc'])
    // NOTE: here and below 'created' is sorted by 'asc' however in original it's 'desc'

    if (jobs.length) {
      nextJob = jobs[0]
    }

    // If next job exists, get concurrent related jobs appropriately.
    if (nextJob) {
      const concurrency = this.worker.getConcurrency(nextJob.name)

      let allRelatedJobs = this.database?.objects() ?? []
      allRelatedJobs = queueLifespanRemaining
        ? allRelatedJobs.filter(
            (j) =>
              j.name === nextJob?.name &&
              !j.active &&
              j.failed === null &&
              j.timeout > 0 &&
              j.timeout < timeoutUpperBound,
          )
        : allRelatedJobs.filter((j) => j.name === nextJob?.name && !j.active && j.failed === null)
      allRelatedJobs = _.orderBy(allRelatedJobs, ['priority', 'created'], ['asc', 'asc'])

      const jobsToMarkActive = allRelatedJobs.slice(0, concurrency)

      // Grab concurrent job ids to reselect jobs as marking these jobs as active will remove
      // them from initial selection when write transaction exits.
      const concurrentJobIds = jobsToMarkActive.map((job) => job.id)

      // Reselect now-active concurrent jobs by id.
      let reselectedJobs = this.database?.objects() ?? []
      reselectedJobs = reselectedJobs.filter((rj) => _.includes(concurrentJobIds, rj.id))
      reselectedJobs = _.orderBy(reselectedJobs, ['priority', 'created'], ['desc', 'asc'])

      concurrentJobs = reselectedJobs.slice(0, concurrency)
    }

    return concurrentJobs
  }

  /**
   * Process a job.
   * - Job lifecycle callbacks are called as appropriate throughout the job processing lifecycle.
   * - Job is deleted upon successful completion.
   * - If job fails execution via timeout or other exception, error will be logged to job.data.errors
   * array and job will be reset to inactive status. Job will be re-attempted up to the specified
   * "attempts" setting (defaults to 1), after which it will be marked as failed and not re-attempted further.
   * @param {object} job Job model object
   */
  async processJob(job: Job) {
    // Data must be cloned off the job object for several lifecycle callbacks to work correctly.
    // This is because job is deleted before some callbacks are called if job processed successfully.
    // More info: https://github.com/billmalarky/react-native-queue/issues/2#issuecomment-361418965
    const jobName = job.name
    const jobId = job.id

    // Fire onStart job lifecycle callback
    this.worker.executeJobLifecycleCallback('onStart', jobName, jobId, job)

    try {
      const response = await this.worker.executeJob(job) // here we catch js/network errors

      // On successful job completion, remove job
      this.database?.delete(job)

      // Job has processed successfully, fire onSuccess and onComplete job lifecycle callbacks.
      this.worker.executeJobLifecycleCallback('onSuccess', jobName, jobId, job, response)
      this.worker.executeJobLifecycleCallback('onComplete', jobName, jobId, job)
    } catch (error) {
      // Handle job failure logic, including retries.
      const jobMetaData = JSON.parse(job?.metaData) as JobMetaData
      const {attempts, errors} = jobMetaData
      let {failedAttempts} = jobMetaData

      // Increment failed attempts number
      failedAttempts++

      // Mark job as failed if too many attempts
      let failed: null | string = null
      if (failedAttempts >= attempts) {
        failed = new Date().toISOString()
      }

      const errorMessage = error instanceof Error ? error.message : (error as string).toString()
      const metaData = JSON.stringify({
        ...jobMetaData,
        errors: [...(errors ?? []), errorMessage],
        failedAttempts,
      })
      const updatedJob = {...job, metaData, failed}

      this.database?.update({...updatedJob, active: false})

      // Execute job onFailure lifecycle callback.
      this.worker.executeJobLifecycleCallback('onFailure', jobName, jobId, updatedJob, error)

      // If job has failed all attempts execute job onFailed and onComplete lifecycle callbacks.
      if (failedAttempts >= attempts) {
        this.worker.executeJobLifecycleCallback('onFailed', jobName, jobId, updatedJob, error)
        this.worker.executeJobLifecycleCallback('onComplete', jobName, jobId, updatedJob)
      }
    }
  }

  /**
   * Delete jobs in the queue.
   * - If `name` is supplied, only jobs associated with that name
   * will be deleted. Otherwise all jobs in queue will be deleted.
   * @param {string} name Name associated with job (and related job worker).
   */
  flushQueue(jobName: string | null = null) {
    if (jobName) {
      let jobs = this.database?.objects() ?? []
      jobs = jobs.filter((j) => j.name === jobName)

      if (jobs.length) {
        // NOTE: might not work
        jobs.forEach((job) => {
          this.database?.delete(job)
        })
      }
    } else {
      this.database?.deleteAll()
    }
  }
}

/**
 * Factory should be used to create a new queue instance.
 * @param {boolean} executeFailedJobsOnStart Indicates if previously failed jobs will be executed on start (actually when created new job).
 * @return {Queue} A queue instance.
 */
async function queueFactory(executeFailedJobsOnStart = false) {
  const queue = new Queue(executeFailedJobsOnStart)
  await queue.init()

  return queue
}

export default queueFactory
