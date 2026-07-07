import { describe, it, expect } from "vitest";
import { moveItem } from "./moveItem";

describe("moveItem", () => {
  it("moves a middle item up", () => {
    expect(moveItem(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
  });

  it("moves a middle item down", () => {
    expect(moveItem(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
  });

  it("is a no-op moving the first item up", () => {
    const input = ["a", "b", "c"];
    expect(moveItem(input, 0, "up")).toBe(input);
  });

  it("is a no-op moving the last item down", () => {
    const input = ["a", "b", "c"];
    expect(moveItem(input, 2, "down")).toBe(input);
  });

  it("is a no-op for an out-of-range index", () => {
    const input = ["a", "b", "c"];
    expect(moveItem(input, 5, "up")).toBe(input);
    expect(moveItem(input, -1, "down")).toBe(input);
  });

  it("is a no-op for a single-element array", () => {
    const input = ["a"];
    expect(moveItem(input, 0, "up")).toBe(input);
    expect(moveItem(input, 0, "down")).toBe(input);
  });

  it("does not mutate the input on a real move", () => {
    const input = ["a", "b", "c"];
    const out = moveItem(input, 1, "up");
    expect(input).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(input);
  });
});
