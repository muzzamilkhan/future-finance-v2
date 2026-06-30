// Pure helpers for the category combo box. Kept React-free so the selection
// logic is unit-testable without a DOM. `""` is the untagged value.

/** Existing categories whose name contains the (trimmed, case-insensitive)
 *  query as a substring. An empty query returns every option. */
export function filterCategories(options: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...options];
  return options.filter((name) => name.toLowerCase().includes(q));
}

/** The name to offer as a "Create …" option, or null when none applies:
 *  empty query, or a query that already matches an existing option exactly
 *  (case-insensitive) — picking that is selection, not creation. */
export function creatableCategory(options: readonly string[], query: string): string | null {
  const next = query.trim();
  if (next === "") return null;
  const exists = options.some((name) => name.toLowerCase() === next.toLowerCase());
  return exists ? null : next;
}
