import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { databasePath } from "../src/lib/db";
export async function backupDatabase(destination?: string) {
  mkdirSync("backups", { recursive: true, mode: 0o700 });
  const target =
    destination ||
    resolve(
      "backups",
      `grant-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
    );
  const source = new Database(databasePath(), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await source.backup(target);
  } finally {
    source.close();
  }
  return target;
}
if (process.argv[1]?.endsWith("backup.ts"))
  console.log(
    `Backup created: ${await backupDatabase()}. Preserve the encryption key separately and securely.`,
  );
