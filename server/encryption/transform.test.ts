import { describe, it, expect } from "vitest";
import { encryptArgs, encryptData, decryptResult } from "./transform";
import { decryptValue, isEnvelope, encryptValue } from "./cipher";
import { fieldsForModel, normalizeForStorage, ENCRYPTED_FIELDS } from "./fields";

const key = Buffer.alloc(32, 3);
const particularFields = ENCRYPTED_FIELDS.particular!;
const accountFields = ENCRYPTED_FIELDS.financeAccount!;

/** Encrypt then immediately read back, so assertions read as plaintext. */
const plain = (v: unknown) => decryptValue(String(v), key);

describe("encryptData", () => {
  it("encrypts configured fields and leaves others alone", () => {
    const out = encryptData(
      { name: "Rent", amount: 1200, startDate: new Date("2026-01-01"), isFixed: true },
      particularFields, key,
    ) as Record<string, unknown>;

    expect(isEnvelope(out.name as string)).toBe(true);
    expect(plain(out.name)).toBe("Rent");
    expect(plain(out.amount)).toBe("1200.00");
    expect(out.startDate).toBeInstanceOf(Date);
    expect(out.isFixed).toBe(true);
  });

  it("leaves null and absent fields untouched", () => {
    const out = encryptData({ name: "X", category: null }, particularFields, key) as Record<string, unknown>;
    expect(out.category).toBeNull();
    expect("amount" in out).toBe(false);
  });

  it("handles the { set: value } update shorthand", () => {
    const out = encryptData({ amount: { set: 42 } }, particularFields, key) as { amount: { set: string } };
    expect(plain(out.amount.set)).toBe("42.00");
  });

  it("maps over createMany array payloads", () => {
    const out = encryptData([{ amount: 1 }, { amount: 2 }], particularFields, key) as Array<{ amount: string }>;
    expect(out.map((o) => plain(o.amount))).toEqual(["1.00", "2.00"]);
  });

  it("does not mutate the caller's object", () => {
    const input = { amount: 5 };
    encryptData(input, particularFields, key);
    expect(input.amount).toBe(5);
  });
});

describe("encryptArgs", () => {
  it("encrypts data but never where", () => {
    const out = encryptArgs(
      { where: { id: "p1", name: "Rent" }, data: { amount: 10 } },
      particularFields, key,
    ) as { where: { name: string }; data: { amount: string } };

    expect(out.where.name).toBe("Rent");
    expect(plain(out.data.amount)).toBe("10.00");
  });

  it("encrypts both branches of an upsert", () => {
    const out = encryptArgs(
      { create: { amount: 1 }, update: { amount: 2 } },
      particularFields, key,
    ) as { create: { amount: string }; update: { amount: string } };

    expect(plain(out.create.amount)).toBe("1.00");
    expect(plain(out.update.amount)).toBe("2.00");
  });
});

describe("decryptResult", () => {
  it("decrypts envelopes nested in relations and arrays", () => {
    const row = {
      id: "m1",
      account: { name: encryptValue("Everyday", key), currentBalance: encryptValue("50.00", key) },
      particulars: [{ amount: encryptValue("9.99", key), overrides: [{ overriddenAmount: encryptValue("1.00", key) }] }],
    };
    const out = decryptResult(row, key);
    expect(out.account.name).toBe("Everyday");
    expect(out.account.currentBalance).toBe("50.00");
    expect(out.particulars[0]!.amount).toBe("9.99");
    expect(out.particulars[0]!.overrides[0]!.overriddenAmount).toBe("1.00");
  });

  it("passes through plaintext, nulls, dates and numbers", () => {
    const date = new Date("2026-05-01");
    const out = decryptResult({ name: "Rent", n: 3, nothing: null, date }, key);
    expect(out).toEqual({ name: "Rent", n: 3, nothing: null, date });
    expect(out.date).toBeInstanceOf(Date);
  });

  it("survives a count/aggregate scalar result", () => {
    expect(decryptResult(7, key)).toBe(7);
    expect(decryptResult(null, key)).toBeNull();
  });
});

describe("fieldsForModel", () => {
  it("resolves Prisma's model casing", () => {
    expect(fieldsForModel("FinanceAccount")).toBe(accountFields);
    expect(fieldsForModel("financeAccount")).toBe(accountFields);
    expect(fieldsForModel("Holiday")).toBeUndefined();
    expect(fieldsForModel(undefined)).toBeUndefined();
  });
});

describe("normalizeForStorage", () => {
  it("applies the old DECIMAL scale", () => {
    expect(normalizeForStorage(1.236, { type: "decimal", scale: 2 })).toBe("1.24");
    expect(normalizeForStorage(1.234, { type: "decimal", scale: 2 })).toBe("1.23");
    expect(normalizeForStorage(-250, { type: "decimal", scale: 2 })).toBe("-250.00");
    expect(normalizeForStorage(0.1999, { type: "decimal", scale: 4 })).toBe("0.1999");
  });

  it("accepts numeric strings (Prisma Decimal round-trips as a string)", () => {
    expect(normalizeForStorage("1234.5", { type: "decimal", scale: 2 })).toBe("1234.50");
  });

  it("rejects non-numeric input for a decimal field", () => {
    expect(() => normalizeForStorage("abc", { type: "decimal", scale: 2 })).toThrow(/non-numeric/);
  });

  it("stringifies text fields verbatim", () => {
    expect(normalizeForStorage("Rent", { type: "text" })).toBe("Rent");
  });
});
