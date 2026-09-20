import { hostname } from "node:os";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";
import { PostgresBudgetGateway, WorkerRepository, type SqlExecutor } from "@papertrail/db";
import { DurableWorker, type JobHandler, type WorkerLogger } from "./durable-worker.js";
import { createWorkerStorageClient, ExtractDocumentHandler } from "./extract-document.js";
import { CapturePublicSourceHandler } from "./capture-public-source.js";
import { createProposeRequirementsHandler } from "./propose-requirements.js";
import { PreparePacketManifestHandler } from "./prepare-packet-manifest.js";
import { InspectAcroFormHandler } from "./inspect-acroform.js";
import { PrepareAcroFormDerivativeHandler } from "./prepare-acroform-derivative.js";
import { MonitorPublishedSourceHandler } from "./monitor-published-source.js";
import { DeliverTelegramNotificationHandler } from "./deliver-telegram-notification.js";

loadDotenv({ path: resolve(import.meta.dirname, "../../..", ".env"), quiet: true });

const idleDelayMs = 1_000;
const sourceSweepEveryMs = 60_000;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required to start the worker. Add it to your uncommitted local environment file.");
  return url;
}

function parseSupportedKinds(): string[] {
  const value = process.env.WORKER_ENABLED_KINDS?.trim();
  return value ? value.split(",").map((kind) => kind.trim()).filter(Boolean) : [];
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const logger: WorkerLogger = {
  info(event, fields = {}) {
    console.info(JSON.stringify({ level: "info", event, ...fields }));
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: "error", event, ...fields }));
  },
};

/** No job kind is enabled until it has a real, tested handler. */
class HandlerRegistry implements JobHandler {
  readonly supportedKinds: readonly string[];
  private readonly handlers: ReadonlyMap<string, JobHandler>;

  constructor(handlers: readonly JobHandler[]) {
    const entries = handlers.flatMap((handler) => handler.supportedKinds.map((kind) => [kind, handler] as const));
    if (new Set(entries.map(([kind]) => kind)).size !== entries.length) throw new Error("Worker handler registration has a duplicate job kind.");
    this.handlers = new Map(entries);
    this.supportedKinds = [...this.handlers.keys()].sort();
  }

  async handle(job: Parameters<JobHandler["handle"]>[0]) {
    const handler = this.handlers.get(job.kind);
    if (!handler) throw new Error("Worker claimed an unregistered job kind.");
    return handler.handle(job);
  }
}

async function main(): Promise<void> {
  const workerId = process.env.WORKER_ID?.trim() || `papertrail-${hostname()}-${process.pid}`;
  const sql = postgres(requireDatabaseUrl(), { max: 2, idle_timeout: 20, connect_timeout: 10 });
  const executor: SqlExecutor = {
    async unsafe<T extends readonly object[]>(query: string, parameters: readonly unknown[]): Promise<T> {
      return (await sql.unsafe(query, parameters as never[])) as unknown as T;
    },
  };
  const repository = new WorkerRepository(executor);
  const enabledKinds = parseSupportedKinds();
  const handlers: JobHandler[] = [];
  const requiresStorage = enabledKinds.includes("extract_document") || enabledKinds.includes("capture_public_source") || enabledKinds.includes("prepare_packet_manifest") || enabledKinds.includes("inspect_acroform") || enabledKinds.includes("prepare_filled_acroform");
  const storage = requiresStorage ? createWorkerStorageClient() : null;
  if (enabledKinds.includes("extract_document") && storage) handlers.push(new ExtractDocumentHandler(repository, storage));
  if (enabledKinds.includes("capture_public_source") && storage) handlers.push(new CapturePublicSourceHandler(repository, storage));
  if (enabledKinds.includes("prepare_packet_manifest") && storage) handlers.push(new PreparePacketManifestHandler(repository, storage));
  if (enabledKinds.includes("inspect_acroform") && storage) handlers.push(new InspectAcroFormHandler(repository, storage));
  if (enabledKinds.includes("prepare_filled_acroform") && storage) handlers.push(new PrepareAcroFormDerivativeHandler(repository, storage));
  if (enabledKinds.includes("monitor_published_source")) handlers.push(new MonitorPublishedSourceHandler(repository));
  if (enabledKinds.includes("deliver_telegram_notification")) handlers.push(new DeliverTelegramNotificationHandler(repository));
  if (enabledKinds.includes("propose_private_requirements")) handlers.push(await createProposeRequirementsHandler(repository, new PostgresBudgetGateway(executor)));
  const unknownKinds = enabledKinds.filter((kind) => !handlers.some((handler) => handler.supportedKinds.includes(kind)));
  if (unknownKinds.length > 0) throw new Error(`No tested worker handler is registered for: ${unknownKinds.join(", ")}`);
  const worker = new DurableWorker(
    repository,
    new HandlerRegistry(handlers),
    workerId,
    logger,
  );

  let stopping = false;
  let lastSourceSweepAt = 0;
  const sourceSweepEnabled = enabledKinds.includes("monitor_published_source");
  const sourceCheckIntervalMinutes = parsePositiveInteger(process.env.SOURCE_CHECK_INTERVAL_MINUTES, 60);
  const sourceCheckLimit = Math.min(parsePositiveInteger(process.env.SOURCE_MAX_ACTIVE, 20), 100);
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  logger.info("worker.started", { workerId, enabledKinds: handlers.flatMap((handler) => handler.supportedKinds) });

  while (!stopping) {
    if (sourceSweepEnabled && Date.now() - lastSourceSweepAt >= sourceSweepEveryMs) {
      lastSourceSweepAt = Date.now();
      try {
        const queued = await repository.enqueueDuePublishedSourceChecks(sourceCheckIntervalMinutes, sourceCheckLimit);
        if (queued > 0) logger.info("worker.published_source_sweep", { queued, sourceCheckIntervalMinutes });
      } catch (error) {
        logger.error("worker.published_source_sweep_failed", { message: error instanceof Error ? error.message : "unknown" });
      }
    }
    const processed = await worker.processOne();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
  }
  await sql.end({ timeout: 5 });
  logger.info("worker.stopped", { workerId });
}

void main().catch((error: unknown) => {
  logger.error("worker.start_failed", { message: error instanceof Error ? error.message : "unknown startup failure" });
  process.exitCode = 1;
});
