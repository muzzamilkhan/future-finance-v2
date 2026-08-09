export function getAmountColorClass(amount: number): string {
  if (amount > 0) return "text-finance-income";
  if (amount < 0) return "text-finance-expense";
  return "text-muted-foreground";
}
export function getAmountBgClass(amount: number): string {
  if (amount > 0) return "bg-finance-income";
  if (amount < 0) return "bg-finance-expense";
  return "bg-muted";
}
export const MIN_TOUCH_TARGET = "44px";
