import { Badge } from "@/app/_components/ui/badge";
import { accountColorClass } from "./accountColor";

/**
 * Color-coded badge showing an account's name. Color is derived
 * deterministically from the account's position in `orderedIds`.
 */
export function AccountBadge({
  accountId,
  accountNames,
  orderedIds,
}: {
  accountId: string;
  accountNames?: Map<string, string>;
  orderedIds: string[];
}) {
  const name = accountNames?.get(accountId) ?? "?";
  return (
    <Badge className={accountColorClass(accountId, orderedIds)}>{name}</Badge>
  );
}
