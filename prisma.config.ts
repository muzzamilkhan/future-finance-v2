import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7's CLI does not auto-load .env; load it so DATABASE_URL is available.
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
