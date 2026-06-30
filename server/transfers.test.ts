import { describe, it, expect } from "vitest";
import { assertTransferShape } from "./transfers";

const owned = new Set(["debit", "credit"]);

describe("assertTransferShape", () => {
  it("passes a valid transfer between owned accounts", () => {
    expect(() => assertTransferShape({ type: "TRANSFER", accountId: "debit", toAccountId: "credit" }, owned)).not.toThrow();
  });
  it("rejects a transfer to an unowned account", () => {
    expect(() => assertTransferShape({ type: "TRANSFER", accountId: "debit", toAccountId: "other" }, owned)).toThrow();
  });
  it("rejects a transfer to the same account", () => {
    expect(() => assertTransferShape({ type: "TRANSFER", accountId: "debit", toAccountId: "debit" }, owned)).toThrow();
  });
  it("rejects an expense carrying a destination", () => {
    expect(() => assertTransferShape({ type: "EXPENSE", accountId: "debit", toAccountId: "credit" }, owned)).toThrow();
  });
  it("passes a plain expense", () => {
    expect(() => assertTransferShape({ type: "EXPENSE", accountId: "debit", toAccountId: null }, owned)).not.toThrow();
  });
});
