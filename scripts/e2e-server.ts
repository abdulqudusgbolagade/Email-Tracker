import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
const folder = mkdtempSync(join(tmpdir(), "grant-e2e-"));
const file = join(folder, "e2e.db");
process.env.DATABASE_URL = `file:${file}`;
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.APP_URL = "http://localhost:3100";
for (const key of [
  "MAILBOX_USER",
  "MAILBOX_PASSWORD",
  "TRACKING_BASE_URL",
  "TRACKING_SYNC_SECRET",
])
  delete process.env[key];
const sql = new Database(file);
for (const migration of readdirSync("prisma/migrations")
  .filter((x) => x !== "migration_lock.toml")
  .sort())
  sql.exec(
    readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"),
  );
sql.close();
const { db } = await import("../src/lib/db");
const { hashPassword } = await import("../src/lib/auth");
await db.owner.create({
  data: {
    email: "owner@example.test",
    passwordHash: await hashPassword("fixture-owner-password-123"),
  },
});
await db.$disconnect();
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  { stdio: "inherit", env: process.env },
);
function stop() {
  child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  rmSync(folder, { recursive: true, force: true });
  process.exit(code || 0);
});
