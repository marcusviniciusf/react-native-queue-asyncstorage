import storage from './storage'
import type {RawJob} from '../types/Job'

const BACKUP_TIME = 7500
const jobKey = '@queue:Job'

export default class Database {
  private database: RawJob[] = []

  /**
   * Initialize database and restore based on backup in storage.
   */
  init = async () => {
    await this._restore()
    this._backup()
  }

  /**
   * Restore database by pulling saved jobs from storage.
   */
  private _restore = async (): Promise<void> => {
    const jobDB = await storage.get<RawJob>(jobKey)
    this.database = jobDB || []
  }

  /**
   * Backup database by saving storage.
   */
  private _backup = (): void => {
    const backupAndSetTimeout = (): void => {
      storage
        .save(jobKey, this.database.slice())
        .then(() => {
          setTimeout(backupAndSetTimeout, BACKUP_TIME)
        })
        .catch((error) => {
          console.error('Error in _backup:', error)
        })
    }

    backupAndSetTimeout()
  }

  /**
   * Add job to database if it doesn't already exist.
   */
  public addJob = (job: RawJob) => {
    const shouldSkip = this.database.some((o) => o.id === job.id)

    // If the job doesn't already exist, add it to the database.
    if (!shouldSkip) {
      this.database.push(job)
    }
  }

  /**
   * Return all jobs saved in the database.
   */
  public objects = (): RawJob[] => this.database.slice()

  /**
   * Update a job already existing in the database.
   */
  public update = (job: RawJob) => {
    const clonnedDb = this.database.slice()
    const index = clonnedDb.findIndex((o) => o.id === job.id)
    if (index !== -1) {
      clonnedDb[index] = job
    } else {
      clonnedDb.push(job)
    }
    this.database = clonnedDb
  }

  /**
   * Update all jobs in the database.
   */
  public updateAll = (jobs: RawJob[]) => {
    this.database = jobs
  }

  /**
   * Delete a job.
   */
  public delete = (job: RawJob) => {
    let clonnedDb = this.database.slice()
    clonnedDb = clonnedDb.filter((o) => o.id !== job.id)
    this.database = clonnedDb
  }

  /**
   * Delete all jobs.
   */
  public deleteAll = () => {
    this.database = []
  }
}
