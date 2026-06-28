import { describe, it, expectTypeOf } from "vitest";
import type { EngineParticular, DailyBalance } from "./types";

describe("engine types", () => {
  it("EngineParticular carries amount as a number", () => {
    expectTypeOf<EngineParticular["amount"]>().toEqualTypeOf<number>();
  });
  it("DailyBalance carries closingBalance as a number", () => {
    expectTypeOf<DailyBalance["closingBalance"]>().toEqualTypeOf<number>();
  });
});
