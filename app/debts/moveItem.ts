/** Swap the item at `index` with its neighbor in `direction`. Returns a new array,
 *  or the same reference (no-op) when the move would go out of range. */
export function moveItem<T>(items: T[], index: number, direction: "up" | "down"): T[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items;
  }
  const next = items.slice();
  const tmp = next[index]!;
  next[index] = next[target]!;
  next[target] = tmp;
  return next;
}
