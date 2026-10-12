import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * Derives the 32-byte AES key from CLAUDIO_SECRET_KEY. Any string works; a
 * random 32+ character value is expected (`openssl rand -base64 32`).
 */
export function secretKey(raw: string | undefined = process.env.CLAUDIO_SECRET_KEY): Buffer {
  if (!raw || raw.length < 16) throw new Error("CLAUDIO_SECRET_KEY is not set (min. 16 characters)");
  return createHash("sha256").update(raw).digest();
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encrypt(plain: string, key: Buffer = secretKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string, key: Buffer = secretKey()): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
