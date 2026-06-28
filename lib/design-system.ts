export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
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
export function isStale(date: Date, maxDays = 3): boolean {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  return diffDays > maxDays;
}
export function getRelativeTime(date: Date): string {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
export const MIN_TOUCH_TARGET = "44px";
