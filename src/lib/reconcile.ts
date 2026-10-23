import { ImapFlow } from "imapflow";
import { db } from "./db";
import { mailboxConfig, saveSentCopy } from "./mailbox";
import { AppError } from "./security";
import { scheduleFollowup } from "./followups";

export async function reconcileMessage(id: string) {
  const message = await db.message.findUniqueOrThrow({ where: { id } });
  if (message.state === "SMTP Accepted") {
    await saveSentCopy(message);
    return;
  }
  if (message.state !== "Outcome Unknown")
    throw new AppError(
      409,
      "Only accepted or uncertain sends can be reconciled.",
    );
  const config = await mailboxConfig();
  const client = new ImapFlow(config.imap);
  client.on("error", () => {});
  let found = false;
  try {
    await client.connect();
    const folders = await client.list();
    const sent =
      config.settings.sentFolder ||
      folders.find((x) => x.specialUse === "\\Sent")?.path;
    if (!sent)
      throw new AppError(409, "Configure the Sent folder in Settings.");
    const lock = await client.getMailboxLock(sent, { readOnly: true });
    try {
      const matches = await client.search(
        { header: { "message-id": message.messageId } },
        { uid: true },
      );
      found = Boolean(matches && matches.length);
    } finally {
      lock.release();
    }
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
  if (!found)
    throw new AppError(
      409,
      "No matching Sent copy found. The outcome remains uncertain; do not blindly resend. Review the mailbox and provider records.",
    );
  await db.$transaction([
    db.message.update({
      where: { id },
      data: {
        state: "SMTP Accepted",
        sentCopySaved: true,
        sentCopyState: "Saved",
      },
    }),
    db.sendAttempt.updateMany({
      where: { messageId: id, state: "Outcome Unknown" },
      data: { state: "SMTP Accepted", completedAt: new Date(), error: null },
    }),
    db.auditLog.create({
      data: {
        action: "send.reconciled_from_sent",
        entityId: id,
        detail:
          "Matching Message-ID found; recipient delivery remains unconfirmed.",
      },
    }),
  ]);
  const convo = await db.conversation.findUniqueOrThrow({
    where: { id: message.conversationId },
  });
  await db.prospect.update({
    where: { id: convo.prospectId },
    data: { lastContacted: message.createdAt },
  });
  await scheduleFollowup(convo.id, message.createdAt, message.id);
}
