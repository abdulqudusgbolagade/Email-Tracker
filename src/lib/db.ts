import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function databasePath(
  url = process.env.DATABASE_URL || "file:./data/grant.db",
) {
  if (!url.startsWith("file:"))
    throw new Error("DATABASE_URL must use file: for SQLite");
  return resolve(url.slice(5));
}
export function createDb(url?: string) {
  const file = databasePath(url);
  mkdirSync(dirname(file), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url: `file:${file}` });
  return new PrismaClient({ adapter, log: [] });
}
const globalDb = globalThis as unknown as { grantDb?: PrismaClient };
export const db = globalDb.grantDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalDb.grantDb = db;
export type DB = PrismaClient;
export async function initializeDatabase(client = db) {
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await client.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
}
export async function retryBusy<T>(work: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await work();
    } catch (error) {
      if (i >= 3 || !/SQLITE_BUSY|database is locked|P2034/.test(String(error)))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 75 * 2 ** i));
    }
  }
}
