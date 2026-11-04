import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { sanitizeDocument } from "../apps/api/src/documents";

test("document staging sanitizes image metadata and refuses MIME spoofing and oversized payloads", async () => {
  const source = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "white" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "Synthetic private metadata" } } })
    .toBuffer();
  const clean = await sanitizeDocument(source, "image/jpeg");
  assert.equal((await sharp(clean).metadata()).exif, undefined);
  await assert.rejects(
    sanitizeDocument(source, "image/png"),
    /DOCUMENT_MIME_INVALID/,
  );
  await assert.rejects(
    sanitizeDocument(Buffer.alloc(1048577), "image/png"),
    /DOCUMENT_TOO_LARGE/,
  );
});

test("document staging accepts a plain PDF and refuses active JavaScript content", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const clean = await sanitizeDocument(
    Buffer.from(await pdf.save()),
    "application/pdf",
  );
  assert.equal((await PDFDocument.load(clean)).getPageCount(), 1);
  pdf.catalog.set(
    PDFName.of("OpenAction"),
    pdf.context.obj({
      S: PDFName.of("JavaScript"),
      JS: PDFString.of("synthetic()"),
    }),
  );
  await assert.rejects(
    sanitizeDocument(Buffer.from(await pdf.save()), "application/pdf"),
    /DOCUMENT_ACTIVE_CONTENT/,
  );
});
