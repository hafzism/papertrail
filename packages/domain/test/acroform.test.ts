import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { fillAcroForm, inspectAcroForm, verifyAcroFormValues } from "../src/acroform.js";

async function createSimpleForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([500, 500]);
  const form = document.getForm();
  form.createTextField("applicant_name").addToPage(page, { x: 50, y: 400, width: 220, height: 26 });
  form.createCheckBox("declaration").addToPage(page, { x: 50, y: 350, width: 18, height: 18 });
  const category = form.createDropdown("category");
  category.addOptions(["general", "student"]);
  category.addToPage(page, { x: 50, y: 300, width: 220, height: 26 });
  return document.save();
}

describe("AcroForm handling", () => {
  it("inspects and fills a real interactive PDF without flattening it", async () => {
    const source = await createSimpleForm();
    await expect(inspectAcroForm(source)).resolves.toMatchObject({
      state: "fillable",
      fields: [
        { name: "applicant_name", kind: "text" },
        { name: "declaration", kind: "checkbox" },
        { name: "category", kind: "dropdown", options: ["general", "student"] },
      ],
    });
    const result = await fillAcroForm(source, [
      { fieldName: "applicant_name", value: "Asha Thomas" },
      { fieldName: "declaration", value: true },
      { fieldName: "category", value: "student" },
    ]);
    expect(result).toMatchObject({ state: "filled", modifiedFields: ["applicant_name", "declaration", "category"] });
    if (result.state !== "filled") throw new Error("Expected filled result");
    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getForm().getTextField("applicant_name").getText()).toBe("Asha Thomas");
    expect(reopened.getForm().getCheckBox("declaration").isChecked()).toBe(true);
    expect(reopened.getForm().getDropdown("category").getSelected()).toEqual(["student"]);
    await expect(verifyAcroFormValues(result.bytes, [
      { fieldName: "applicant_name", value: "Asha Thomas" },
      { fieldName: "declaration", value: true },
      { fieldName: "category", value: "student" },
    ])).resolves.toBe(true);
    await expect(verifyAcroFormValues(result.bytes, [{ fieldName: "applicant_name", value: "Different person" }])).resolves.toBe(false);
  });

  it("routes non-Latin text and XFA-marked forms to an honest assisted path", async () => {
    const source = await createSimpleForm();
    await expect(fillAcroForm(source, [{ fieldName: "applicant_name", value: "അനു" }])).resolves.toEqual({
      state: "assisted", reason: "PDF_FORM_NON_LATIN_ASSISTED_ROUTE",
    });
    const marked = new Uint8Array([...source, ...new TextEncoder().encode("\n/XFA\n")]);
    await expect(inspectAcroForm(marked)).resolves.toMatchObject({ state: "assisted", reason: "PDF_FORM_XFA" });
  });
});
