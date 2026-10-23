import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { randomUUID } from "node:crypto";
import { db, retryBusy } from "./db";
import { AppError, digest, safeError, token } from "./security";
import { mailboxConfig, saveSentCopy } from "./mailbox";
import { renderContent } from "./composition";
import { draftSchema } from "./validation";
import { syncTracking, trackingConfigured, workerRequest } from "./tracking";
import { scheduleFollowup } from "./followups";

export async function saveDraft(input: unknown) {
  const parsed = draftSchema.parse(input);
  const { id, revision, ...data } = parsed;
  if (id && !revision)
    throw new AppError(
      400,
      "Provide the current draft revision before updating.",
    );
  const prospect = await db.prospect.findUniqueOrThrow({
    where: { id: data.prospectId },
  });
  if (data.conversationId) {
    const convo = await db.conversation.findUnique({
      where: { id: data.conversationId },
    });
    if (!convo || convo.prospectId !== prospect.id)
      throw new AppError(400, "Conversation does not belong to this prospect.");
  }
  if (
    data.campaignId &&
    !(await db.campaign.findUnique({ where: { id: data.campaignId } }))
  )
    throw new AppError(400, "Unknown campaign.");
  if (!id) return db.draft.create({ data });
  return db.$transaction(async (tx) => {
    const saved = await tx.draft.updateMany({
      where: { id, revision },
      data: { ...data, revision: { increment: 1 } },
    });
    if (!saved.count)
      throw new AppError(
        409,
        "This draft changed elsewhere. Reload before saving.",
      );
    return tx.draft.findUniqueOrThrow({ where: { id } });
  });
}
export async function assertContactable(email: string, status: string) {
  if (
    ["Do Not Contact", "Not Interested", "Lost"].includes(status) ||
    (await db.suppression.findUnique({ where: { email } }))
  )
    throw new AppError(
      409,
      "This prospect is suppressed or closed. Sending is blocked.",
    );
}
export async function queueSend(
  draftId: string,
  revision: number,
  idempotencyKey: string,
) {
  const prior = await db.sendAttempt.findFirst({
    where: { OR: [{ idempotencyKey }, { draftId, revision }] },
  });
  if (prior) {
    if (prior.draftId !== draftId || prior.revision !== revision)
      throw new AppError(409, "Idempotency key belongs to another send.");
    return prior;
  }
  const draft = await db.draft.findUniqueOrThrow({
    where: { id: draftId },
    include: { prospect: true },
  });
  if (draft.revision !== revision)
    throw new AppError(409, "Draft revision changed. Preview again.");
  if (
    await db.sendAttempt.findFirst({
      where: {
        draftId,
        state: { in: ["Queued", "Sending", "Outcome Unknown"] },
      },
    })
  )
    throw new AppError(
      409,
      "A send for this draft is pending or uncertain. Review it before creating another.",
    );
  await assertContactable(draft.prospect.email, draft.prospect.status);
  const config = await mailboxConfig();
  const settings = config.settings;
  if (
    !settings.outreachEnabled &&
    !settings.testRecipients
      .split(/[\s,;]+/)
      .map((x) => x.toLowerCase())
      .includes(draft.prospect.email)
  )
    throw new AppError(
      403,
      "Test mode: add an owner-controlled recipient in Settings.",
    );
  const localId = randomUUID();
  const messageId = `<${randomUUID()}@${config.user.split("@")[1]}>`;
  const expiresAt = new Date(Date.now() + 180 * 86400_000);
  const registrations: {
    hash: string;
    kind: string;
    prospectId?: string;
    messageId?: string;
    expiresAt: Date;
  }[] = [];
  let unsubscribeUrl: string | undefined;
  let pixelUrl: string | undefined;
  const base = process.env.TRACKING_BASE_URL?.replace(/\/$/, "");
  if (trackingConfigured()) {
    const raw = token();
    registrations.push({
      hash: digest(raw),
      kind: "optout",
      prospectId: draft.prospectId,
      expiresAt,
    });
    unsubscribeUrl = `${base}/u/${raw}`;
  }
  if (draft.tracking) {
    if (!trackingConfigured())
      throw new AppError(
        503,
        "Set up Cloudflare tracking or disable tracking for this message.",
      );
    const raw = token();
    registrations.push({
      hash: digest(raw),
      kind: "signal",
      messageId: localId,
      expiresAt,
    });
    pixelUrl = `${base}/p/${raw}.gif`;
  }
  const rendered = renderContent(
    draft,
    draft.prospect,
    settings.signature,
    unsubscribeUrl,
  );
  const previous = draft.conversationId
    ? await db.message.findFirst({
        where: { conversationId: draft.conversationId },
        orderBy: { receivedAt: "desc" },
      })
    : null;
  const references = previous
    ? [
        ...(JSON.parse(previous.references) as string[]),
        previous.messageId,
      ].slice(-20)
    : [];
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
  });
  const built = await transport.sendMail({
    from: { name: settings.fromName, address: config.user },
    to: draft.prospect.email,
    subject: rendered.subject,
    text: rendered.text,
    html:
      rendered.html +
      (pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" />` : ""),
    messageId,
    inReplyTo: previous?.messageId,
    references,
    date: new Date(),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  if (!Buffer.isBuffer(built.message))
    throw new AppError(500, "MIME compilation did not produce a buffer.");
  const rawMime = new Uint8Array(built.message);
  for (const registration of registrations)
    await workerRequest("/admin/register", {
      hash: registration.hash,
      kind: registration.kind,
      expiresAt: registration.expiresAt.toISOString(),
    });
  // Recheck revision and suppression inside the transaction after network work.
  try {
    return await retryBusy(() =>
      db.$transaction(async (tx) => {
        const live = await tx.draft.findUniqueOrThrow({
          where: { id: draftId },
          include: { prospect: true },
        });
        if (
          live.revision !== revision ||
          live.prospect.email !== draft.prospect.email
        )
          throw new AppError(409, "Draft or recipient changed. Preview again.");
        if (
          (await tx.suppression.findUnique({
            where: { email: draft.prospect.email },
          })) ||
          ["Do Not Contact", "Not Interested", "Lost"].includes(
            live.prospect.status,
          )
        )
          throw new AppError(409, "This prospect is suppressed.");
        const conversation = draft.conversationId
          ? await tx.conversation.findUniqueOrThrow({
              where: { id: draft.conversationId },
            })
          : await tx.conversation.create({
              data: { prospectId: draft.prospectId, subject: rendered.subject },
            });
        await tx.message.create({
          data: {
            id: localId,
            conversationId: conversation.id,
            direction: "Outbound",
            messageId,
            inReplyTo: previous?.messageId,
            references: JSON.stringify(references),
            ...rendered,
            rawMime,
            from: config.user,
            to: draft.prospect.email,
            state: "Queued",
            campaignId: draft.campaignId || draft.prospect.campaignId,
            service: draft.prospect.service,
            trackingHash: registrations.find((x) => x.kind === "signal")?.hash,
            trackingExpiresAt: draft.tracking ? expiresAt : null,
          },
        });
        for (const r of registrations) await tx.remoteToken.create({ data: r });
        const attempt = await tx.sendAttempt.create({
          data: { idempotencyKey, draftId, revision, messageId: localId },
        });
        await tx.auditLog.create({
          data: {
            action: "send.confirmed",
            entityId: attempt.id,
            detail: "Explicit owner confirmation; immutable MIME prepared.",
          },
        });
        return attempt;
      }),
    );
  } catch (error) {
    const existing = await db.sendAttempt.findFirst({
      where: { OR: [{ idempotencyKey }, { draftId, revision }] },
    });
    if (
      existing &&
      existing.draftId === draftId &&
      existing.revision === revision
    )
      return existing;
    throw error;
  }
}
type SendDependencies = {
  submit?: (
    raw: Buffer,
    from: string,
    to: string,
  ) => Promise<{ accepted: unknown[] }>;
  preserve?: typeof saveSentCopy;
  sync?: typeof syncTracking;
};
export async function executeSend(
  attemptId: string,
  dependencies: SendDependencies = {},
) {
  const attempt = await db.sendAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      message: { include: { conversation: { include: { prospect: true } } } },
    },
  });
  if (attempt.state !== "Queued") return;
  const message = attempt.message;
  const prospect = message.conversation.prospect;
  try {
    await (dependencies.sync || syncTracking)();
    const latest = await db.prospect.findUniqueOrThrow({
      where: { id: prospect.id },
    });
    await assertContactable(prospect.email, latest.status);
    if (latest.email !== message.to)
      throw new AppError(409, "Recipient changed after confirmation.");
    const config = await mailboxConfig();
    const settings = config.settings;
    const expired = await db.remoteToken.count({
      where: {
        OR: [
          { messageId: message.id },
          { prospectId: prospect.id, kind: "optout" },
        ],
        expiresAt: { lte: new Date() },
      },
    });
    if (
      (message.trackingExpiresAt && message.trackingExpiresAt <= new Date()) ||
      (expired && message.createdAt.getTime() < Date.now() - 179 * 86400_000)
    )
      throw new AppError(
        409,
        "This queued message has expired tracking or unsubscribe links. Create a fresh draft.",
      );
    if (config.user !== message.from)
      throw new AppError(409, "Mailbox changed after confirmation.");
    if (
      !settings.outreachEnabled &&
      !settings.testRecipients
        .split(/[\s,;]+/)
        .map((x) => x.toLowerCase())
        .includes(message.to)
    )
      throw new AppError(409, "Recipient is not allowed in test mode.");
    const claimed = await retryBusy(() =>
      db.$transaction(async (tx) => {
        const hour = await tx.sendAttempt.count({
          where: { startedAt: { gte: new Date(Date.now() - 3600_000) } },
        });
        const day = await tx.sendAttempt.count({
          where: { startedAt: { gte: new Date(Date.now() - 86400_000) } },
        });
        if (hour >= settings.hourlyLimit || day >= settings.dailyLimit)
          throw new AppError(
            429,
            "Configured sending limit reached. The confirmed send remains queued.",
          );
        const fresh = await tx.prospect.findUniqueOrThrow({
          where: { id: prospect.id },
        });
        if (
          fresh.email !== message.to ||
          ["Do Not Contact", "Not Interested", "Lost"].includes(fresh.status) ||
          (await tx.suppression.findUnique({ where: { email: message.to } }))
        )
          throw new AppError(409, "Contact is suppressed or changed.");
        const claim = await tx.sendAttempt.updateMany({
          where: { id: attemptId, state: "Queued" },
          data: { state: "Sending", startedAt: new Date(), error: null },
        });
        if (claim.count) {
          await tx.message.update({
            where: { id: message.id },
            data: { state: "Sending" },
          });
          await tx.auditLog.create({
            data: { action: "send.started", entityId: attemptId },
          });
        }
        return Boolean(claim.count);
      }),
    );
    if (!claimed) return;
    let result: { accepted: unknown[] };
    try {
      if (dependencies.submit)
        result = await dependencies.submit(
          Buffer.from(message.rawMime!),
          message.from,
          message.to,
        );
      else {
        const transport = nodemailer.createTransport(config.smtp);
        try {
          result = (await transport.sendMail({
            envelope: { from: message.from, to: [message.to] },
            raw: Buffer.from(message.rawMime!),
            disableFileAccess: true,
            disableUrlAccess: true,
          })) as SMTPTransport.SentMessageInfo;
        } finally {
          transport.close();
        }
      }
      if (!result.accepted.length)
        throw new AppError(422, "SMTP did not accept the recipient.");
    } catch (error) {
      const responseCode =
        typeof error === "object" && error && "responseCode" in error
          ? Number(error.responseCode)
          : 0;
      const state =
        (error instanceof AppError && error.status === 422) ||
        responseCode >= 400 ||
        (typeof error === "object" &&
          error &&
          "code" in error &&
          error.code === "EAUTH")
          ? "Rejected"
          : "Outcome Unknown";
      await db.$transaction([
        db.sendAttempt.update({
          where: { id: attemptId },
          data: { state, error: safeError(error), completedAt: new Date() },
        }),
        db.message.update({ where: { id: message.id }, data: { state } }),
        db.auditLog.create({
          data: {
            action: `send.${state === "Rejected" ? "rejected" : "uncertain"}`,
            entityId: attemptId,
          },
        }),
      ]);
      return;
    }
    const acceptedAt = new Date();
    await db.$transaction([
      db.sendAttempt.update({
        where: { id: attemptId },
        data: { state: "SMTP Accepted", completedAt: acceptedAt },
      }),
      db.message.update({
        where: { id: message.id },
        data: { state: "SMTP Accepted", receivedAt: acceptedAt },
      }),
      db.prospect.update({
        where: { id: prospect.id },
        data: {
          lastContacted: acceptedAt,
          ...(["New", "Contacted", "Awaiting Reply"].includes(prospect.status)
            ? { status: "Awaiting Reply" }
            : {}),
        },
      }),
      db.auditLog.create({
        data: {
          action: "send.smtp_accepted",
          entityId: attemptId,
          detail: "Recipient delivery remains unconfirmed.",
        },
      }),
    ]);
    await scheduleFollowup(message.conversationId, acceptedAt, message.id);
    try {
      await (dependencies.preserve || saveSentCopy)(message);
    } catch (error) {
      await db.auditLog.create({
        data: {
          action: "sent_copy.needs_review",
          entityId: message.id,
          detail: safeError(error),
        },
      });
    }
  } catch (error) {
    // Any crash after claim is conservatively uncertain; never requeue it.
    const current = await db.sendAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    if (current.state === "Sending") {
      await db.$transaction([
        db.sendAttempt.update({
          where: { id: attemptId },
          data: { state: "Outcome Unknown", error: safeError(error) },
        }),
        db.message.update({
          where: { id: message.id },
          data: { state: "Outcome Unknown" },
        }),
      ]);
    } else if (current.state === "Queued") {
      const rejected =
        error instanceof AppError && [403, 409].includes(error.status);
      await db.sendAttempt.update({
        where: { id: attemptId },
        data: {
          state: rejected ? "Rejected" : "Queued",
          error: safeError(error),
        },
      });
      if (rejected)
        await db.message.update({
          where: { id: message.id },
          data: { state: "Rejected" },
        });
    }
  }
}
