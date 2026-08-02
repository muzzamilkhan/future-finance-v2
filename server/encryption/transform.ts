import { encryptValue, decryptValue, isEnvelope } from "./cipher";
import { normalizeForStorage, type FieldMap } from "./fields";

/**
 * Pure arg/result transforms used by the Prisma extension. Kept separate from the
 * extension itself so they're testable without a Prisma client.
 */

/** Encrypt the configured fields in a single `data` payload. Returns a new object. */
export function encryptData(data: unknown, fields: FieldMap, key: Buffer): unknown {
  if (Array.isArray(data)) return data.map((d) => encryptData(d, fields, key));
  if (!isPlainObject(data)) return data;

  const out: Record<string, unknown> = { ...data };
  for (const [field, kind] of Object.entries(fields)) {
    if (!(field in out)) continue;
    const raw = out[field];
    if (raw === null || raw === undefined) continue;

    // Prisma allows `{ set: value }` as an update shorthand.
    if (isPlainObject(raw) && "set" in raw) {
      const inner = (raw as { set: unknown }).set;
      out[field] = inner === null || inner === undefined
        ? raw
        : { set: encryptValue(normalizeForStorage(inner, kind), key) };
      continue;
    }
    out[field] = encryptValue(normalizeForStorage(raw, kind), key);
  }
  return out;
}

/**
 * Encrypt every write payload in a Prisma operation's args (`data`, plus `create` /
 * `update` for upsert). `where` is deliberately untouched — randomized ciphertext
 * can't be matched, and nothing in this app queries by an encrypted column.
 */
export function encryptArgs(args: unknown, fields: FieldMap, key: Buffer): unknown {
  if (!isPlainObject(args)) return args;
  const out: Record<string, unknown> = { ...args };
  for (const slot of ["data", "create", "update"] as const) {
    if (slot in out && out[slot] !== undefined) out[slot] = encryptData(out[slot], fields, key);
  }
  return out;
}

/**
 * Walk a query result and decrypt anything that looks like an envelope, at any depth.
 * Being model-agnostic here means nested `include`s (memberships → account,
 * particulars → overrides) are handled without threading relation metadata through.
 */
export function decryptResult<T>(value: T, key: Buffer): T {
  if (typeof value === "string") {
    return (isEnvelope(value) ? decryptValue(value, key) : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => decryptResult(v, key)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = decryptResult(v, key);
    return out as T;
  }
  return value;
}

/** Only step into ordinary objects — never Date, Buffer, Decimal, or class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
