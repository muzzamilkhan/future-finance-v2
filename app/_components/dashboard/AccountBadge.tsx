import { Badge } from "@/app/_components/ui/badge";
import { cn } from "@/lib/utils";
import { accountColorClass } from "./accountColor";

/**
 * Color-coded badge showing an account's name. Color is derived
 * deterministically from the account's position in `orderedIds`.
 */
export function AccountBadge({
  accountId,
  accountNames,
  orderedIds,
  className,
}: {
  accountId: string;
  accountNames?: Map<string, string>;
  orderedIds: string[];
  className?: string;
}) {
  const name = accountNames?.get(accountId) ?? "?";
  return (
    <Badge className={cn(accountColorClass(accountId, orderedIds), className)}>{name}</Badge>
  );
}
