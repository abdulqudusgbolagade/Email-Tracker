import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { db } from "./db";
import { AppError, decrypt } from "./security";

export async function appSettings() {
  return db.appSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
}
export async function mailboxConfig() {
  const settings = await appSettings();
  const user = process.env.MAILBOX_USER || settings.mailboxUser;
  const pass =
    process.env.MAILBOX_PASSWORD ||
    (settings.encryptedPassword ? decrypt(settings.encryptedPassword) : "");
  if (!user || !pass)
    throw new AppError(
      503,
      "Configure the authorized mailbox in Settings first.",
    );
  const security = process.env.MAILBOX_PASSWORD
    ? process.env.SMTP_SECURITY || settings.smtpSecurity
    : settings.smtpSecurity;
  const port = Number(
    process.env.MAILBOX_PASSWORD
      ? process.env.SMTP_PORT || settings.smtpPort
      : settings.smtpPort,
  );
  if (
    !["TLS", "STARTTLS"].includes(security) ||
    (port === 465 && security !== "TLS") ||
    (port === 587 && security !== "STARTTLS")
  )
    throw new AppError(400, "Invalid SMTP security configuration.");
  return {
    settings,
    user,
    pass,
    smtp: {
      host: process.env.MAILBOX_PASSWORD
        ? process.env.SMTP_HOST || settings.smtpHost
        : settings.smtpHost,
      port,
      secure: security === "TLS",
      requireTLS: security === "STARTTLS",
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      logger: false as const,
      debug: false,
      tls: { rejectUnauthorized: true },
    },
    imap: {
      host: process.env.MAILBOX_PASSWORD
        ? process.env.IMAP_HOST || settings.imapHost
        : settings.imapHost,
      port: Number(
        process.env.MAILBOX_PASSWORD
          ? process.env.IMAP_PORT || settings.imapPort
          : settings.imapPort,
      ),
      secure: true,
      auth: { user, pass },
      logger: false as const,
      connectionTimeout: 15000,
      socketTimeout: 60000,
      tls: { rejectUnauthorized: true },
    },
  };
}
export async function testMailbox(kind: "smtp" | "imap") {
  const config = await mailboxConfig();
  if (kind === "smtp") {
    const transport = nodemailer.createTransport(config.smtp);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
    await db.appSettings.update({
      where: { id: "singleton" },
      data: { lastSmtpTest: new Date() },
    });
    return "SMTP authentication succeeded. This does not confirm recipient delivery.";
  }
  const client = new ImapFlow(config.imap);
  client.on("error", () => {});
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
  await db.appSettings.update({
    where: { id: "singleton" },
    data: { lastImapTest: new Date() },
  });
  return "IMAP authentication and Inbox access succeeded.";
}
export async function saveSentCopy(message: {
  id: string;
  messageId: string;
  rawMime: Uint8Array | null;
}) {
  if (!message.rawMime)
    throw new AppError(409, "Original MIME is unavailable.");
  const config = await mailboxConfig();
  const client = new ImapFlow(config.imap);
  client.on("error", () => {});
  try {
    await client.connect();
    const folders = await client.list();
    const folder =
      config.settings.sentFolder ||
      folders.find((x) => x.specialUse === "\\Sent")?.path;
    if (!folder)
      throw new AppError(
        409,
        "Set the IMAP Sent folder in Settings; no special-use Sent folder was advertised.",
      );
    const lock = await client.getMailboxLock(folder);
    try {
      const existing = await client.search(
        { header: { "message-id": message.messageId } },
        { uid: true },
      );
      if (!existing || existing.length === 0) {
        // Mark before append: an interrupted APPEND must be reconciled, never blindly repeated.
        const current = await db.message.findUniqueOrThrow({
          where: { id: message.id },
        });
        if (
          current.sentCopyState === "Appending" ||
          current.sentCopyState === "Unknown"
        )
          throw new AppError(
            409,
            "Previous Sent append is uncertain. Reconcile or save the original MIME manually.",
          );
        await db.message.update({
          where: { id: message.id },
          data: { sentCopyState: "Appending" },
        });
        try {
          await client.append(folder, Buffer.from(message.rawMime), ["\\Seen"]);
        } catch (e) {
          await db.message.update({
            where: { id: message.id },
            data: { sentCopyState: "Unknown" },
          });
          throw e;
        }
      }
      await db.message.update({
        where: { id: message.id },
        data: { sentCopySaved: true, sentCopyState: "Saved" },
      });
    } finally {
      lock.release();
    }
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
}
