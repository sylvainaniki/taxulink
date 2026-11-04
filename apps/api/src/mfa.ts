import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { Fault, hash, requireThat } from "./security";
import type { Sql, Row } from "./db";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newSecret() {
  const bytes = randomBytes(20);
  let bits = 0,
    value = 0,
    text = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += alphabet[(value >>> bits) & 31];
    }
  }
  return text;
}
function decode(text: string) {
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const char of text) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_BASE32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret: string, counter: number) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decode(secret)).update(data).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function checkTotp(
  secret: string,
  code: string,
  last: number | null,
  now = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current, current - 1, current + 1]) {
    if (counter < 0 || (last !== null && counter <= last)) continue;
    const expected = totp(secret, counter);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code)))
      return counter;
  }
  return null;
}
export const validMfaKey = (key?: string) =>
  Boolean(key && /^[a-fA-F0-9]{64}$/.test(key));
export function encryptSecret(secret: string, key: string) {
  requireThat(validMfaKey(key), 503, "MFA_UNAVAILABLE");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv),
    data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decryptSecret(payload: string, key?: string) {
  requireThat(validMfaKey(key), 503, "MFA_UNAVAILABLE");
  try {
    const bytes = Buffer.from(payload, "base64"),
      cipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(key!, "hex"),
        bytes.subarray(0, 12),
      );
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Fault(503, "MFA_UNAVAILABLE");
  }
}
export async function consumeFactor(
  q: Sql,
  user: Row,
  code?: string,
  recovery?: string,
  key?: string,
) {
  if (recovery) {
    const normalized = recovery.replace(/-/g, "").toUpperCase(),
      digest = hash(normalized),
      codes: string[] = user.recovery_hashes;
    requireThat(codes.includes(digest), 401, "MFA_INVALID");
    await q.query("UPDATE users SET recovery_hashes=$1 WHERE id=$2", [
      JSON.stringify(codes.filter((c) => c !== digest)),
      user.id,
    ]);
    return;
  }
  requireThat(code, 401, "MFA_REQUIRED");
  const secret = decryptSecret(user.mfa_secret, key),
    counter = checkTotp(
      secret,
      code,
      user.mfa_last_counter === null ? null : Number(user.mfa_last_counter),
    );
  requireThat(counter !== null, 401, "MFA_INVALID");
  await q.query("UPDATE users SET mfa_last_counter=$1 WHERE id=$2", [
    counter,
    user.id,
  ]);
}
export function recoveryCodes() {
  return Array.from({ length: 8 }, () =>
    randomBytes(8)
      .toString("hex")
      .toUpperCase()
      .replace(/^(.{8})(.{8})$/, "$1-$2"),
  );
}
