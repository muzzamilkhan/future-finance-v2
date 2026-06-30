import { TRPCError } from "@trpc/server";

export function assertTransferShape(
  input: { type: "INCOME" | "EXPENSE" | "TRANSFER"; accountId: string; toAccountId: string | null | undefined },
  ownedAccountIds: Set<string>,
): void {
  if (input.type === "TRANSFER") {
    if (!input.toAccountId) throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer needs a destination account" });
    if (input.toAccountId === input.accountId) throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer destination must differ from source" });
    if (!ownedAccountIds.has(input.toAccountId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Destination account not found" });
  } else if (input.toAccountId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only transfers may set a destination account" });
  }
}
