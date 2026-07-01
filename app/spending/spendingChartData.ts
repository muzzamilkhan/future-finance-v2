import type { SpendingSummary } from "@/lib/spending/spending";

export type PieDatum = {
  name: string;
  value: number;
  kind: "category" | "untagged" | "surplus";
};

export function toPieData(summary: SpendingSummary): PieDatum[] {
  const data: PieDatum[] = summary.categories.map((c) => ({
    name: c.name, value: c.monthly, kind: "category",
  }));
  if (summary.untagged > 0) {
    data.push({ name: "Untagged", value: summary.untagged, kind: "untagged" });
  }
  if (summary.surplus > 0) {
    data.push({ name: "Surplus", value: summary.surplus, kind: "surplus" });
  }
  return data;
}
