// Pure helpers for the quick-pick category chip UI. Kept React-free so the
// selection logic is unit-testable without a DOM. `""` is the untagged value.

/** Result of clicking an existing category chip: toggle off if it's the
 *  current selection, otherwise select it. */
export function toggleChip(current: string, clicked: string): string {
  return current === clicked ? "" : clicked;
}

/** Result of submitting the inline "add" field. Trimmed empty input is a
 *  no-op (returns current). Returns the new/selected category otherwise —
 *  the same name whether or not it already exists, so no duplicate is made. */
export function commitNewCategory(current: string, raw: string): string {
  const next = raw.trim();
  return next === "" ? current : next;
}

/** The chip list to render: existing categories plus the current value if it
 *  isn't already among them (e.g. a freshly typed category not yet in the
 *  distinct set). Untagged ("") is never shown as a chip. */
export function chipList(options: readonly string[], current: string): string[] {
  if (current === "" || options.includes(current)) return [...options];
  return [...options, current];
}
