import { describe, it, expectTypeOf } from "vitest";
import type { EngineAccount, EngineParticular, DailyBalance, DailyEvent } from "./types";

describe("engine types", () => {
  it("EngineParticular carries amount as a number", () => {
    expectTypeOf<EngineParticular["amount"]>().toEqualTypeOf<number>();
  });
  it("DailyBalance carries closingBalance as a number", () => {
    expectTypeOf<DailyBalance["closingBalance"]>().toEqualTypeOf<number>();
  });
});

describe("engine types for credit + transfers", () => {
  it("EngineAccount carries type, anchor, and limit", () => {
    expectTypeOf<EngineAccount>().toMatchTypeOf<{
      id: string; type: "DEBIT" | "CREDIT"; anchorBalance: number; anchorDate: Date; creditLimit: number | null;
    }>();
  });
  it("EngineParticular routes to an account and optional destination", () => {
    expectTypeOf<EngineParticular["accountId"]>().toEqualTypeOf<string>();
    expectTypeOf<EngineParticular["toAccountId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<EngineParticular["type"]>().toEqualTypeOf<"INCOME" | "EXPENSE" | "TRANSFER">();
  });
  it("ForecastInput takes accounts, DailyBalance reports combined + per-account", () => {
    // ForecastInput["accounts"] assertion intentionally omitted — that change lands in Task 4 (forecast.ts)
    expectTypeOf<DailyBalance["combined"]>().toEqualTypeOf<number>();
    expectTypeOf<DailyEvent["fromAccountId"]>().toEqualTypeOf<string>();
    expectTypeOf<DailyEvent["toAccountId"]>().toEqualTypeOf<string | null>();
  });
});
