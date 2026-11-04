import { parentPort, workerData } from "node:worker_threads";
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFStream } from "pdf-lib";
async function main() {
  const pdf = await PDFDocument.load(workerData, {
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 50)
    throw new Error("INVALID");
  const seen = new Set<unknown>(),
    forbidden = new Set([
      "JS",
      "JavaScript",
      "OpenAction",
      "AA",
      "Launch",
      "EmbeddedFiles",
      "RichMedia",
      "XFA",
      "AcroForm",
    ]);
  function visit(object: any) {
    if (seen.has(object)) return;
    seen.add(object);
    if (seen.size > 100000) throw new Error("LIMIT");
    if (object instanceof PDFName && forbidden.has(object.decodeText()))
      throw new Error("ACTIVE");
    if (object instanceof PDFDict)
      for (const [key, value] of object.entries()) {
        visit(key);
        visit(value);
      }
    if (object instanceof PDFArray)
      for (const value of object.asArray()) visit(value);
    if (object instanceof PDFStream) visit(object.dict);
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects())
    visit(object);
  pdf.setTitle("Document fictif TAXILINK");
  pdf.setAuthor("");
  pdf.setSubject("");
  pdf.setKeywords([]);
  pdf.setCreator("TAXILINK");
  pdf.setProducer("TAXILINK");
  parentPort!.postMessage(await pdf.save({ useObjectStreams: false }));
}
main().catch(() => parentPort!.postMessage({ error: true }));
