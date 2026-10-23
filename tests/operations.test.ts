import { it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { db } from "../src/lib/db";
import { withLease } from "../src/lib/jobs";
import { backupDatabase } from "../scripts/backup";
import { analytics } from "../src/lib/analytics";
import { snapshot } from "../src/lib/data";
import { outbound } from "./helpers";
it("allows only one holder of a background lease", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = vi.fn(async () => {
    await gate;
  });
  const first = withLease("fixture-job", work);
  while (
    !(await db.jobState.findUnique({ where: { id: "fixture-job" } }))?.owner
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(await withLease("fixture-job", work)).toBe(false);
  release();
  await first;
  expect(work).toHaveBeenCalledTimes(1);
});
it("creates a consistent restorable SQLite backup", async () => {
  await outbound();
  const folder = mkdtempSync(join(tmpdir(), "grant-backup-"));
  const file = join(folder, "backup.db");
  try {
    await backupDatabase(file);
    const restored = new Database(file, { readonly: true });
    expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(
      (
        restored.prepare("SELECT count(*) AS n FROM Prospect").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    restored.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
it("returns honest zero metrics and excludes encrypted passwords from browser data", async () => {
  expect((await analytics()).sent).toBe(0);
  expect((await analytics()).replyRate).toBe(0);
  await outbound();
  const result = await snapshot();
  expect(result.settings).not.toHaveProperty("encryptedPassword");
  expect(result.metrics.sent).toBe(1);
  expect(result.metrics.signals).toBe(0);
});
