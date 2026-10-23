import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { db } from "./db";
import { AppError } from "./security";
import { prospectSchema } from "./validation";

export async function saveProspect(input: unknown, id?: string) {
  const data = prospectSchema.parse(input);
  if (
    data.campaignId &&
    !(await db.campaign.findUnique({ where: { id: data.campaignId } }))
  )
    throw new AppError(400, "Unknown campaign.");
  const duplicate = await db.prospect.findUnique({
    where: { email: data.email },
  });
  if (duplicate && duplicate.id !== id)
    throw new AppError(409, "A prospect with this email already exists.");
  const suppressed = await db.suppression.findUnique({
    where: { email: data.email },
  });
  if (suppressed) data.status = "Do Not Contact";
  return db.$transaction(async (tx) => {
    if (id) {
      const previous = await tx.prospect.findUniqueOrThrow({ where: { id } });
      if (
        (await tx.suppression.findUnique({
          where: { email: previous.email },
        })) &&
        data.email !== previous.email
      )
        throw new AppError(
          409,
          "Suppressed addresses cannot be changed to bypass stop-contact.",
        );
    }
    const old = id
      ? await tx.prospect.findUniqueOrThrow({ where: { id } })
      : null;
    const outcome = {
      ...data,
      ...(data.status === "Won" && old?.status !== "Won"
        ? { wonAt: new Date() }
        : {}),
    };
    const row = id
      ? await tx.prospect.update({ where: { id }, data: outcome })
      : await tx.prospect.create({ data: outcome });
    if (data.status === "Do Not Contact") {
      await tx.suppression.upsert({
        where: { email: data.email },
        create: { email: data.email, reason: "Owner stop-contact" },
        update: {},
      });
    }
    if (
      ["Do Not Contact", "Not Interested", "Lost", "Won"].includes(data.status)
    ) {
      await tx.followUp.updateMany({
        where: { conversation: { prospectId: row.id }, state: "Pending" },
        data: { state: "Cancelled" },
      });
      await tx.prospect.update({
        where: { id: row.id },
        data: { followUpDate: null },
      });
    }
    await tx.auditLog.create({
      data: {
        action: id ? "prospect.updated" : "prospect.created",
        entityId: row.id,
        detail: `Status: ${data.status}`,
      },
    });
    return row;
  });
}
export function inspectCsv(content: string) {
  if (Buffer.byteLength(content) > 2_000_000)
    throw new AppError(413, "CSV must be smaller than 2 MB.");
  let rows: Record<string, string>[];
  try {
    rows = parse(content, {
      columns: true,
      bom: true,
      trim: true,
      skip_empty_lines: true,
      max_record_size: 50000,
    });
  } catch {
    throw new AppError(
      400,
      "Invalid CSV. Check headers, quotes and column counts.",
    );
  }
  if (rows.length > 5000)
    throw new AppError(400, "Import at most 5,000 rows at a time.");
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const parsed = prospectSchema.safeParse({
      ...row,
      campaignId: row.campaignId || null,
    });
    const errors = parsed.success
      ? []
      : parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`);
    if (parsed.success) {
      if (seen.has(parsed.data.email))
        errors.push("Duplicate email within CSV.");
      seen.add(parsed.data.email);
    }
    return {
      row: index + 2,
      data: parsed.success ? parsed.data : null,
      errors,
    };
  });
}
export async function previewCsv(content: string) {
  const rows = inspectCsv(content);
  const existing = await db.prospect.findMany({
    where: {
      email: { in: rows.flatMap((x) => (x.data ? [x.data.email] : [])) },
    },
    select: { email: true },
  });
  const set = new Set(existing.map((x) => x.email));
  const campaigns = new Set(
    (await db.campaign.findMany({ select: { id: true } })).map((x) => x.id),
  );
  for (const row of rows)
    if (row.data?.campaignId && !campaigns.has(row.data.campaignId))
      row.errors.push("campaignId: Unknown campaign.");
  return rows.map((x) => ({
    ...x,
    existing: Boolean(x.data && set.has(x.data.email)),
  }));
}
export async function importCsv(content: string, updateExisting: boolean) {
  const rows = await previewCsv(content);
  if (rows.some((x) => x.errors.length))
    throw new AppError(400, "Fix all CSV errors before importing.");
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.data) continue;
    const existing = await db.prospect.findUnique({
      where: { email: row.data.email },
    });
    if (existing && !updateExisting) {
      skipped++;
      continue;
    }
    await saveProspect(row.data, existing?.id);
    if (existing) updated++;
    else created++;
  }
  return { created, updated, skipped };
}
export function spreadsheetSafe(value: unknown): string {
  const text =
    value == null
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  return /^[\s]*[=+@\-\t\r\n]/.test(text) ? `'${text}` : text;
}
export async function exportProspects() {
  const rows = await db.prospect.findMany({ orderBy: { createdAt: "asc" } });
  const columns = [
    "id",
    "fullName",
    "email",
    "website",
    "bookTitle",
    "bookGenre",
    "country",
    "publishingPlatform",
    "service",
    "leadSource",
    "campaignId",
    "status",
    "notes",
    "lastContacted",
    "lastReply",
    "followUpDate",
    "wonAt",
    "createdAt",
  ] as const;
  return stringify(
    rows.map((row) =>
      Object.fromEntries(columns.map((k) => [k, spreadsheetSafe(row[k])])),
    ),
    { header: true, columns: [...columns] },
  );
}
