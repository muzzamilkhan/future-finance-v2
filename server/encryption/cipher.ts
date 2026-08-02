import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level field encryption: AES-256-GCM with a fresh random IV per write.
 *
 * Ciphertext is stored as a versioned envelope so we can rotate the algorithm or key
 * later without a flag day:
 *
 *   encv1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 *
 * Randomized (not deterministic) encryption is safe here because no query in the app
 * filters, sorts, or aggregates on an encrypted column — see docs in CLAUDE.md.
 */

export const ENVELOPE_PREFIX = "encv1:";

const IV_BYTES = 12; // GCM standard
const KEY_BYTES = 32; // AES-256

/** True if `value` has the shape of a v1 envelope (prefix + 3 parts). */
export function isEnvelope(value: string): boolean {
  if (!value.startsWith(ENVELOPE_PREFIX)) return false;
  return value.slice(ENVELOPE_PREFIX.length).split(":").length === 3;
}

export function encryptValue(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypt a stored value. Anything that isn't a well-formed envelope is returned
 * unchanged — that's what lets plaintext rows keep working before (and during) the
 * one-time backfill. A value that *is* a well-formed envelope but fails GCM
 * authentication throws: that means tampering or a wrong key, never a legacy row.
 */
export function decryptValue(stored: string, key: Buffer): string {
  if (!isEnvelope(stored)) return stored;
  assertKey(key);
  const [ivB64, tagB64, ctB64] = stored.slice(ENVELOPE_PREFIX.length).split(":") as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

/**
 * Load the key from DATA_ENCRYPTION_KEY. Accepts 64-char hex or 32-byte base64 —
 * prefer hex when setting it in a hosting dashboard, since base64's `+` and `/` are
 * easy for an env-var pipeline to mangle (that silently yields a short key, which is
 * why the length check below is worth its noise).
 *
 * Returns null when unset so the app still boots un-encrypted in a fresh checkout;
 * `db.ts` decides whether that's acceptable for the current environment.
 */
export function loadKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `DATA_ENCRYPTION_KEY decoded to ${key.length} bytes, expected ${KEY_BYTES}. ` +
      "If it was pasted as base64, the +, / or = characters may have been mangled — " +
      "set the same key as 64-character hex instead.",
    );
  }
  return key;
}
