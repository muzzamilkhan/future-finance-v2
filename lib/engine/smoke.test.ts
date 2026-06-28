import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("engine package", () => {
  it("exposes a version constant", () => {
    expect(ENGINE_VERSION).toBe("v2");
  });
});
