export interface Job<T extends object> {
  id: string
  name: string
  payload: T
  metaData: JobMetaData
  priority: number
  active: boolean
  timeout: number
  created: Date
  failed: Date | null
}

export interface RawJob {
  id: string
  name: string
  payload: string
  metaData: string
  priority: number
  active: boolean
  timeout: number
  created: Date
  failed: string | null
}

export interface JobOption {
  // Higher priority jobs (10) get processed before lower priority jobs (-10).
  // Any int will work, priority 1000 will be processed before priority 10, though this is probably overkill.
  // Defaults to 0.
  priority?: number

  // Timeout in ms before job is considered failed.
  // Use this setting to kill off hanging jobs that are clogging up
  // your queue, or ensure your jobs finish in a timely manner if you want
  // to execute jobs in OS background tasks.
  //
  // IMPORTANT: Jobs are required to have a timeout > 0 set in order to be processed
  // by a queue that has been started with a lifespan. As such, if you want to process
  // jobs in an OS background task, you MUST give the jobs a timeout setting.
  //
  // Setting this option to 0 means never timeout.
  //
  // Defaults to 25000.
  timeout?: number

  // Number of times to attempt a failing job before marking job as failed and moving on.
  // Defaults to 1.
  attempts?: number
}

export interface JobMetaData {
  attempts: number
  failedAttempts: number
  errors: string[]
}

export interface JobPayload {
  [key: string]: any // Arbitrary data associated with the job.
}
