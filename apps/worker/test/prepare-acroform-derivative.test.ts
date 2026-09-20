import { describe, expect, it, vi } from "vitest";
import type { ClaimedJob } from "@papertrail/db";

const { fillAcroForm, verifyAcroFormValues } = vi.hoisted(() => ({ fillAcroForm: vi.fn(), verifyAcroFormValues: vi.fn() }));
vi.mock("@papertrail/domain", () => ({ fillAcroForm, verifyAcroFormValues }));

import { PrepareAcroFormDerivativeHandler, parseAcroFormDerivativePayload } from "../src/prepare-acroform-derivative.js";

const ownerId = "00000000-0000-4000-8000-0000000000a1";
const runId = "10000000-0000-4000-8000-0000000000a1";
const applicationId = "20000000-0000-4000-8000-0000000000a1";
const inspectionId = "30000000-0000-4000-8000-0000000000a1";
const job: ClaimedJob = {
  id: "40000000-0000-4000-8000-0000000000a1", kind: "prepare_filled_acroform", owner_id: ownerId, public_scope: null,
  payload: { artifactRunId: runId, applicationId, inspectionId, deletionGeneration: 0 }, fencing_token: 1n, lease_expires_at: new Date(),
};

function storage() {
  const download = vi.fn().mockResolvedValue({ data: new Blob(["private pdf"]), error: null });
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  return { storage: { storage: { from: vi.fn().mockReturnValue({ download, upload, remove }) } }, download, upload, remove };
}

describe("PrepareAcroFormDerivativeHandler", () => {
  it("writes a separately stored, verified review copy through the fenced repository", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    fillAcroForm.mockResolvedValueOnce({ state: "filled", bytes, modifiedFields: ["applicant.name"] });
    verifyAcroFormValues.mockResolvedValueOnce(true);
    const repository = {
      beginPrivateAcroFormDerivative: vi.fn().mockResolvedValue({
        state: "ready", object_path: "owner-a/original.pdf", input_version_vector: { inspection: { id: inspectionId } }, field_values: { "applicant.name": "Asha" },
      }),
      recordPrivateAcroFormDerivative: vi.fn().mockResolvedValue(true),
    };
    const fakeStorage = storage();
    const handler = new PrepareAcroFormDerivativeHandler(repository as never, fakeStorage.storage as never, vi.fn().mockResolvedValue(true));

    await expect(handler.handle(job)).resolves.toEqual({ state: "succeeded" });
    expect(fillAcroForm).toHaveBeenCalledWith(expect.any(Uint8Array), [{ fieldName: "applicant.name", value: "Asha" }]);
    expect(fakeStorage.upload).toHaveBeenCalledWith(`filled-acroforms/${runId}/review-copy.pdf`, bytes, expect.objectContaining({ contentType: "application/pdf" }));
    expect(repository.recordPrivateAcroFormDerivative).toHaveBeenCalledWith(expect.objectContaining({ artifactRunId: runId, renderCheckStatus: "passed" }));
  });

  it("does not read or write bytes when the owner-controlled input changed", async () => {
    const repository = { beginPrivateAcroFormDerivative: vi.fn().mockResolvedValue({ state: "input_changed" }) };
    const fakeStorage = storage();
    const handler = new PrepareAcroFormDerivativeHandler(repository as never, fakeStorage.storage as never, vi.fn());
    await expect(handler.handle(job)).resolves.toEqual({ state: "awaiting_user", errorCode: "ACROFORM_DERIVATIVE_INPUT_CHANGED" });
    expect(fakeStorage.download).not.toHaveBeenCalled();
  });

  it("routes a signed, XFA, or non-Latin safety result to owner attention", async () => {
    fillAcroForm.mockResolvedValueOnce({ state: "assisted", reason: "PDF_FORM_NON_LATIN_ASSISTED_ROUTE" });
    const repository = {
      beginPrivateAcroFormDerivative: vi.fn().mockResolvedValue({ state: "ready", object_path: "owner-a/original.pdf", input_version_vector: {}, field_values: { "applicant.name": "Asha" } }),
      failPrivateAcroFormDerivative: vi.fn().mockResolvedValue(true),
    };
    const handler = new PrepareAcroFormDerivativeHandler(repository as never, storage().storage as never, vi.fn());
    await expect(handler.handle(job)).resolves.toEqual({ state: "failed", errorCode: "PDF_FORM_NON_LATIN_ASSISTED_ROUTE" });
  });

  it("accepts only a narrowly scoped job payload", () => {
    expect(parseAcroFormDerivativePayload({ artifactRunId: runId, applicationId, inspectionId, deletionGeneration: 0 })).toEqual({ artifactRunId: runId, applicationId, inspectionId, deletionGeneration: 0 });
    expect(parseAcroFormDerivativePayload({ artifactRunId: runId, applicationId, inspectionId, deletionGeneration: -1 })).toBeNull();
  });
});
