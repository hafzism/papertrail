import type { ClaimedJob, FinishableJobState, WorkerRepository } from "@papertrail/db";

export interface JobHandler {
  readonly supportedKinds: readonly string[];
  handle(job: ClaimedJob): Promise<{ state: FinishableJobState; errorCode?: string }>;
}

export interface WorkerLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export class DurableWorker {
  private readonly supportedKinds: readonly string[];

  constructor(
    private readonly repository: WorkerRepository,
    private readonly handler: JobHandler,
    private readonly workerId: string,
    private readonly logger: WorkerLogger,
    private readonly leaseSeconds = 90,
  ) {
    this.supportedKinds = [...new Set(handler.supportedKinds)].sort();
  }

  async processOne(): Promise<boolean> {
    await this.repository.recordHeartbeat(this.workerId, this.supportedKinds);
    if (this.supportedKinds.length === 0) return false;
    const job = await this.repository.claimNextSupported(this.supportedKinds, this.leaseSeconds);
    if (job === null) return false;

    await this.repository.recordHeartbeat(this.workerId, this.supportedKinds, job.id);
    const heartbeatEveryMs = Math.max(20_000, Math.floor((this.leaseSeconds * 1000) / 3));
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.repository.heartbeat(job.id, job.fencing_token, this.leaseSeconds).then((ok) => {
        if (!ok) leaseLost = true;
      }).catch(() => {
        leaseLost = true;
      });
    }, heartbeatEveryMs);

    try {
      const outcome = await this.handler.handle(job);
      if (leaseLost) {
        this.logger.error("worker.lease_lost", { jobId: job.id, kind: job.kind });
        return true;
      }
      const finished = await this.repository.finish(job.id, job.fencing_token, outcome.state, outcome.errorCode);
      if (!finished) this.logger.error("worker.finish_fence_rejected", { jobId: job.id, kind: job.kind });
      else this.logger.info("worker.job_finished", { jobId: job.id, kind: job.kind, state: outcome.state });
      return true;
    } catch (error) {
      const errorCode = error instanceof Error && error.message ? error.message : "WORKER_HANDLER_FAILURE";
      if (!leaseLost) {
        const finished = await this.repository.finish(job.id, job.fencing_token, "failed", errorCode);
        this.logger.error("worker.job_failed", { jobId: job.id, kind: job.kind, errorCode, finished });
      }
      return true;
    } finally {
      clearInterval(heartbeat);
      await this.repository.recordHeartbeat(this.workerId, this.supportedKinds);
    }
  }
}
