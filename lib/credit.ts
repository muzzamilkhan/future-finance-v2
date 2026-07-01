/**
 * Pure credit-account math. A credit account stores its outstanding owed as a
 * NEGATIVE `currentBalance`; available credit is derived from the limit.
 * Kept free of React/Prisma/Next imports.
 */

/** Available credit = limit + stored balance (balance is negative outstanding). May go negative (soft limit). */
export function availableCredit(currentBalance: number, creditLimit: number): number {
  return creditLimit + currentBalance;
}

/** Convert an entered available-credit figure back to the stored balance. Inverse of {@link availableCredit}. */
export function balanceFromAvailable(available: number, creditLimit: number): number {
  return available - creditLimit;
}
