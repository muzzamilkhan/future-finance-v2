import { z } from "zod";

export const updateBalanceInput = z.object({ balance: z.number() });

export type UpdateBalanceInput = z.infer<typeof updateBalanceInput>;

export const createCreditAccountInput = z.object({
  name: z.string().min(1).max(80),
  creditLimit: z.number().positive("Credit limit must be positive"),
  outstanding: z.number().min(0, "Outstanding owed cannot be negative"),
});

export const updateCreditLimitInput = z.object({
  creditLimit: z.number().positive("Credit limit must be positive"),
});

export type CreateCreditAccountInput = z.infer<typeof createCreditAccountInput>;
export type UpdateCreditLimitInput = z.infer<typeof updateCreditLimitInput>;
