#!/usr/bin/env node
/**
 * Generate the manual PaperTrail showcase and document-intake PDFs.
 * It uses the workspace's existing pdf-lib dependency through the domain
 * package, avoiding an extra production dependency just for fixtures.
 */
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "packages/domain/package.json"));
const {
  PDFDocument,
  StandardFonts,
  rgb,
} = require("pdf-lib");

const output = resolve(root, "output/pdf/papertrail-fixtures");
const sources = resolve(output, "source-images");

const colors = {
  navy: rgb(14 / 255, 43 / 255, 82 / 255),
  ink: rgb(20 / 255, 33 / 255, 61 / 255),
  slate: rgb(82 / 255, 103 / 255, 130 / 255),
  mist: rgb(238 / 255, 244 / 255, 248 / 255),
  teal: rgb(12 / 255, 143 / 255, 134 / 255),
  gold: rgb(200 / 255, 137 / 255, 30 / 255),
  white: rgb(1, 1, 1),
  border: rgb(216 / 255, 225 / 255, 234 / 255),
};

function header(page, bold, title, subtitle) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: colors.navy });
  page.drawText("PAPERTRAIL", { x: 48, y: height - 45, size: 17, font: bold, color: colors.white });
  page.drawText(title, { x: 48, y: height - 128, size: 23, font: bold, color: colors.ink });
  page.drawText(subtitle, { x: 48, y: height - 154, size: 10.5, color: colors.slate });
  page.drawLine({ start: { x: 48, y: height - 176 }, end: { x: width - 48, y: height - 176 }, thickness: 1, color: colors.border });
}

function footer(page, regular, label) {
  const { width } = page.getSize();
  page.drawLine({ start: { x: 48, y: 42 }, end: { x: width - 48, y: 42 }, thickness: 1, color: colors.border });
  page.drawText(`Fictional fixture - ${label}`, { x: 48, y: 25, size: 8.5, font: regular, color: colors.slate });
  page.drawText("Review-only test material", { x: width - 155, y: 25, size: 8.5, font: regular, color: colors.slate });
}

function label(page, bold, text, x, y, required = false) {
  page.drawText(text, { x, y, size: 11, font: bold, color: colors.ink });
  if (required) page.drawText("Required", { x: x + 330, y, size: 8.5, font: bold, color: colors.teal });
}

function help(page, regular, text, x, y) {
  page.drawText(text, { x, y, size: 9, font: regular, color: colors.slate });
}

async function ordinaryForm({ filename, title, subtitle, malayalam = false }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  header(page, bold, title, subtitle);
  const form = doc.getForm();
  let y = 555;
  page.drawRectangle({ x: 48, y: 178, width: 516, height: 364, color: colors.mist, borderColor: colors.border, borderWidth: 1 });
  page.drawText("Demonstration fields", { x: 70, y: 510, size: 15, font: bold, color: colors.ink });
  help(page, regular, "Use owner-confirmed fictional facts only. This source is never modified.", 70, 490);
  if (malayalam) {
    const malayalamText = await doc.embedPng(await readFile(resolve(sources, "02-malayalam-source-text.png")));
    page.drawImage(malayalamText, { x: 70, y: 432, width: 405, height: 54 });
  }
  y = malayalam ? 400 : 450;
  label(page, bold, "Applicant name", 70, y, true);
  const name = form.createTextField("applicant_name");
  name.enableRequired();
  name.addToPage(page, { x: 70, y: y - 34, width: 360, height: 24, borderColor: colors.slate, backgroundColor: colors.white, textColor: colors.ink });
  name.setFontSize(11);
  help(page, regular, malayalam ? "Try a Malayalam owner-confirmed value to verify the assisted boundary." : "Map a harmless text fact such as test.name = Asha Thomas.", 70, y - 51);
  y -= 88;
  label(page, bold, "Owner declaration", 70, y, true);
  const declaration = form.createCheckBox("owner_declaration");
  declaration.addToPage(page, { x: 70, y: y - 25, width: 16, height: 16, borderColor: colors.slate, backgroundColor: colors.white });
  help(page, regular, "I confirm this is fictional data for a review-only demo.", 96, y - 21);
  y -= 68;
  label(page, bold, "Applicant category", 70, y, true);
  const category = form.createDropdown("applicant_category");
  category.addOptions(["general", "student", "researcher"]);
  category.addToPage(page, { x: 70, y: y - 34, width: 250, height: 24, borderColor: colors.slate, backgroundColor: colors.white, textColor: colors.ink });
  category.setFontSize(11);
  help(page, regular, "Choose a compatible text snapshot when mapping the dropdown.", 70, y - 51);
  footer(page, regular, filename);
  await writeFile(resolve(output, filename), await doc.save());
}

async function imageOnlyPdf() {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(await readFile(resolve(sources, "03-scanned-notice-source.png")));
  const page = doc.addPage([612, 842]);
  const ratio = Math.min(540 / png.width, 742 / png.height);
  page.drawImage(png, { x: 36, y: 50, width: png.width * ratio, height: png.height * ratio });
  await writeFile(resolve(output, "03-scanned-image-only-notice.pdf"), await doc.save());
}

