import { beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
const folder = mkdtempSync(join(tmpdir(), "grant-test-"));
const file = join(folder, "test.db");
process.env.DATABASE_URL = `file:${file}`;
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.APP_URL = "http://localhost:3000";
for (const key of [
  "MAILBOX_PASSWORD",
  "MAILBOX_USER",
  "SMTP_SECURITY",
  "TRACKING_BASE_URL",
  "TRACKING_SYNC_SECRET",
  "MCP_ENABLED",
  "MCP_ACCESS_TOKEN_HASH",
  "MCP_ALLOWED_ORIGINS",
])
  delete process.env[key];
beforeAll(() => {
  const sql = new Database(file);
  for (const migration of readdirSync("prisma/migrations")
    .filter((x) => x !== "migration_lock.toml")
    .sort())
    sql.exec(
      readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"),
    );
  sql.close();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.TRACKING_BASE_URL;
  delete process.env.TRACKING_SYNC_SECRET;
  delete process.env.MCP_ENABLED;
  delete process.env.MCP_ACCESS_TOKEN_HASH;
  delete process.env.MCP_ALLOWED_ORIGINS;
  const sql = new Database(file);
  sql.pragma("foreign_keys = OFF");
  const tables = sql
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  for (const { name } of tables) sql.exec(`DELETE FROM "${name}"`);
  sql.close();
});
afterAll(async () => {
  const { db } = await import("../src/lib/db");
  await db.$disconnect();
  rmSync(folder, { recursive: true, force: true });
});
