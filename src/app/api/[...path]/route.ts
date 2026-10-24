import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import {
  authorize,
  login,
  SESSION_COOKIE,
  sessionFromRequest,
} from "@/lib/auth";
import {
  AppError,
  assertOrigin,
  digest,
  encrypt,
  safeError,
} from "@/lib/security";
import { campaignSchema, settingsSchema } from "@/lib/validation";
import { snapshot, prospectHistory } from "@/lib/data";
import {
  exportProspects,
  importCsv,
  previewCsv,
  saveProspect,
} from "@/lib/crm";
import { appSettings, testMailbox } from "@/lib/mailbox";
import { renderContent } from "@/lib/composition";
import { queueSend, saveDraft } from "@/lib/sending";
import { reconcileMessage } from "@/lib/reconcile";
import { trackingConfigured, workerRequest } from "@/lib/tracking";
import { fromZonedTime } from "date-fns-tz";
import { revokeConnection } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_500_000) {
      await reader.cancel();
      throw new AppError(413, "Request too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid JSON.");
  }
}
const ok = (data: unknown) =>
  NextResponse.json(data, { headers: { "cache-control": "no-store" } });
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context) {
  try {
    const { path: parts } = await context.params;
    const path = parts.join("/");
    const method = request.method;
    if (path === "health" && method === "GET") {
      await db.$queryRaw`SELECT 1`;
      await db.appSettings.count();
      return ok({ ok: true });
    }
    if (path === "auth/login" && method === "POST") {
      assertOrigin(request);
      const input = z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(2000),
        })
        .parse(await readJson(request));
      const raw = await login(input.email, input.password);
      const response = ok({ ok: true });
      response.cookies.set(SESSION_COOKIE, raw, {
        httpOnly: true,
        sameSite: "strict",
        secure:
          new URL(process.env.APP_URL || "http://localhost:3000").protocol ===
          "https:",
        path: "/",
        maxAge: 12 * 3600,
      });
      return response;
    }
    const user = await authorize(request);
    if (
      parts[0] === "mcp" &&
      parts[1] === "connections" &&
      parts.length === 3 &&
      method === "DELETE"
    ) {
      await revokeConnection(user.owner.id, parts[2]);
      return ok({ ok: true });
    }
    if (path === "auth/logout" && method === "POST") {
      await db.session.deleteMany({
        where: { id: digest(sessionFromRequest(request)) },
      });
      const response = ok({ ok: true });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    if (path === "session" && method === "GET") return ok(user);
    if (path === "data" && method === "GET")
      return ok(await snapshot(new URL(request.url).searchParams));
    if (path === "recipients" && method === "GET") {
      const q = (new URL(request.url).searchParams.get("q") || "").slice(
        0,
        200,
      );
      return ok(
        await db.prospect.findMany({
          where: {
            OR: [{ fullName: { contains: q } }, { email: { contains: q } }],
          },
          include: { campaign: true },
          orderBy: { fullName: "asc" },
          take: 100,
        }),
      );
    }
    if (path === "prospects" && method === "POST")
      return ok(await saveProspect(await readJson(request)));
    if (parts[0] === "prospects" && parts.length === 2 && method === "PUT")
      return ok(await saveProspect(await readJson(request), parts[1]));
    if (parts[0] === "prospects" && parts.length === 2 && method === "GET")
      return ok(await prospectHistory(parts[1]));
    if (parts[0] === "prospects" && parts.length === 2 && method === "DELETE") {
      z.object({ confirmed: z.literal(true) }).parse(await readJson(request));
      const prospect = await db.prospect.findUniqueOrThrow({
        where: { id: parts[1] },
      });
      await saveProspect(
        { ...prospect, status: "Do Not Contact" },
        prospect.id,
      );
      if (
        await db.sendAttempt.count({
          where: {
            state: "Sending",
            message: { conversation: { prospectId: prospect.id } },
          },
        })
      )
        throw new AppError(
          409,
          "A send is currently in progress. Contact is now suppressed; wait for the outcome before erasing the record.",
        );
      const mappings = await db.remoteToken.findMany({
        where: {
          OR: [
            { prospectId: prospect.id },
            {
              messageId: {
                in: (
                  await db.message.findMany({
                    where: { conversation: { prospectId: prospect.id } },
                    select: { id: true },
                  })
                ).map((x) => x.id),
              },
            },
          ],
        },
      });
      if (mappings.length && !trackingConfigured())
        throw new AppError(
          503,
          "Restore Worker configuration to delete remote tokens and events before erasing this prospect.",
        );
      for (let i = 0; i < mappings.length; i += 20)
        await workerRequest("/admin/delete", {
          hashes: mappings.slice(i, i + 20).map((x) => x.hash),
        });
      await db.$transaction(async (tx) => {
        if (
          await tx.sendAttempt.count({
            where: {
              state: "Sending",
              message: { conversation: { prospectId: prospect.id } },
            },
          })
        )
          throw new AppError(
            409,
            "Wait for the in-progress send to finish before erasing.",
          );
        await tx.remoteToken.deleteMany({
          where: { hash: { in: mappings.map((x) => x.hash) } },
        });
        await tx.message.deleteMany({
          where: { conversation: { prospectId: prospect.id } },
        });
        await tx.prospect.delete({ where: { id: prospect.id } });
        await tx.auditLog.create({
          data: {
            action: "prospect.erased",
            entityId: prospect.id,
            detail: "Minimal suppression retained to prevent recontact.",
          },
        });
      });
      return ok({ ok: true });
    }
    if (path === "csv/preview" && method === "POST") {
      const { content } = z
        .object({ content: z.string().max(2_000_000) })
        .parse(await readJson(request));
      return ok(await previewCsv(content));
    }
    if (path === "csv/import" && method === "POST") {
      const { content, updateExisting } = z
        .object({
          content: z.string().max(2_000_000),
          updateExisting: z.boolean(),
        })
        .parse(await readJson(request));
      return ok(await importCsv(content, updateExisting));
    }
    if (path === "exports/prospects" && method === "GET")
      return new Response(await exportProspects(), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="grant-prospects.csv"',
          "cache-control": "no-store",
        },
      });
    if (path === "campaigns" && method === "POST")
      return ok(
        await db.campaign.create({
          data: campaignSchema.parse(await readJson(request)),
        }),
      );
    if (parts[0] === "campaigns" && parts.length === 2 && method === "PUT")
      return ok(
        await db.campaign.update({
          where: { id: parts[1] },
          data: campaignSchema.parse(await readJson(request)),
        }),
      );
    if (path === "drafts" && method === "POST")
      return ok(await saveDraft(await readJson(request)));
    if (path === "compose/preview" && method === "POST") {
      const { draftId } = z
        .object({ draftId: z.string() })
        .parse(await readJson(request));
      const draft = await db.draft.findUniqueOrThrow({
        where: { id: draftId },
        include: { prospect: true },
      });
      const settings = await appSettings();
      return ok(renderContent(draft, draft.prospect, settings.signature));
    }
    if (path === "send" && method === "POST") {
      const input = z
        .object({
          draftId: z.string(),
          revision: z.number().int().positive(),
          idempotencyKey: z.uuid(),
          confirmed: z.literal(true),
          recentContactConfirmed: z.boolean(),
        })
        .parse(await readJson(request));
      const draft = await db.draft.findUniqueOrThrow({
        where: { id: input.draftId },
        include: { prospect: true },
      });
      const prior = await db.sendAttempt.findFirst({
        where: {
          OR: [
            { idempotencyKey: input.idempotencyKey },
            { draftId: input.draftId, revision: input.revision },
          ],
        },
      });
      if (
        !prior &&
        draft.prospect.lastContacted &&
        draft.prospect.lastContacted.getTime() > Date.now() - 7 * 86400_000 &&
        !input.recentContactConfirmed
      )
        throw new AppError(
          409,
          "Confirm the recent-contact warning before sending.",
        );
      return ok(
        await queueSend(input.draftId, input.revision, input.idempotencyKey),
      );
    }
    if (parts[0] === "operations" && parts.length === 2 && method === "GET")
      return ok(
        await db.sendAttempt.findUniqueOrThrow({ where: { id: parts[1] } }),
      );
    if (
      parts[0] === "messages" &&
      parts[2] === "reconcile" &&
      method === "POST"
    ) {
      await reconcileMessage(parts[1]);
      return ok({ ok: true });
    }
    if (parts[0] === "messages" && parts[2] === "raw" && method === "GET") {
      const message = await db.message.findUniqueOrThrow({
        where: { id: parts[1] },
      });
      if (!message.rawMime)
        throw new AppError(404, "No stored MIME for this message.");
      return new Response(Buffer.from(message.rawMime), {
        headers: {
          "content-type": "message/rfc822",
          "content-disposition": 'attachment; filename="message.eml"',
          "cache-control": "no-store",
        },
      });
    }
    if (parts[0] === "followups" && parts.length === 2 && method === "POST") {
      const input = z
        .object({
          action: z.enum(["snooze", "complete", "not-interested", "stop"]),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .parse(await readJson(request));
      const row = await db.followUp.findUniqueOrThrow({
        where: { id: parts[1] },
        include: { conversation: { include: { prospect: true } } },
      });
      if (row.state !== "Pending")
        throw new AppError(409, "Reminder is no longer pending.");
      if (input.action === "stop" || input.action === "not-interested")
        await saveProspect(
          {
            ...row.conversation.prospect,
            status:
              input.action === "stop" ? "Do Not Contact" : "Not Interested",
          },
          row.conversation.prospectId,
        );
      else {
        const due = input.date
          ? fromZonedTime(
              `${input.date}T09:00:00`,
              (await appSettings()).timezone,
            )
          : null;
        if (
          input.action === "snooze" &&
          (!due || !Number.isFinite(due.getTime()) || due <= new Date())
        )
          throw new AppError(400, "Snooze to a future date.");
        await db.$transaction([
          db.followUp.update({
            where: { id: row.id },
            data:
              input.action === "complete"
                ? { state: "Completed" }
                : { dueAt: due! },
          }),
          db.prospect.update({
            where: { id: row.conversation.prospectId },
            data: { followUpDate: input.action === "complete" ? null : due },
          }),
          db.auditLog.create({
            data: { action: `followup.${input.action}`, entityId: row.id },
          }),
        ]);
      }
      return ok({ ok: true });
    }
    if (path === "settings" && method === "PUT") {
      const { password, ...data } = settingsSchema.parse(
        await readJson(request),
      );
      await db.appSettings.update({
        where: { id: "singleton" },
        data: {
          ...data,
          ...(password ? { encryptedPassword: encrypt(password) } : {}),
          lastSmtpTest: null,
          lastImapTest: null,
        },
      });
      await db.auditLog.create({
        data: {
          action: "settings.updated",
          detail: `Outreach ${data.outreachEnabled ? "enabled" : "test mode"}.`,
        },
      });
      return ok({ ok: true });
    }
    if (path === "mailbox/test" && method === "POST") {
      const { kind } = z
        .object({ kind: z.enum(["smtp", "imap"]) })
        .parse(await readJson(request));
      return ok({ message: await testMailbox(kind) });
    }
    if (path === "sync" && method === "POST") {
      const input = z
        .object({ history: z.boolean().default(false) })
        .parse(await readJson(request));
      const id = input.history ? "history" : "imap";
      await db.jobState.upsert({
        where: { id },
        create: { id, requested: true },
        update: { requested: true },
      });
      return ok({
        message:
          "Synchronization requested. The background runner will process it.",
      });
    }
    throw new AppError(404, "Route not found.");
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        {
          error: error.issues
            .map((x) => `${x.path.join(".")}: ${x.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    const code =
      typeof error === "object" && error && "code" in error ? error.code : "";
    if (code === "P2002")
      return NextResponse.json(
        { error: "A record with these unique identifiers already exists." },
        { status: 409 },
      );
    if (code === "P2025")
      return NextResponse.json({ error: "Record not found." }, { status: 404 });
    return NextResponse.json(
      { error: safeError(error) },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
