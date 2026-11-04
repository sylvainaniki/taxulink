import { documentOperations } from "../apps/api/src/modules/documents";
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

test("patient files refuse unsupported categories and accept only BT or a mutual-insurance photo", async () => {
  const calls: any[] = [];
  const q = {
    query: async (_sql: string, params?: any[]) => {
      calls.push(JSON.parse(params![0]));
      return { rows: [{ id: "synthetic-document" }] };
    },
  };
  let scans = 0;
  const service = {
    key: "a".repeat(64),
    scan: async () => {
      scans++;
      return "clean" as const;
    },
  };
  const image = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  const body = {
    contact_id: "00000000-0000-4000-8000-000000000001",
    kind: "transport_voucher",
    title: "Fictive BT",
    mime: "image/jpeg",
    content: image.toString("base64"),
    synthetic: true,
  };
  const context: any = {
    path: "/documents",
    method: "POST",
    role: "admin",
    tenant: "synthetic",
    user: "synthetic",
    body,
  };
  for (const kind of [
    "vitale_photo",
    "prescription",
    "rights",
    "insurance",
    "approval",
    "other",
    "clinical_file",
  ]) {
    await assert.rejects(
      documentOperations(q, { ...context, body: { ...body, kind } }, service),
    );
  }
  await assert.rejects(
    documentOperations(
      q,
      {
        ...context,
        body: {
          ...body,
          kind: "mutual_insurance_photo",
          mime: "application/pdf",
        },
      },
      service,
    ),
  );
  assert.equal(scans, 0);
  assert.equal(calls.length, 0);
  for (const kind of ["transport_voucher", "mutual_insurance_photo"]) {
    await documentOperations(
      q,
      { ...context, body: { ...body, kind } },
      service,
    );
    assert.equal(calls.at(-1).kind, kind);
    assert.equal(calls.at(-1).content, undefined);
    assert.ok(calls.at(-1).encrypted_payload);
    assert.equal(calls.at(-1).scan_status, "clean");
  }
});
