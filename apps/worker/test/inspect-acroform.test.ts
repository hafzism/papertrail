import { describe, expect, it, vi } from "vitest";
import type { ClaimedJob } from "@papertrail/db";

const { inspectAcroForm } = vi.hoisted(() => ({ inspectAcroForm: vi.fn() }));
vi.mock("@papertrail/domain", () => ({ inspectAcroForm }));

import { InspectAcroFormHandler, parseFormInspectionPayload } from "../src/inspect-acroform.js";

const ownerId = "00000000-0000-4000-8000-0000000000a1";
const inspectionId = "10000000-0000-4000-8000-0000000000a1";
const versionId = "20000000-0000-4000-8000-0000000000a1";
const job: ClaimedJob = {
  id: "30000000-0000-4000-8000-0000000000a1",
  kind: "inspect_acroform",
  owner_id: ownerId,
  public_scope: null,
  payload: { inspectionId, documentVersionId: versionId, deletionGeneration: 0 },
  fencing_token: 1n,
  lease_expires_at: new Date(),
};

function storage(download = vi.fn().mockResolvedValue({ data: new Blob(["private pdf"]), error: null })) {
  return { storage: { storage: { from: vi.fn().mockReturnValue({ download }) } }, download };
}

describe("InspectAcroFormHandler", () => {
  it("records ordinary fillable fields through the fenced repository", async () => {
    inspectAcroForm.mockResolvedValueOnce({
      state: "fillable",
      reason: undefined,
      fields: [{ name: "applicant.name", kind: "text", required: true, options: [] }],
    });
    const repository = {
      beginDocumentFormInspection: vi.fn().mockResolvedValue({ object_path: "owner-a/form.pdf" }),
      recordDocumentFormInspection: vi.fn().mockResolvedValue(true),
    };
    const fakeStorage = storage();
    const handler = new InspectAcroFormHandler(repository as never, fakeStorage.storage as never);

    await expect(handler.handle(job)).resolves.toEqual({ state: "succeeded" });
    expect(fakeStorage.download).toHaveBeenCalledWith("owner-a/form.pdf");
    expect(repository.recordDocumentFormInspection).toHaveBeenCalledWith(expect.objectContaining({
      inspectionId,
      ownerId,
      state: "completed",
      formState: "fillable",
      fields: [expect.objectContaining({ name: "applicant.name" })],
    }));
  });

  it("routes signed or unsupported forms to owner input instead of pretending to fill them", async () => {
    inspectAcroForm.mockResolvedValueOnce({ state: "assisted", reason: "FORM_SIGNATURE_PRESENT", fields: [] });
    const repository = {
      beginDocumentFormInspection: vi.fn().mockResolvedValue({ object_path: "owner-a/signed.pdf" }),
      recordDocumentFormInspection: vi.fn().mockResolvedValue(true),
    };
    const handler = new InspectAcroFormHandler(repository as never, storage().storage as never);

    await expect(handler.handle(job)).resolves.toEqual({ state: "awaiting_user", errorCode: "FORM_SIGNATURE_PRESENT" });
    expect(repository.recordDocumentFormInspection).toHaveBeenCalledWith(expect.objectContaining({
      state: "needs_input",
      formState: "assisted",
      reasonCode: "FORM_SIGNATURE_PRESENT",
    }));
  });

  it("validates a narrowly scoped inspection payload before reading private storage", () => {
    expect(parseFormInspectionPayload({ inspectionId, documentVersionId: versionId, deletionGeneration: 0 })).toEqual({ inspectionId, documentVersionId: versionId, deletionGeneration: 0 });
    expect(parseFormInspectionPayload({ inspectionId, documentVersionId: versionId, deletionGeneration: -1 })).toBeNull();
  });
});
