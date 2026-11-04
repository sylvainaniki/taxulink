import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const token = () => randomBytes(32).toString("hex");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, digest] = encoded.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function requireThat(
  value: unknown,
  status: number,
  code: string,
): asserts value {
  if (!value) throw new Fault(status, code);
}
