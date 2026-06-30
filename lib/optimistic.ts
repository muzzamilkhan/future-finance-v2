export const TEMP_ID_PREFIX = "optimistic-";

export function newTempId(): string {
  return `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX);
}

export function addRow<T extends { id: string }>(rows: readonly T[] | undefined, row: T): T[] {
  return [row, ...(rows ?? [])];
}

export function updateRow<T extends { id: string }>(
  rows: readonly T[] | undefined, id: string, patch: Partial<T>,
): T[] {
  return (rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
}

export function removeRow<T extends { id: string }>(rows: readonly T[] | undefined, id: string): T[] {
  return (rows ?? []).filter((r) => r.id !== id);
}

export function upsertRowBy<T extends { id: string }>(
  rows: readonly T[] | undefined, match: (r: T) => boolean, row: T,
): T[] {
  const list = rows ?? [];
  return list.some(match) ? list.map((r) => (match(r) ? row : r)) : [row, ...list];
}
