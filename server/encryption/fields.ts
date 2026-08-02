/**
 * Which columns are encrypted at rest, and how their plaintext is normalized before
 * encryption. Money columns used to be Postgres DECIMAL, which rounded on write; now
 * that they're TEXT we apply the same scale here so behaviour is unchanged.
 */

export type FieldKind = { type: "text" } | { type: "decimal"; scale: number };

export type FieldMap = Record<string, FieldKind>;

const moneyField: FieldKind = { type: "decimal", scale: 2 };
const textField: FieldKind = { type: "text" };

/** Keyed by Prisma model name as it appears in `$allOperations` (camelCased). */
export const ENCRYPTED_FIELDS: Record<string, FieldMap> = {
  // `categories` is a derived cache of Particular.category (server/categorySync.ts),
  // so it has to be encrypted too — otherwise it leaks exactly what `category` hides.
  financeAccount: { name: textField, currentBalance: moneyField, creditLimit: moneyField, categories: textField },
  particular: { name: textField, category: textField, amount: moneyField },
  particularOverride: { overriddenAmount: moneyField },
  debt: { name: textField, balance: moneyField, apr: { type: "decimal", scale: 4 }, minPayment: moneyField },
};

export function fieldsForModel(model: string | undefined): FieldMap | undefined {
  if (!model) return undefined;
  return ENCRYPTED_FIELDS[model.charAt(0).toLowerCase() + model.slice(1)];
}

/**
 * Coerce a value to the exact string we store. Decimals get a fixed scale so
 * `1.005` at scale 2 stores as "1.01", matching the old DECIMAL(15,2) column.
 */
/**
 * Write helpers for routers. Encrypted money columns are TEXT now, so Prisma's types
 * ask for a string on write; these apply the scale the DECIMAL column used to enforce.
 * (`normalizeForStorage` re-applies it inside the extension — that's an idempotent
 * safety net, not a second rounding.)
 */
export const money = (n: number): string => n.toFixed(2);
export const rate = (n: number): string => n.toFixed(4);

export function normalizeForStorage(value: unknown, kind: FieldKind): string {
  if (kind.type === "text") return String(value);
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) throw new Error(`Cannot store non-numeric value in a decimal field: ${String(value)}`);
  return n.toFixed(kind.scale);
}
