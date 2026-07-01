import { z } from "zod";

export const debtInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  balance: z.number().min(0, "Balance must be zero or more"),
  apr: z.number().min(0, "APR must be zero or more").max(1, "APR is a fraction (0–1)"),
  minPayment: z.number().min(0, "Minimum payment must be zero or more"),
});

export const debtStrategy = z.enum(["SNOWBALL", "AVALANCHE", "CUSTOM"]);

export const simulationParamsSchema = z.object({
  strategy: debtStrategy,
  extraPayment: z.number().min(0, "Extra payment must be zero or more"),
  customOrder: z.array(z.string()).optional(),
});

export type DebtInputSchema = z.infer<typeof debtInputSchema>;
export type SimulationParams = z.infer<typeof simulationParamsSchema>;
