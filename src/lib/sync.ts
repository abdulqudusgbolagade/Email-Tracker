import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { db } from "./db";
import { cleanHtml } from "./composition";
import { appSettings, mailboxConfig } from "./mailbox";
import { normalizeEmail } from "./validation";
import type { Prisma } from "../generated/prisma/client";
import { AppError } from "./security";

async function advanceCheckpoint(
  tx: Prisma.TransactionClient,
  id: string,
  identity: { uidValidity: string; uid: number },
) {
  const prior = await tx.syncCheckpoint.findUnique({ where: { id } });
  const lastUid =
    prior?.uidValidity === identity.uidValidity
      ? Math.max(prior.lastUid, identity.uid)
      : identity.uid;
  await tx.syncCheckpoint.upsert({
    where: { id },
    create: { id, uidValidity: identity.uidValidity, lastUid },
    update: { uidValidity: identity.uidValidity, lastUid },
  });
}

export function headerIds(value: string | string[] | undefined) {
  return (
    (Array.isArray(value) ? value.join(" ") : value || "").match(
      /<[^<>\s]+@[^<>\s]+>/g,
    ) || []
  ).slice(-100);
}
export function classifyIncoming(parsed: ParsedMail) {
  const auto = String(parsed.headers.get("auto-submitted") || "").toLowerCase();
  const type = String(
    parsed.headers.get("content-type") &&
      typeof parsed.headers.get("content-type") === "object"
      ? (parsed.headers.get("content-type") as { value: string }).value
      : parsed.headers.get("content-type") || "",
  ).toLowerCase();
  const bounce =
    /multipart\/report|message\/delivery-status/.test(type) ||
    parsed.attachments.some((x) =>
      /message\/delivery-status/.test(x.contentType),
    );
  const automated =
    bounce ||
    Boolean(auto && auto !== "no") ||
    /bulk|list|junk/.test(
      String(parsed.headers.get("precedence") || "").toLowerCase(),
    );
  return { automated, bounce };
}
export async function matchThread(parsed: ParsedMail) {
  const sender = normalizeEmail(parsed.from?.value[0]?.address || "");
  if (!sender) return null;
  const ids = [
    ...headerIds(parsed.inReplyTo),
    ...headerIds(parsed.references).reverse(),
  ];
  for (const id of [...new Set(ids)]) {
    const matches = await db.message.findMany({
      where: { messageId: id },
      include: { conversation: { include: { prospect: true } } },
    });
    const match = matches.find((m) => m.conversation.prospect.email === sender);
    if (match)
      return {
        conversationId: match.conversationId,
        prospectId: match.conversation.prospectId,
        outboundId:
          match.direction === "Outbound" ? match.id : match.replyToMessageId,
        matched: true,
      };
  }
  // Some DSNs carry Original-Message-ID instead of reply headers. Do not classify normal mail by this field.
  if (classifyIncoming(parsed).bounce) {
    const text = [
      parsed.text || "",
      ...parsed.attachments
        .filter((a) => a.contentType === "message/delivery-status")
        .map((a) => a.content.toString("utf8")),
    ].join("\n");
    const original = text.match(
      /(?:original-message-id|x-original-message-id):\s*(<[^>]+>)/i,
    )?.[1];
    if (original) {
      const outbound = await db.message.findFirst({
        where: { messageId: original, direction: "Outbound" },
      });
      if (outbound) {
        const convo = await db.conversation.findUniqueOrThrow({
          where: { id: outbound.conversationId },
        });
        return {
          conversationId: convo.id,
          prospectId: convo.prospectId,
          outboundId: outbound.id,
          matched: true,
        };
      }
    }
  }
  const prospect = await db.prospect.findUnique({ where: { email: sender } });
  return prospect
    ? {
        conversationId: null,
        prospectId: prospect.id,
        outboundId: null,
        matched: false,
      }
    : null;
}
export async function importIncoming(
  source: Buffer,
  identity: {
    mailbox: string;
    folder: string;
    uidValidity: string;
    uid: number;
  },
  checkpointId?: string,
) {
  const exists = await db.message.findFirst({ where: identity });
  if (exists) {
    if (checkpointId)
      await db.$transaction((tx) =>
        advanceCheckpoint(tx, checkpointId, identity),
      );
    return false;
  }
  const parsed = await simpleParser(source, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    maxHtmlLengthToParse: 200000,
  });
  const match = await matchThread(parsed);
  const settings = await appSettings();
  const { automated, bounce } = classifyIncoming(parsed);
  const now = new Date();
  const receivedAt =
    parsed.date && parsed.date <= new Date(Date.now() + 86400_000)
      ? parsed.date
      : now;
  await db.$transaction(async (tx) => {
    if (match) {
      const mid =
        parsed.messageId ||
        `<imap-${identity.uidValidity}-${identity.uid}@local.invalid>`;
      const duplicate = await tx.message.findFirst({
        where: {
          messageId: mid,
          direction: "Inbound",
          conversation: { prospectId: match.prospectId },
        },
      });
      if (!duplicate) {
        const conversationId =
          match.conversationId ||
          (
            await tx.conversation.create({
              data: {
                prospectId: match.prospectId,
                subject: parsed.subject || "(no subject)",
              },
            })
          ).id;
        const qualified =
          match.matched && Boolean(match.outboundId) && !automated;
        const parent = match.outboundId
          ? await tx.message.findUnique({ where: { id: match.outboundId } })
          : null;
        await tx.message.create({
          data: {
            ...identity,
            conversationId,
            direction: "Inbound",
            messageId: mid,
            inReplyTo: headerIds(parsed.inReplyTo)[0],
            references: JSON.stringify(headerIds(parsed.references)),
            subject: (parsed.subject || "(no subject)").slice(0, 300),
            from: parsed.from?.value[0]?.address || "",
            to: parsed.to
              ? (Array.isArray(parsed.to) ? parsed.to[0] : parsed.to).text
              : "",
            html: cleanHtml(parsed.html || ""),
            text: (parsed.text || "").slice(0, 200000),
            state: "Received",
            service:
              parent?.service ||
              (
                await tx.prospect.findUniqueOrThrow({
                  where: { id: match.prospectId },
                })
              ).service,
            campaignId: parent?.campaignId,
            receivedAt,
            automated,
            bounce,
            qualifiedReply: qualified,
            replyToMessageId: match.outboundId,
          },
        });
        if (bounce && match.outboundId)
          await tx.message.update({
            where: { id: match.outboundId },
            data: { delivery: "Failure notice received" },
          });
        const firstLine = (parsed.text || "")
          .trim()
          .split(/\r?\n/)[0]
          .replace(/[.!]/g, "")
          .trim()
          .toLowerCase();
        const optedOut =
          !automated &&
          ["unsubscribe", "stop", "stop contact", "remove me"].includes(
            firstLine,
          );
        if (qualified || optedOut) {
          const prospect = await tx.prospect.findUniqueOrThrow({
            where: { id: match.prospectId },
          });
          const suppressed = await tx.suppression.findUnique({
            where: { email: prospect.email },
          });
          await tx.prospect.update({
            where: { id: prospect.id },
            data: {
              lastReply:
                prospect.lastReply && prospect.lastReply > receivedAt
                  ? prospect.lastReply
                  : receivedAt,
              status:
                optedOut || suppressed
                  ? "Do Not Contact"
                  : ["New", "Contacted", "Awaiting Reply"].includes(
                        prospect.status,
                      )
                    ? "Replied"
                    : prospect.status,
              ...(!settings.keepReminders || optedOut
                ? { followUpDate: null }
                : {}),
            },
          });
          if (optedOut)
            await tx.suppression.upsert({
              where: { email: prospect.email },
              create: { email: prospect.email, reason: "Unsubscribe reply" },
              update: {},
            });
          if (!settings.keepReminders || optedOut || suppressed)
            await tx.followUp.updateMany({
              where: {
                conversation: { prospectId: prospect.id },
                state: "Pending",
              },
              data: { state: "Cancelled" },
            });
        }
      }
    }
    if (checkpointId) await advanceCheckpoint(tx, checkpointId, identity);
  });
  return Boolean(match);
}
export async function syncInbox(allHistory = false) {
  const config = await mailboxConfig();
  const client = new ImapFlow(config.imap);
  client.on("error", () => {});
  const checkpointId = `imap:${config.user}:INBOX`;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const folder = client.mailbox;
      if (!folder) return;
      const validity = String(folder.uidValidity);
      const checkpoint = await db.syncCheckpoint.findUnique({
        where: { id: checkpointId },
      });
      const lastUid =
        !allHistory && checkpoint?.uidValidity === validity
          ? checkpoint.lastUid
          : 0;
      const found = await client.search(
        lastUid
          ? { uid: `${lastUid + 1}:*` }
          : allHistory || checkpoint
            ? { all: true }
            : { since: new Date(Date.now() - 30 * 86400_000) },
        { uid: true },
      );
      const uids = (found || [])
        .filter((uid) => uid > lastUid)
        .sort((a, b) => a - b);
      for (let start = 0; start < uids.length; start += 100) {
        const batch = uids.slice(start, start + 100);
        // Metadata first: avoid downloading unbounded attachments.
        const metadata = await client.fetchAll(
          batch,
          { uid: true, size: true },
          { uid: true },
        );
        const sorted = metadata.sort((a, b) => a.uid - b.uid);
        for (const meta of sorted) {
          if (meta.size === undefined || meta.size > 5_000_000) {
            // Stop here rather than advance over a skipped message and silently lose replies.
            throw new AppError(
              409,
              "Inbox contains a message above the 5 MB import limit. Move it to another folder after review to resume.",
            );
          }
          const mail = (await client.fetchOne(
            meta.uid,
            { source: true, uid: true },
            { uid: true },
          )) as FetchMessageObject | false;
          if (!mail || !mail.source) continue;
          await importIncoming(
            mail.source,
            {
              mailbox: config.user,
              folder: "INBOX",
              uidValidity: validity,
              uid: mail.uid,
            },
            checkpointId,
          );
        }
      }
      if (!uids.length && (!checkpoint || checkpoint.uidValidity !== validity))
        await db.syncCheckpoint.upsert({
          where: { id: checkpointId },
          create: {
            id: checkpointId,
            uidValidity: validity,
            lastUid: Math.max(0, (folder.uidNext || 1) - 1),
          },
          update: {
            uidValidity: validity,
            lastUid: Math.max(0, (folder.uidNext || 1) - 1),
          },
        });
    } finally {
      lock.release();
    }
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
}
