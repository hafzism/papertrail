import { describe, expect, it, vi } from "vitest";
import { WorkerRepository } from "@papertrail/db";
import { DurableWorker } from "../src/durable-worker.js";
import { imageInputExtension, normalizeExtractedText, parsePdfPageCount } from "../src/extract-document.js";
import { isPublicNetworkAddress, parsePublicHttpsUrl } from "../src/safe-public-fetch.js";

const job = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "extract_document",
  owner_id: "00000000-0000-4000-8000-0000000000a1",
  public_scope: null,
  payload: {},
  fencing_token: 1n,
  lease_expires_at: new Date(),
};

describe("DurableWorker", () => {
  it("normalizes text extraction without changing meaningful spacing", () => {
    expect(normalizeExtractedText("\u0000  Name\r\n\r\n\r\nValue  ")).toBe("Name\n\nValue");
  });

  it("rejects unbounded or missing PDF page metadata", () => {
    expect(parsePdfPageCount("Pages: 2\n")).toBe(2);
    expect(() => parsePdfPageCount("Pages: 51\n")).toThrow("DOCUMENT_PAGE_COUNT_UNAVAILABLE");
  });

  it("accepts only image bytes that match their claimed MIME type", () => {
    expect(imageInputExtension("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(imageInputExtension("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(() => imageInputExtension("image/png", new Uint8Array([0xff, 0xd8, 0xff]))).toThrow("DOCUMENT_CONTENT_UNRECOGNIZED");
  });

  it("does not claim any work when no handler kind is explicitly enabled", async () => {
    const repository = {
      recordHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimNextSupported: vi.fn(),
    };
    const worker = new DurableWorker(repository as never, { supportedKinds: [], handle: vi.fn() }, "worker-a", { info: vi.fn(), error: vi.fn() });

    await expect(worker.processOne()).resolves.toBe(false);
    expect(repository.claimNextSupported).not.toHaveBeenCalled();
  });

  it("finishes a claimed supported job with its fenced token", async () => {
    const repository = {
      recordHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimNextSupported: vi.fn().mockResolvedValue(job),
      heartbeat: vi.fn().mockResolvedValue(true),
      finish: vi.fn().mockResolvedValue(true),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new DurableWorker(
      repository as never,
      { supportedKinds: ["extract_document"], handle: vi.fn().mockResolvedValue({ state: "succeeded" }) },
      "worker-a",
      logger,
    );

    await expect(worker.processOne()).resolves.toBe(true);
    expect(repository.finish).toHaveBeenCalledWith(job.id, job.fencing_token, "succeeded", undefined);
    expect(logger.info).toHaveBeenCalledWith("worker.job_finished", expect.objectContaining({ jobId: job.id }));
  });

  it("records the handler's bounded error code instead of hiding it", async () => {
    const repository = {
      recordHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimNextSupported: vi.fn().mockResolvedValue(job),
      heartbeat: vi.fn().mockResolvedValue(true),
      finish: vi.fn().mockResolvedValue(true),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new DurableWorker(
      repository as never,
      { supportedKinds: ["extract_document"], handle: vi.fn().mockRejectedValue(new Error("DOCUMENT_STORAGE_READ_FAILED")) },
      "worker-a",
      logger,
    );

    await expect(worker.processOne()).resolves.toBe(true);
    expect(repository.finish).toHaveBeenCalledWith(job.id, job.fencing_token, "failed", "DOCUMENT_STORAGE_READ_FAILED");
    expect(logger.error).toHaveBeenCalledWith("worker.job_failed", expect.objectContaining({ errorCode: "DOCUMENT_STORAGE_READ_FAILED" }));
  });

  it("binds extraction metadata as JSON documents rather than JSON strings", async () => {
    const unsafe = vi.fn().mockResolvedValue([{ record_document_extraction: true }]);
    const repository = new WorkerRepository({ unsafe });
    await expect(repository.recordDocumentExtraction({
      ownerId: job.owner_id!,
      documentVersionId: "00000000-0000-4000-8000-000000000002",
      jobId: job.id,
      fencingToken: job.fencing_token,
      deletionGeneration: 0,
      extractorVersion: "pdftotext-1",
      state: "failed",
      uncertaintyFlags: ["DOCUMENT_STORAGE_READ_FAILED"],
      provenance: { parser: "pdftotext-1" },
    })).resolves.toBe(true);
    const [query, parameters] = unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("$11::text::jsonb, $12::text::jsonb");
    expect(parameters[10]).toBe('["DOCUMENT_STORAGE_READ_FAILED"]');
    expect(parameters[11]).toBe('{"parser":"pdftotext-1"}');
  });

  it("persists the final safe-capture URL with its private source result", async () => {
    const unsafe = vi.fn().mockResolvedValue([{ record_public_source_capture: true }]);
    const repository = new WorkerRepository({ unsafe });
    await expect(repository.recordPublicSourceCapture({
      ownerId: job.owner_id!,
      privateSnapshotId: "00000000-0000-4000-8000-000000000003",
      jobId: job.id,
      fencingToken: job.fencing_token,
      deletionGeneration: 0,
      state: "captured",
      finalUrl: "https://example.com/final-notice",
      sourceContentType: "text/html",
      contentSha256: "a".repeat(64),
      textObjectPath: "source-captures/example/source.txt",
      textExcerpt: "Captured source text.",
    })).resolves.toBe(true);
    const [query, parameters] = unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("$12)");
    expect(parameters[6]).toBe("https://example.com/final-notice");
  });

  it("rejects private network targets before public-source retrieval", () => {
    expect(isPublicNetworkAddress("8.8.8.8")).toBe(true);
    expect(isPublicNetworkAddress("127.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("10.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("::1")).toBe(false);
    expect(() => parsePublicHttpsUrl("http://example.com")).toThrow("PUBLIC_SOURCE_INVALID_URL");
    expect(() => parsePublicHttpsUrl("https://127.0.0.1/private")).toThrow("PUBLIC_SOURCE_DISALLOWED_HOST");
    expect(parsePublicHttpsUrl("https://example.com/notices").hostname).toBe("example.com");
  });
});
