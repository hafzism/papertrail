#!/usr/bin/env node
/** Lightweight structural QA for the generated PaperTrail PDF fixture pack. */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "packages/domain/package.json"));
const { PDFDocument } = require("pdf-lib");
const output = resolve(root, "output/pdf/papertrail-fixtures");

const expectedForms = new Map([
  ["01-ordinary-acroform-review-copy.pdf", ["applicant_name", "owner_declaration", "applicant_category"]],
  ["02-malayalam-value-assisted-route.pdf", ["applicant_name", "owner_declaration", "applicant_category"]],
  ["04-signed-marker-assisted.pdf", ["applicant_name", "owner_declaration", "applicant_category"]],
  ["05-xfa-marker-assisted.pdf", ["applicant_name", "owner_declaration", "applicant_category"]],
]);

for (const [filename, expected] of expectedForms) {
  const bytes = await readFile(resolve(output, filename));
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const fields = document.getForm().getFields().map((field) => field.getName());
  if (JSON.stringify(fields) !== JSON.stringify(expected)) throw new Error(`${filename}: unexpected field inventory ${JSON.stringify(fields)}`);
  console.log(`PASS form ${filename}: ${fields.join(", ")}`);
}

for (const filename of ["03-scanned-image-only-notice.pdf", "06-project-showcase-handout.pdf"]) {
  const bytes = await readFile(resolve(output, filename));
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const fields = document.getForm().getFields();
  if (fields.length !== 0) throw new Error(`${filename}: expected no AcroForm fields`);
  console.log(`PASS static ${filename}: ${document.getPageCount()} page(s), no AcroForm fields`);
}

for (const [filename, marker] of [["04-signed-marker-assisted.pdf", "/Sig"], ["05-xfa-marker-assisted.pdf", "/XFA"]]) {
  const text = (await readFile(resolve(output, filename))).toString("latin1");
  if (!text.includes(marker)) throw new Error(`${filename}: marker ${marker} missing`);
  console.log(`PASS safety marker ${filename}: ${marker}`);
}
