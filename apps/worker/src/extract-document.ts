import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedJob, FinishableJobState, WorkerRepository } from "@papertrail/db";
import type { JobHandler } from "./durable-worker.js";

const run = promisify(execFile);
const textExtractorVersion = "pdftotext-1";
const ocrExtractorVersion = "tesseract-1";
const maxExtractedCharacters = 2_000_000;
const maxExcerptCharacters = 8_000;

const imageInputExtensions: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface ExtractDocumentPayload {
  documentVersionId: string;
  deletionGeneration: number;
}

function parsePayload(value: unknown): ExtractDocumentPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<ExtractDocumentPayload>;
  if (typeof payload.documentVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.documentVersionId)) return null;
  if (typeof payload.deletionGeneration !== "number" || !Number.isInteger(payload.deletionGeneration) || payload.deletionGeneration < 0) return null;
  return { documentVersionId: payload.documentVersionId, deletionGeneration: payload.deletionGeneration };
}

export function normalizeExtractedText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parsePdfPageCount(output: string): number {
  const match = /^Pages:\s+(\d+)\s*$/m.exec(output);
  const pageCount = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 50) throw new Error("DOCUMENT_PAGE_COUNT_UNAVAILABLE");
  return pageCount;
}

export function imageInputExtension(mimeType: string, bytes: Uint8Array): string {
  const extension = imageInputExtensions[mimeType];
  if (!extension) throw new Error("DOCUMENT_UNSUPPORTED_MIME");
  const matchesSignature = (mimeType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (mimeType === "image/png" && bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    || (mimeType === "image/webp" && bytes.length >= 12
      && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
      && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP");
  if (!matchesSignature) throw new Error("DOCUMENT_CONTENT_UNRECOGNIZED");
  return extension;
}

async function runOcr(inputPath: string, outputPath: string): Promise<string> {
  const language = process.env.OCR_LANGUAGES?.trim() || "eng";
  try {
    await run("tesseract", [inputPath, outputPath, "-l", language], { timeout: 45_000, maxBuffer: maxExtractedCharacters * 2 });
    const text = normalizeExtractedText(await readFile(`${outputPath}.txt`, "utf8"));
    if (!text) throw new Error("DOCUMENT_OCR_TEXT_UNAVAILABLE");
    return text;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error("DOCUMENT_OCR_NOT_CONFIGURED");
    if (error instanceof Error && error.message === "DOCUMENT_OCR_TEXT_UNAVAILABLE") throw error;
    throw new Error("DOCUMENT_OCR_FAILED");
  }
}

async function extractPdfText(pdfBytes: Uint8Array): Promise<{ text: string; pageCount: number; extractorVersion: string }> {
  if (pdfBytes.byteLength < 5 || new TextDecoder().decode(pdfBytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("DOCUMENT_CONTENT_UNRECOGNIZED");
  }
  const directory = await mkdtemp(join(tmpdir(), "papertrail-extract-"));
  const inputPath = join(directory, "input.pdf");
  const outputPath = join(directory, "output.txt");
  try {
    await writeFile(inputPath, pdfBytes, { mode: 0o600 });
    const { stdout: pdfInfo } = await run("pdfinfo", [inputPath], { timeout: 15_000, maxBuffer: 50_000 });
    const pageCount = parsePdfPageCount(pdfInfo);
    await run("pdftotext", ["-layout", "-nopgbrk", inputPath, outputPath], { timeout: 30_000, maxBuffer: maxExtractedCharacters * 2 });
    const embeddedText = normalizeExtractedText(await readFile(outputPath, "utf8"));
    if (embeddedText) return { text: embeddedText, pageCount, extractorVersion: textExtractorVersion };

    const renderPrefix = join(directory, "ocr-page");
    try {
      await run("pdftoppm", ["-f", "1", "-l", String(pageCount), "-r", "200", "-png", inputPath, renderPrefix], {
        timeout: 60_000,
        maxBuffer: 50_000,
      });
      const pageTexts: string[] = [];
      for (let page = 1; page <= pageCount; page += 1) {
        const imagePath = `${renderPrefix}-${page}.png`;
        const pageOutputPath = join(directory, `ocr-page-${page}`);
        pageTexts.push(await runOcr(imagePath, pageOutputPath));
      }
      const ocrText = normalizeExtractedText(pageTexts.join("\n\n"));
      if (!ocrText) throw new Error("DOCUMENT_OCR_TEXT_UNAVAILABLE");
      return { text: ocrText, pageCount, extractorVersion: ocrExtractorVersion };
    } catch (error) {
      if (error instanceof Error && error.message === "DOCUMENT_OCR_TEXT_UNAVAILABLE") throw error;
      if (error instanceof Error && error.message === "DOCUMENT_OCR_NOT_CONFIGURED") throw error;
      throw new Error("DOCUMENT_OCR_FAILED");
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 2 });
  }
}

async function extractImageText(imageBytes: Uint8Array, mimeType: string): Promise<{ text: string; pageCount: number; extractorVersion: string }> {
  const extension = imageInputExtension(mimeType, imageBytes);
  const directory = await mkdtemp(join(tmpdir(), "papertrail-image-"));
  const inputPath = join(directory, `input.${extension}`);
  const outputPath = join(directory, "output");
  try {
    await writeFile(inputPath, imageBytes, { mode: 0o600 });
    const text = await runOcr(inputPath, outputPath);
    return { text, pageCount: 1, extractorVersion: ocrExtractorVersion };
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 2 });
  }
}

export class ExtractDocumentHandler implements JobHandler {
  readonly supportedKinds = ["extract_document"] as const;

  constructor(
    private readonly repository: WorkerRepository,
    private readonly storage: SupabaseClient,
  ) {}

  async handle(job: ClaimedJob): Promise<{ state: FinishableJobState; errorCode?: string }> {
    const payload = parsePayload(job.payload);
    if (job.owner_id === null || payload === null) return { state: "failed", errorCode: "DOCUMENT_EXTRACTION_INVALID_JOB_PAYLOAD" };
    const document = await this.repository.beginDocumentExtraction(job, payload.documentVersionId, payload.deletionGeneration);
    if (document === null) return { state: "outcome_unknown", errorCode: "DOCUMENT_EXTRACTION_FENCE_REJECTED" };

    const { data, error } = await this.storage.storage.from("private-documents").download(document.object_path);
    if (error || data === null) {
      const recorded = await this.repository.recordDocumentExtraction({
        ownerId: job.owner_id,
        documentVersionId: payload.documentVersionId,
        jobId: job.id,
        fencingToken: job.fencing_token,
        deletionGeneration: payload.deletionGeneration,
        extractorVersion: textExtractorVersion,
        state: "failed",
        uncertaintyFlags: ["DOCUMENT_STORAGE_READ_FAILED"],
        provenance: { parser: textExtractorVersion, sourceMimeType: document.mime_type },
      });
      return recorded ? { state: "failed", errorCode: "DOCUMENT_STORAGE_READ_FAILED" } : { state: "outcome_unknown", errorCode: "DOCUMENT_EXTRACTION_FENCE_REJECTED" };
    }

    try {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const extracted = document.mime_type === "application/pdf"
        ? await extractPdfText(bytes)
        : await extractImageText(bytes, document.mime_type);
      const { text } = extracted;
      if (text.length > maxExtractedCharacters) throw new Error("DOCUMENT_TEXT_LIMIT_EXCEEDED");

      const textObjectPath = `extractions/${payload.documentVersionId}/${extracted.extractorVersion}.txt`;
      const { error: uploadError } = await this.storage.storage.from("private-artifacts").upload(textObjectPath, text, {
        contentType: "text/plain; charset=utf-8",
        upsert: false,
      });
      if (uploadError) throw new Error("DOCUMENT_EXTRACTION_ARTIFACT_WRITE_FAILED");

      const recorded = await this.repository.recordDocumentExtraction({
        ownerId: job.owner_id,
        documentVersionId: payload.documentVersionId,
        jobId: job.id,
        fencingToken: job.fencing_token,
        deletionGeneration: payload.deletionGeneration,
        extractorVersion: extracted.extractorVersion,
        state: "completed",
        textObjectPath,
        textExcerpt: text.slice(0, maxExcerptCharacters),
        pageCount: extracted.pageCount,
        uncertaintyFlags: [],
        provenance: { parser: extracted.extractorVersion, sourceMimeType: document.mime_type, originalFilename: document.original_filename },
      });
      return recorded ? { state: "succeeded" } : { state: "outcome_unknown", errorCode: "DOCUMENT_EXTRACTION_FENCE_REJECTED" };
    } catch (error) {
      const code = error instanceof Error ? error.message : "DOCUMENT_EXTRACTION_FAILED";
      const needsInput = code === "DOCUMENT_CONTENT_UNRECOGNIZED"
        || code === "DOCUMENT_TEXT_LIMIT_EXCEEDED"
        || code === "DOCUMENT_OCR_NOT_CONFIGURED"
        || code === "DOCUMENT_OCR_TEXT_UNAVAILABLE"
        || code === "DOCUMENT_OCR_FAILED";
      const recorded = await this.repository.recordDocumentExtraction({
        ownerId: job.owner_id,
        documentVersionId: payload.documentVersionId,
        jobId: job.id,
        fencingToken: job.fencing_token,
        deletionGeneration: payload.deletionGeneration,
        extractorVersion: textExtractorVersion,
        state: needsInput ? "needs_input" : "failed",
        uncertaintyFlags: [code],
        provenance: { parser: textExtractorVersion, sourceMimeType: document.mime_type },
      });
      if (!recorded) return { state: "outcome_unknown", errorCode: "DOCUMENT_EXTRACTION_FENCE_REJECTED" };
      return needsInput ? { state: "awaiting_user", errorCode: code } : { state: "failed", errorCode: code };
    }
  }
}

export function createWorkerStorageClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for document extraction.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
