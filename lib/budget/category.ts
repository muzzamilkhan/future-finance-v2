export function normalizeCategory(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed === "") return "";
  return collapsed
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function parseCategories(csv: string): string[] {
  const seen = new Map<string, string>(); // lowercase -> display
  for (const part of csv.split(",")) {
    const name = normalizeCategory(part);
    if (name === "") continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function serializeCategories(names: string[]): string {
  return parseCategories(names.join(",")).join(",");
}
