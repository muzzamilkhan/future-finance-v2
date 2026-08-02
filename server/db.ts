import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadKeyFromEnv } from "./encryption/cipher";
import { encryptionExtension } from "./encryption/extension";

// Prisma 7 requires an explicit driver adapter to open a connection.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

function createClient() {
  const base = new PrismaClient({ adapter, log: ["error", "warn"] });
  const key = loadKeyFromEnv();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATA_ENCRYPTION_KEY is required in production (base64, 32 bytes)");
    }
    console.warn("[db] DATA_ENCRYPTION_KEY unset — running without field encryption");
    return base as unknown as ReturnType<typeof extend>;
  }
  return extend(base, key);
}

function extend(base: PrismaClient, key: Buffer) {
  return base.$extends(encryptionExtension(key));
}

type Client = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
