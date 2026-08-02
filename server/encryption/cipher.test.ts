import { describe, it, expect } from "vitest";
import { encryptValue, decryptValue, isEnvelope, loadKeyFromEnv, ENVELOPE_PREFIX } from "./cipher";

const key = Buffer.alloc(32, 7);
const otherKey = Buffer.alloc(32, 9);

describe("encryptValue / decryptValue", () => {
  it("round-trips a value", () => {
    expect(decryptValue(encryptValue("1234.56", key), key)).toBe("1234.56");
  });

  it("round-trips unicode and empty strings", () => {
    for (const v of ["", "Café — rent 🏠", "-0.01"]) {
      expect(decryptValue(encryptValue(v, key), key)).toBe(v);
    }
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    expect(encryptValue("500.00", key)).not.toBe(encryptValue("500.00", key));
  });

  it("emits a versioned envelope", () => {
    const c = encryptValue("1", key);
    expect(c.startsWith(ENVELOPE_PREFIX)).toBe(true);
    expect(isEnvelope(c)).toBe(true);
  });

  it("passes plaintext through undecrypted (pre-backfill rows)", () => {
    expect(decryptValue("1234.56", key)).toBe("1234.56");
    expect(decryptValue("Rent", key)).toBe("Rent");
  });

  it("passes through text that merely starts with the prefix but is malformed", () => {
    expect(decryptValue("encv1:not-an-envelope", key)).toBe("encv1:not-an-envelope");
  });

  it("throws on the wrong key rather than returning garbage", () => {
    expect(() => decryptValue(encryptValue("1234.56", key), otherKey)).toThrow();
  });

  it("throws when the ciphertext is tampered with", () => {
    const c = encryptValue("1234.56", key);
    const parts = c.slice(ENVELOPE_PREFIX.length).split(":");
    parts[2] = Buffer.from("9999.99").toString("base64");
    expect(() => decryptValue(ENVELOPE_PREFIX + parts.join(":"), key)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptValue("x", Buffer.alloc(16, 1))).toThrow(/32 bytes/);
  });
});

describe("loadKeyFromEnv", () => {
  it("returns null when unset or blank", () => {
    expect(loadKeyFromEnv({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(loadKeyFromEnv({ DATA_ENCRYPTION_KEY: "  " } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("decodes a 32-byte base64 key", () => {
    const env = { DATA_ENCRYPTION_KEY: key.toString("base64") } as unknown as NodeJS.ProcessEnv;
    expect(loadKeyFromEnv(env)?.equals(key)).toBe(true);
  });

  it("throws on a wrong-length key", () => {
    const env = { DATA_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") } as unknown as NodeJS.ProcessEnv;
    expect(() => loadKeyFromEnv(env)).toThrow(/32 bytes/);
  });
});