async function markedFixture(sourceName, targetName, marker) {
  const source = await readFile(resolve(output, sourceName));
  await writeFile(resolve(output, targetName), Buffer.concat([
    source,
    Buffer.from(`\n% PaperTrail conservative safety fixture\n${marker}\n`, "ascii"),
  ]));
}

async function showcase() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const flow = await doc.embedPng(await readFile(resolve(sources, "project-showcase-flow.png")));

  const first = doc.addPage([612, 792]);
  first.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: colors.navy });
  first.drawText("PAPERTRAIL", { x: 50, y: 690, size: 22, font: bold, color: colors.white });
  first.drawText("Private evidence,", { x: 50, y: 570, size: 37, font: bold, color: colors.white });
  first.drawText("kept review-first.", { x: 50, y: 525, size: 37, font: bold, color: colors.white });
  first.drawText("Hackathon demonstration handout", { x: 52, y: 468, size: 14, font: regular, color: rgb(219 / 255, 231 / 255, 244 / 255) });
  first.drawRectangle({ x: 50, y: 174, width: 512, height: 194, color: rgb(20 / 255, 59 / 255, 103 / 255) });
  const statements = [
    "Private originals stay private.",
    "Owner confirmation is explicit.",
    "Generated PDFs are separate review copies.",
    "No submission or eligibility claim is made.",
  ];
  statements.forEach((statement, index) => {
    first.drawCircle({ x: 82, y: 330 - index * 38, size: 5, color: colors.teal });
    first.drawText(statement, { x: 100, y: 323 - index * 38, size: 13, font: regular, color: colors.white });
  });
  first.drawText("Fictional material - suitable for a safe local demo", { x: 50, y: 62, size: 10, font: regular, color: rgb(180 / 255, 199 / 255, 219 / 255) });

  const second = doc.addPage([612, 792]);
  header(second, bold, "The review-first workflow", "A small, safe tour of the product's decision boundaries");
  second.drawImage(flow, { x: 48, y: 316, width: 516, height: 287 });
  second.drawText("What the demo proves", { x: 48, y: 260, size: 16, font: bold, color: colors.ink });
  const proof = [
    "The owner can inspect and confirm facts without treating them as institution-verified.",
    "An ordinary AcroForm can become an immutable, private review copy only after explicit mapping.",
    "Signed, XFA, static, or non-Latin edge cases remain in an assisted path rather than being altered automatically.",
  ];
  proof.forEach((text, index) => {
    second.drawCircle({ x: 57, y: 225 - index * 50, size: 4, color: colors.gold });
    second.drawText(text, { x: 72, y: 219 - index * 50, size: 9.7, font: regular, color: colors.slate, maxWidth: 470, lineHeight: 13 });
  });
  footer(second, regular, "project-showcase-handout.pdf");

  const third = doc.addPage([612, 792]);
  header(third, bold, "Live demonstration script", "Use the companion fixture pack for a fast, reproducible showcase");
  const rows = [
    ["1", "Upload an ordinary form", "Use 01-ordinary-acroform-review-copy.pdf and inspect its fields."],
    ["2", "Confirm fictional values", "Create harmless profile facts, map compatible values, and select a draft application."],
    ["3", "Prepare review copy", "Start the enabled worker. Verify a separate artifact appears as needs review."],
    ["4", "Show safety boundaries", "Use the image-only, signed-marker, XFA-marker, or Malayalam fixtures to show assisted handling."],
  ];
  rows.forEach(([number, title, detail], index) => {
    const y = 580 - index * 120;
    third.drawRectangle({ x: 48, y: y - 30, width: 516, height: 88, color: colors.mist, borderColor: colors.border, borderWidth: 1 });
    third.drawCircle({ x: 80, y: y + 14, size: 16, color: colors.teal });
    third.drawText(number, { x: 75, y: y + 8, size: 12, font: bold, color: colors.white });
    third.drawText(title, { x: 112, y: y + 22, size: 12, font: bold, color: colors.ink });
    third.drawText(detail, { x: 112, y: y + 2, size: 9.5, font: regular, color: colors.slate, maxWidth: 420, lineHeight: 13 });
  });
  footer(third, regular, "project-showcase-handout.pdf");
  await writeFile(resolve(output, "06-project-showcase-handout.pdf"), await doc.save());
}

await mkdir(sources, { recursive: true });
// The Python companion generator creates source-images before this script runs.
await ordinaryForm({
  filename: "01-ordinary-acroform-review-copy.pdf",
  title: "Private application intake",
  subtitle: "An ordinary English AcroForm fixture for review-copy preparation",
});
await ordinaryForm({
  filename: "02-malayalam-value-assisted-route.pdf",
  title: "Malayalam value boundary",
  subtitle: "An ordinary form that becomes assisted when a non-Latin value is requested",
  malayalam: true,
});
await imageOnlyPdf();
await markedFixture("01-ordinary-acroform-review-copy.pdf", "04-signed-marker-assisted.pdf", "/Sig");
await markedFixture("01-ordinary-acroform-review-copy.pdf", "05-xfa-marker-assisted.pdf", "/XFA");
await showcase();
