import type {RawJob} from './Job'

export interface WorkerOptions {
  // Set max number of jobs for this worker to process concurrently.
  // Defaults to 1.
  concurrency?: number

  // JOB LIFECYCLE CALLBACKS

  // onStart job callback handler is fired when a job begins processing.
  //
  // IMPORTANT: Job lifecycle callbacks are executed asynchronously and do not block job processing
  // (even if the callback returns a promise it will not be "awaited" on).
  // As such, do not place any logic in onStart that your actual job worker function will depend on,
  // this type of logic should of course go inside the job worker function itself.
  onStart?: (id: string, job: RawJob) => Promise<void>

  // onSuccess job callback handler is fired after a job successfully completes processing.
  onSuccess?: (id: string, job: RawJob, response: any) => Promise<void>

  // onFailure job callback handler is fired after each time a job fails (onFailed also fires if job has reached max number of attempts).
  onFailure?: (id: string, job: RawJob, error: any) => Promise<void>

  // onFailed job callback handler is fired if job fails enough times to reach max number of attempts.
  onFailed?: (id: string, job: RawJob, error: any) => Promise<void>

  // onComplete job callback handler fires after job has completed processing successfully or failed entirely.
  onComplete?: (id: string, job: RawJob) => Promise<void>
}

export type WorkerType<T extends object> = ((jobId: string, payload: T) => void) & {
  options: WorkerOptions
}
