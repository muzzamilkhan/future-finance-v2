import { describe, it, expect } from "vitest";
import { addRow, updateRow, removeRow, upsertRowBy, newTempId, isTempId } from "./optimistic";

type Row = { id: string; name: string; n?: number };
const rows: Row[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

describe("optimistic list transforms", () => {
  it("addRow prepends", () => {
    expect(addRow(rows, { id: "c", name: "C" })).toEqual([
      { id: "c", name: "C" }, { id: "a", name: "A" }, { id: "b", name: "B" },
    ]);
  });

  it("addRow tolerates undefined", () => {
    expect(addRow(undefined, { id: "c", name: "C" })).toEqual([{ id: "c", name: "C" }]);
  });

  it("updateRow shallow-merges the matching row only", () => {
    expect(updateRow(rows, "b", { name: "B2", n: 5 })).toEqual([
      { id: "a", name: "A" }, { id: "b", name: "B2", n: 5 },
    ]);
  });

  it("updateRow on undefined returns []", () => {
    expect(updateRow(undefined, "b", { name: "x" })).toEqual([]);
  });

  it("removeRow filters the matching id", () => {
    expect(removeRow(rows, "a")).toEqual([{ id: "b", name: "B" }]);
  });

  it("upsertRowBy replaces first match", () => {
    expect(upsertRowBy(rows, (r) => r.id === "a", { id: "a", name: "A2" })).toEqual([
      { id: "a", name: "A2" }, { id: "b", name: "B" },
    ]);
  });

  it("upsertRowBy prepends when no match", () => {
    expect(upsertRowBy(rows, (r) => r.id === "z", { id: "z", name: "Z" })).toEqual([
      { id: "z", name: "Z" }, { id: "a", name: "A" }, { id: "b", name: "B" },
    ]);
  });

  it("newTempId is prefixed and detected by isTempId", () => {
    const id = newTempId();
    expect(id.startsWith("optimistic-")).toBe(true);
    expect(isTempId(id)).toBe(true);
    expect(isTempId("real-id")).toBe(false);
  });
});
