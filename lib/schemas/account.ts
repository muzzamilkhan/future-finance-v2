import { z } from "zod";

export const updateBalanceInput = z.object({ balance: z.number() });

export type UpdateBalanceInput = z.infer<typeof updateBalanceInput>;

export const createAccountInput = z.object({
  name: z.string().min(1).max(80),
  initialBalance: z.number().default(0),
});

export type CreateAccountInput = z.infer<typeof createAccountInput>;

export const createCreditAccountInput = z.object({
  name: z.string().min(1).max(80),
  creditLimit: z.number().positive("Credit limit must be positive"),
  outstanding: z.number().min(0, "Outstanding owed cannot be negative"),
});

export const updateAccountInput = z.object({
  name: z.string().min(1).max(80),
  creditLimit: z.number().positive("Credit limit must be positive").optional(),
  balance: z.number().optional(),
});

export type CreateCreditAccountInput = z.infer<typeof createCreditAccountInput>;
export type UpdateAccountInput = z.infer<typeof updateAccountInput>;
