export function pickNextDefault(
  memberships: { accountId: string; isDefault: boolean; closedAt: Date | null }[],
  closingAccountId: string,
): string | null {
  const candidate = memberships.find(
    (m) => m.accountId !== closingAccountId && m.closedAt == null,
  );
  return candidate ? candidate.accountId : null;
}
