import { it, expect } from "vitest";
import { db } from "../src/lib/db";
import {
  inspectCsv,
  previewCsv,
  importCsv,
  exportProspects,
  saveProspect,
  spreadsheetSafe,
} from "../src/lib/crm";
import { settingsSchema } from "../src/lib/validation";
import { appSettings } from "../src/lib/mailbox";
import { nextDue, scheduleFollowup } from "../src/lib/followups";
import { outbound } from "./helpers";
it("normalizes email and prevents duplicate or suppression-bypassing records", async () => {
  const p = await saveProspect({
    fullName: "Test",
    email: " Author@Example.TEST ",
  });
  await expect(
    saveProspect({ fullName: "Another", email: "author@example.test" }),
  ).rejects.toThrow("already exists");
  await saveProspect({ ...p, status: "Do Not Contact" }, p.id);
  await saveProspect({ ...p, status: "New" }, p.id);
  expect(
    (await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status,
  ).toBe("Do Not Contact");
  await expect(
    saveProspect({ ...p, email: "other@example.test" }, p.id),
  ).rejects.toThrow("bypass");
});
it("validates CSV row numbers, duplicates, malformed input and import updates", async () => {
  const inspected = inspectCsv(
    "fullName,email\nFirst,owner@example.test\nDuplicate,OWNER@example.test\nInvalid,not-email",
  );
  expect(inspected[1].row).toBe(3);
  expect(inspected[1].errors).toContain("Duplicate email within CSV.");
  expect(inspected[2].errors.length).toBeGreaterThan(0);
  expect(() => inspectCsv('fullName,email\n"unterminated')).toThrow(
    "Invalid CSV",
  );
  expect(
    await importCsv("fullName,email\nFirst,owner@example.test", false),
  ).toEqual({ created: 1, updated: 0, skipped: 0 });
  expect(
    (await previewCsv("fullName,email\nUpdated,owner@example.test"))[0]
      .existing,
  ).toBe(true);
  expect(
    (await importCsv("fullName,email\nUpdated,owner@example.test", false))
      .skipped,
  ).toBe(1);
  expect(
    (await importCsv("fullName,email\nUpdated,owner@example.test", true))
      .updated,
  ).toBe(1);
  expect((await db.prospect.findFirstOrThrow()).fullName).toBe("Updated");
});
it("neutralizes spreadsheet formulas while exporting complete prospect fields", async () => {
  await saveProspect({
    fullName: "=DANGEROUS()",
    email: "owner@example.test",
    notes: "+FORMULA",
  });
  const csv = await exportProspects();
  expect(csv).toContain("'=DANGEROUS()");
  expect(csv).toContain("'+FORMULA");
  expect(csv).toContain("followUpDate");
  expect(spreadsheetSafe(" safe")).toBe(" safe");
});
it("validates SMTP security combinations and timezone settings", async () => {
  const base = { ...(await appSettings()), password: "" };
  expect(
    settingsSchema.safeParse({
      ...base,
      smtpPort: 465,
      smtpSecurity: "STARTTLS",
    }).success,
  ).toBe(false);
  expect(
    settingsSchema.safeParse({
      ...base,
      smtpPort: 587,
      smtpSecurity: "STARTTLS",
    }).success,
  ).toBe(true);
  expect(
    settingsSchema.safeParse({ ...base, timezone: "Invented/Timezone" })
      .success,
  ).toBe(false);
});
it("uses calendar days and 09:00 business time, including DST changes", () => {
  expect(
    nextDue(new Date("2026-01-01T22:00:00Z"), 4, "Africa/Lagos").toISOString(),
  ).toBe("2026-01-05T08:00:00.000Z");
  expect(
    nextDue(
      new Date("2026-03-07T15:00:00Z"),
      1,
      "America/New_York",
    ).toISOString(),
  ).toBe("2026-03-08T13:00:00.000Z");
});
it("maintains one pending reminder and advances configurable intervals after sends", async () => {
  const { conversation } = await outbound();
  await scheduleFollowup(conversation.id, new Date("2026-01-01T12:00:00Z"));
  const first = await db.followUp.findFirstOrThrow({
    where: { state: "Pending" },
  });
  expect(first.step).toBe(0);
  expect(first.dueAt.toISOString()).toBe("2026-01-05T08:00:00.000Z");
  await scheduleFollowup(conversation.id, new Date("2026-01-05T12:00:00Z"));
  const pending = await db.followUp.findMany({ where: { state: "Pending" } });
  expect(pending).toHaveLength(1);
  expect(pending[0].step).toBe(1);
  expect(pending[0].dueAt.toISOString()).toBe("2026-01-12T08:00:00.000Z");
});
it("creates a reminder only once when recovering accepted-send postprocessing", async () => {
  const { conversation, message } = await outbound();
  await scheduleFollowup(conversation.id, new Date(), message.id);
  await scheduleFollowup(conversation.id, new Date(), message.id);
  expect(await db.followUp.count()).toBe(1);
  expect(
    (await db.message.findUniqueOrThrow({ where: { id: message.id } }))
      .followupScheduled,
  ).toBe(true);
});
it("validates campaign references before importing any CSV rows", async () => {
  const csv =
    "fullName,email,campaignId\nValid,valid@example.test,\nInvalid,invalid@example.test,missing-campaign";
  expect((await previewCsv(csv))[1].errors).toContain(
    "campaignId: Unknown campaign.",
  );
  await expect(importCsv(csv, false)).rejects.toThrow("Fix all CSV errors");
  expect(await db.prospect.count()).toBe(0);
});
