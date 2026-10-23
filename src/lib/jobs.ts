import { randomUUID } from "node:crypto";
import { db } from "./db";
import { safeError } from "./security";
import { syncInbox } from "./sync";
import { executeSend } from "./sending";
import { syncTracking } from "./tracking";
import { scheduleFollowup } from "./followups";
import { saveSentCopy } from "./mailbox";

export async function withLease(id: string, work: () => Promise<void>) {
  await db.jobState.upsert({ where: { id }, create: { id }, update: {} });
  const owner = randomUUID();
  const now = new Date();
  const claim = await db.jobState.updateMany({
    where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { owner, leaseUntil: new Date(Date.now() + 120_000), heartbeat: now },
  });
  if (!claim.count) return false;
  const heartbeat = setInterval(() => {
    void db.jobState
      .updateMany({
        where: { id, owner },
        data: {
          leaseUntil: new Date(Date.now() + 120_000),
          heartbeat: new Date(),
        },
      })
      .catch(() => {});
  }, 20000);
  try {
    await work();
    await db.jobState.updateMany({
      where: { id, owner },
      data: { lastRun: new Date(), error: null },
    });
  } catch (error) {
    await db.jobState.updateMany({
      where: { id, owner },
      data: { lastRun: new Date(), error: safeError(error) },
    });
  } finally {
    clearInterval(heartbeat);
    await db.jobState.updateMany({
      where: { id, owner },
      data: { leaseUntil: null, owner: null },
    });
  }
  return true;
}
export async function runTick() {
  await withLease("runner", async () => {
    // A crashed process may have transmitted DATA. Never automatically retransmit.
    const abandoned = await db.sendAttempt.findMany({
      where: { state: "Sending" },
    });
    for (const a of abandoned)
      await db.$transaction([
        db.sendAttempt.update({
          where: { id: a.id },
          data: {
            state: "Outcome Unknown",
            error:
              "Runner restarted during submission. Reconcile with Sent before any resend.",
          },
        }),
        db.message.update({
          where: { id: a.messageId },
          data: { state: "Outcome Unknown" },
        }),
        db.auditLog.create({
          data: { action: "send.recovered_uncertain", entityId: a.id },
        }),
      ]);
    const incoming = await db.jobState.findUnique({ where: { id: "imap" } });
    const older = await db.jobState.findUnique({ where: { id: "history" } });
    if (
      incoming?.requested ||
      older?.requested ||
      !incoming?.lastRun ||
      incoming.lastRun.getTime() < Date.now() - 120000
    ) {
      // Consume the request before work so a new request cannot be lost at completion.
      await db.jobState.upsert({
        where: { id: "imap" },
        create: { id: "imap", requested: false },
        update: { requested: false },
      });
      if (older?.requested)
        await db.jobState.update({
          where: { id: "history" },
          data: { requested: false },
        });
      await withLease("imap", () => syncInbox(Boolean(older?.requested)));
    }
    const tracking = await db.jobState.findUnique({
      where: { id: "tracking" },
    });
    if (!tracking?.lastRun || tracking.lastRun.getTime() < Date.now() - 60000)
      await withLease("tracking", syncTracking);
    const queued = await db.sendAttempt.findMany({
      where: { state: "Queued" },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
    for (const attempt of queued) await executeSend(attempt.id);
    const reminders = await db.message.findMany({
      where: {
        direction: "Outbound",
        state: "SMTP Accepted",
        followupScheduled: false,
      },
      take: 100,
      orderBy: { receivedAt: "asc" },
    });
    for (const message of reminders)
      await scheduleFollowup(
        message.conversationId,
        message.receivedAt,
        message.id,
      );
    const sent = await db.jobState.findUnique({ where: { id: "sent-copy" } });
    if (!sent?.lastRun || sent.lastRun.getTime() < Date.now() - 120000) {
      await withLease("sent-copy", async () => {
        const missing = await db.message.findMany({
          where: {
            direction: "Outbound",
            state: "SMTP Accepted",
            sentCopySaved: false,
          },
          take: 3,
          orderBy: { createdAt: "asc" },
        });
        for (const message of missing) await saveSentCopy(message);
      });
    }
    await db.trackingEvent.deleteMany({
      where: { occurredAt: { lt: new Date(Date.now() - 90 * 86400_000) } },
    });
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.rateLimit.deleteMany({
      where: { resetAt: { lt: new Date(Date.now() - 86400_000) } },
    });
  });
}
