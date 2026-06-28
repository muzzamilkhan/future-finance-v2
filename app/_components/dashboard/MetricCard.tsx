import { Card, CardContent, CardHeader, CardTitle } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";

export function MetricCard(
  { title, value, subtitle, type }:
  { title: string; value: number; subtitle?: string; type: "income" | "expense" | "warning" },
) {
  const color = type === "income" ? "text-finance-income" : type === "expense" ? "text-finance-expense" : "text-finance-warning";
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color}`}>{formatCurrency(value)}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </CardContent>
    </Card>
  );
}
