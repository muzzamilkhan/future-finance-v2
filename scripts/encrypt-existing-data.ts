import { config as loadEnv } from "dotenv";
loadEnv();

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma } from "@prisma/client";
import { encryptValue, isEnvelope, loadKeyFromEnv } from "../server/encryption/cipher";
import { ENCRYPTED_FIELDS, normalizeForStorage, type FieldKind } from "../server/encryption/fields";

/**
 * One-time backfill: encrypt rows written before field encryption existed.
 *
 * Deliberately uses an UNextended Prisma client and raw SQL so it sees the true
 * on-disk values — going through the extension would decrypt on read and re-encrypt
 * on write, hiding what's actually stored.
 *
 * Idempotent: values that are already envelopes are skipped, so re-running is safe.
 * Run with `--dry-run` to see the counts without writing.
 */

const DRY_RUN = process.argv.includes("--dry-run");

/** Prisma model name -> table name (this schema has no @@map, so they match). */
const TABLES: Record<string, string> = {
  financeAccount: "FinanceAccount",
  particular: "Particular",
  particularOverride: "ParticularOverride",
  debt: "Debt",
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function encryptTable(table: string, fields: Record<string, FieldKind>, key: Buffer) {
  const columns = Object.keys(fields);
  const select = Prisma.join([Prisma.raw('"id"'), ...columns.map((c) => Prisma.raw(`"${c}"`))]);
  const rows = await prisma.$queryRaw<Array<Record<string, string | null>>>`
    SELECT ${select} FROM ${Prisma.raw(`"${table}"`)}
  `;

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const sets: Prisma.Sql[] = [];
    for (const column of columns) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (isEnvelope(value)) continue; // already encrypted by a previous run
      const ciphertext = encryptValue(normalizeForStorage(value, fields[column]!), key);
      sets.push(Prisma.sql`${Prisma.raw(`"${column}"`)} = ${ciphertext}`);
    }

    if (sets.length === 0) { skipped += 1; continue; }
    if (!DRY_RUN) {
      await prisma.$executeRaw`
        UPDATE ${Prisma.raw(`"${table}"`)} SET ${Prisma.join(sets, ", ")} WHERE "id" = ${row.id}
      `;
    }
    updated += 1;
  }

  console.log(`${table}: ${updated} row(s) encrypted, ${skipped} already done/empty (of ${rows.length})`);
}

async function main() {
  const key = loadKeyFromEnv();
  if (!key) throw new Error("DATA_ENCRYPTION_KEY is not set — add it to .env before backfilling");

  if (DRY_RUN) console.log("DRY RUN — no writes will be made\n");

  for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    const table = TABLES[model];
    if (!table) throw new Error(`No table mapping for model ${model}`);
    await encryptTable(table, fields, key);
  }

  console.log(DRY_RUN ? "\nDry run complete." : "\nBackfill complete.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
