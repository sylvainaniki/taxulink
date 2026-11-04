import { createConnection } from "node:net";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import sharp from "sharp";
import { requireThat, Fault } from "./security";
import { validMfaKey } from "./mfa";
export interface DocumentService {
  key: string;
  scan(content: Buffer): Promise<"clean" | "infected">;
}
export function documentsFromEnv(): DocumentService | undefined {
  if (process.env.DEMO_DOCUMENTS_ENABLED !== "true") return;
  requireThat(
    process.env.DEMO_MODE === "true" &&
      process.env.REAL_SENSITIVE_DOCUMENTS_ENABLED !== "true",
    500,
    "DOCUMENTS_DEMO_ONLY",
  );
  requireThat(
    validMfaKey(process.env.DOCUMENT_ENCRYPTION_KEY),
    500,
    "DOCUMENT_KEY_REQUIRED",
  );
  const host = process.env.CLAMAV_HOST || "clamav",
    port = Number(process.env.CLAMAV_PORT || 3310);
  requireThat(
    ["clamav", "localhost", "127.0.0.1"].includes(host) &&
      Number.isInteger(port) &&
      port > 0 &&
      port < 65536,
    500,
    "ANTIVIRUS_LOCAL_REQUIRED",
  );
  return {
    key: process.env.DOCUMENT_ENCRYPTION_KEY!,
    scan: (content) => scanClamAV(content, host, port),
  };
}
export function scanClamAV(
  content: Buffer,
  host: string,
  port: number,
): Promise<"clean" | "infected"> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    const fail = () => {
      socket.destroy();
      reject(new Error("ANTIVIRUS_UNAVAILABLE"));
    };
    socket.setTimeout(10000, fail);
    socket.on("error", fail);
    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0"));
      for (let start = 0; start < content.length; start += 65536) {
        const chunk = content.subarray(start, start + 65536),
          size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 2048) {
        fail();
        return;
      }
      if (response.includes("\0")) {
        socket.destroy();
        if (/: OK\0$/.test(response)) resolve("clean");
        else if (/ FOUND\0$/.test(response)) resolve("infected");
        else reject(new Error("ANTIVIRUS_UNAVAILABLE"));
      }
    });
    socket.on("end", () => {
      if (!response.includes("\0")) fail();
    });
  });
}
export async function sanitizeDocument(content: Buffer, mime: string) {
  requireThat(
    content.length > 0 && content.length <= 1048576,
    413,
    "DOCUMENT_TOO_LARGE",
  );
  try {
    if (mime === "application/pdf") {
      requireThat(
        content.subarray(0, 5).toString() === "%PDF-",
        400,
        "DOCUMENT_MIME_INVALID",
      );
      return await new Promise<Buffer>((resolveResult, reject) => {
        const worker = new Worker(resolve("apps/api/src/document-worker.ts"), {
          workerData: content,
          execArgv: ["--import", "tsx"],
          resourceLimits: { maxOldGenerationSizeMb: 96 },
        });
        const timer = setTimeout(() => {
          void worker.terminate();
          reject(new Fault(400, "DOCUMENT_INVALID"));
        }, 5000);
        worker.once("message", (result) => {
          clearTimeout(timer);
          void worker.terminate();
          if (result?.error) reject(new Fault(400, "DOCUMENT_ACTIVE_CONTENT"));
          else resolveResult(Buffer.from(result));
        });
        worker.once("error", () => {
          clearTimeout(timer);
          reject(new Fault(400, "DOCUMENT_INVALID"));
        });
        worker.once("exit", (code) => {
          if (code !== 0) {
            clearTimeout(timer);
            reject(new Fault(400, "DOCUMENT_INVALID"));
          }
        });
      });
    }
    requireThat(
      mime === "image/png" || mime === "image/jpeg",
      400,
      "DOCUMENT_MIME_INVALID",
    );
    const image = sharp(content, {
      limitInputPixels: 12000000,
      animated: false,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    requireThat(
      metadata.format === (mime === "image/png" ? "png" : "jpeg") &&
        (!metadata.pages || metadata.pages === 1),
      400,
      "DOCUMENT_MIME_INVALID",
    );
    // Re-encoding strips EXIF/GPS and any trailing payload; no metadata is retained.
    const clean = await (
      mime === "image/png"
        ? image.rotate().png()
        : image.rotate().jpeg({ quality: 90 })
    ).toBuffer();
    requireThat(clean.length <= 1048576, 413, "DOCUMENT_TOO_LARGE");
    return clean;
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault(400, "DOCUMENT_INVALID");
  }
}
