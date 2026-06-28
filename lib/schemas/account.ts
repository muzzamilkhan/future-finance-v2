import { z } from "zod";

export const updateBalanceInput = z.object({ balance: z.number() });

export type UpdateBalanceInput = z.infer<typeof updateBalanceInput>;
