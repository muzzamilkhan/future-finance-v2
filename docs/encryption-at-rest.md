# Encrypting user data at rest

A column-by-column audit of `prisma/schema.prisma` against how each column is actually
queried in `server/`. The rule that decides everything: **a column can be encrypted only
if the database never has to compare, sort, range-filter, or uniquely index its value.**
Every encrypted column becomes opaque bytes to Postgres.

## What the threat model actually buys you

The app decrypts with a key held in the app's own env, so this does **not** protect against
app compromise. It protects against: DB backups/dumps leaking, a managed-Postgres provider
or support engineer reading rows, read replicas and log pipelines, and a stolen
`DATABASE_URL`. Disk-level encryption from a hosting provider covers none of those — it only
covers a physically stolen disk. Column encryption is the layer that matters here.

## Tier 1 — encrypt these (high value, zero query dependency)

Verified: none of these appear in any `where`, `orderBy`, `aggregate`, or unique index.

| Model | Columns | Why |
|---|---|---|
| `Particular` | `name`, `category`, `amount` | The whole financial picture — "Rent 2400", "Child support 800". Highest-signal PII in the DB. Fetched by `accountId` + date range only (`server/routers/forecast.ts:33`, `particular.ts:94`). |
| `ParticularOverride` | `overriddenAmount` | Same sensitivity as `amount`. Matched by `(particularId, originalDate)` only. |
| `FinanceAccount` | `name`, `currentBalance`, `creditLimit`, `categories` | Net worth + credit exposure. Only ever read by `id`. |
| `Debt` | `name`, `balance`, `apr`, `minPayment` | Debt load and rates — arguably the most sensitive rows in the schema. Queried by `userId`, ordered by `sortOrder` (not encrypted). |
| `Account` (NextAuth) | `refresh_token`, `access_token`, `id_token` | Not "user data" but the largest blast radius in the table set: live Google OAuth credentials. The adapter reads them by `userId`/`provider`, never by value. Encrypt these first. |

`Particular.category` has one wrinkle: `server/categorySync.ts:12` selects all expense
categories and dedupes them **in application code**, not SQL — so encryption is safe there.
`FinanceAccount.categories` is a derived cache of the same values, so encrypt both or neither.

## Tier 2 — encrypt only with a deterministic scheme or a blind index

These are looked up or constrained **by value**. Randomized AES-GCM breaks them silently
(duplicates slip past unique constraints; lookups return nothing).

| Model | Column | Constraint / lookup | Options |
|---|---|---|---|
| `User` | `email` | `@unique`, and `PrismaAdapter` does `findUnique({ where: { email } })` for account linking | Leave plaintext (recommended), **or** add a `emailHash` blind-index column (`HMAC-SHA256(key, lower(email))`, unique) and encrypt `email` randomized. Do not use deterministic AES for a unique column — it leaks equality across the whole table anyway, so the HMAC index is strictly better. |
| `User` | `name`, `image` | none | Safe to encrypt (Tier 1 in practice). Low sensitivity — Google profile data — so low priority. |
| `Holiday` | `name` | `@@unique([userId, name, source])` | Encrypting randomized **breaks dedupe on Nager re-import** (`server/routers/holiday.ts:30`). Either drop the constraint and dedupe in app code, or add a `nameHash` to the unique tuple. Holiday names are barely sensitive — recommend leaving plaintext. |

## Tier 3 — do NOT encrypt (the engine and the queries depend on them)

- **All date columns**: `Particular.startDate`/`endDate`, `ParticularOverride.originalDate`/
  `overriddenDate`, `Holiday.date`, `User.skipTodayDate`, `FinanceAccount.balanceUpdatedAt`,
  `Session.expires`, `ShareInvite.expiresAt`/`acceptedAt`, all `createdAt`/`updatedAt`.
  Every forecast query range-filters on these (`forecast.ts:37-39`, `:56`) and the composite
  index `@@index([accountId, startDate, endDate])` exists precisely to make that fast.
- **All enums**: `type`, `frequency`, `businessDayAdjustment`, `source`, `role` — filtered on
  directly (`where: { type: "EXPENSE", frequency: { not: "ONCE_OFF" } }`).
- **All booleans**: `isCritical`, `isFixed`, `isSkipped`, `isRecurring`, `isDefault`,
  `canEditItems`, `canEditOverrides`, `canUpdateBalance`. Encrypting a boolean is theatre —
  two distinct ciphertexts, trivially distinguished by frequency.
- **All ids / foreign keys / `sortOrder`** — join keys.
- **`Session.sessionToken`, `ShareInvite.token`, `VerificationToken.token`** — these are
  already high-entropy random secrets looked up by exact value. The correct hardening is
  **hashing** (store `sha256(token)`, compare hashes), not encryption. That requires patching
  the NextAuth adapter for `sessionToken`; `ShareInvite.token` is yours to change freely
  (`server/routers/invite.ts:51,68`) and is the cheaper win of the two.

## Implementation notes

- **Mechanism**: a Prisma 7 client `$extends` query extension in `server/db.ts`, encrypting on
  `create`/`update`/`upsert` and decrypting on every read result. This keeps the routers and
  `lib/engine/` completely unaware — the engine stays pure, as CLAUDE.md requires.
- **Cipher**: AES-256-GCM from `node:crypto`, random 12-byte IV per value, envelope format
  `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url segments). The `keyId` is what makes rotation
  possible later without a big-bang re-encrypt — decrypt against a key ring, encrypt with the
  current key.
- **Schema cost**: encrypted `Decimal` columns must become `String`. That loses
  `@db.Decimal(15, 2)` precision enforcement at the DB level, so the Zod schemas in
  `lib/schemas/` become the only guard — worth a rounding assertion in the extension.
  `Particular.amount` also stops being summable in SQL, which is fine today (nothing sums it
  in SQL) but forecloses that option.
- **Migration**: values must be read, encrypted, and written back in a one-shot script before
  the column type changes — plan a maintenance window, and keep a plaintext backup until it's
  verified.
- **Key loss = data loss.** There is no recovery path. Back the key up outside the host.

## Suggested order of work

1. `Account.refresh_token` / `access_token` / `id_token` — biggest blast radius, no schema change.
2. `Debt.*` and `FinanceAccount` balances — highest sensitivity, small tables.
3. `Particular.name` / `category` / `amount` + `ParticularOverride.overriddenAmount` — largest
   table, needs the `Decimal` → `String` migration.
4. Optional: `ShareInvite.token` hashing, `User.email` blind index.
