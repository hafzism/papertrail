import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";

export type AcroFormFieldKind = "text" | "checkbox" | "dropdown" | "option_list" | "radio" | "unsupported";

export interface AcroFormInspection {
  state: "fillable" | "assisted";
  reason?: "PDF_FORM_NOT_FOUND" | "PDF_FORM_SIGNED" | "PDF_FORM_XFA" | "PDF_FORM_UNSUPPORTED_FIELD";
  fields: readonly { name: string; kind: AcroFormFieldKind; required: boolean; options: readonly string[] }[];
}

export interface AcroFormValue {
  fieldName: string;
  value: string | boolean;
}

export type AcroFormFillResult =
  | { state: "filled"; bytes: Uint8Array; modifiedFields: readonly string[] }
  | { state: "assisted"; reason: "PDF_FORM_NOT_FOUND" | "PDF_FORM_SIGNED" | "PDF_FORM_XFA" | "PDF_FORM_UNSUPPORTED_FIELD" | "PDF_FORM_NON_LATIN_ASSISTED_ROUTE" };

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const needle = new TextEncoder().encode(value);
  outer: for (let start = 0; start <= bytes.length - needle.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

function fieldKind(field: unknown): AcroFormFieldKind {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "option_list";
  if (field instanceof PDFRadioGroup) return "radio";
  return "unsupported";
}

function fieldOptions(field: unknown): readonly string[] {
  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) return field.getOptions();
  return [];
}

function rawSafetyReason(bytes: Uint8Array): AcroFormInspection["reason"] | undefined {
  // These markers are deliberately conservative: a signed or XFA form must use
  // an assisted route rather than risking an invalidated signature or bad output.
  if (containsAscii(bytes, "/XFA")) return "PDF_FORM_XFA";
  if (containsAscii(bytes, "/Sig")) return "PDF_FORM_SIGNED";
  return undefined;
}

export async function inspectAcroForm(bytes: Uint8Array): Promise<AcroFormInspection> {
  const safetyReason = rawSafetyReason(bytes);
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const fields = document.getForm().getFields().map((field) => ({
    name: field.getName(),
    kind: fieldKind(field),
    required: field.isRequired(),
    options: fieldOptions(field),
  }));
  if (safetyReason) return { state: "assisted", reason: safetyReason, fields };
  if (fields.length === 0) return { state: "assisted", reason: "PDF_FORM_NOT_FOUND", fields };
  if (fields.some((field) => field.kind === "unsupported")) return { state: "assisted", reason: "PDF_FORM_UNSUPPORTED_FIELD", fields };
  return { state: "fillable", fields };
}

function needsNonLatinRoute(values: readonly AcroFormValue[]): boolean {
  return values.some((item) => typeof item.value === "string" && /[^\u0000-\u007f]/.test(item.value));
}

/**
 * Fills a normal, unsigned AcroForm while keeping it interactive. Static/XFA,
 * signed, and non-Latin text are deliberately returned for the assisted route.
 */
export async function fillAcroForm(bytes: Uint8Array, values: readonly AcroFormValue[]): Promise<AcroFormFillResult> {
  const inspection = await inspectAcroForm(bytes);
  if (inspection.state === "assisted") return { state: "assisted", reason: inspection.reason! };
  if (needsNonLatinRoute(values)) return { state: "assisted", reason: "PDF_FORM_NON_LATIN_ASSISTED_ROUTE" };

  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const form = document.getForm();
  const fields = new Map(form.getFields().map((field) => [field.getName(), field]));
  const modifiedFields: string[] = [];
  for (const item of values) {
    const field = fields.get(item.fieldName);
    if (!field) throw new Error("PDF_FORM_FIELD_NOT_FOUND");
    if (field instanceof PDFTextField && typeof item.value === "string") field.setText(item.value);
    else if (field instanceof PDFCheckBox && typeof item.value === "boolean") item.value ? field.check() : field.uncheck();
    else if (field instanceof PDFDropdown && typeof item.value === "string") field.select(item.value);
    else if (field instanceof PDFOptionList && typeof item.value === "string") field.select(item.value);
    else if (field instanceof PDFRadioGroup && typeof item.value === "string") field.select(item.value);
    else throw new Error("PDF_FORM_VALUE_TYPE_INVALID");
    modifiedFields.push(item.fieldName);
  }
  form.updateFieldAppearances(await document.embedFont(StandardFonts.Helvetica));
  return { state: "filled", bytes: await document.save(), modifiedFields };
}

/** Verifies canonical form values after reopening a derivative; rendering alone is insufficient. */
export async function verifyAcroFormValues(bytes: Uint8Array, values: readonly AcroFormValue[]): Promise<boolean> {
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const fields = new Map(document.getForm().getFields().map((field) => [field.getName(), field]));
  return values.every((item) => {
    const field = fields.get(item.fieldName);
    if (field instanceof PDFTextField && typeof item.value === "string") return field.getText() === item.value;
    if (field instanceof PDFCheckBox && typeof item.value === "boolean") return field.isChecked() === item.value;
    if (field instanceof PDFDropdown && typeof item.value === "string") return field.getSelected().includes(item.value);
    if (field instanceof PDFOptionList && typeof item.value === "string") return field.getSelected().includes(item.value);
    if (field instanceof PDFRadioGroup && typeof item.value === "string") return field.getSelected() === item.value;
    return false;
  });
}
