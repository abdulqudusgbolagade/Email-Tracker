import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolve } from "node:path";
const databaseUrl = process.env.DATABASE_URL || "file:./data/grant.db";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: `file:${resolve(databaseUrl.slice(5)).replaceAll("\\", "/")}`,
  },
});
