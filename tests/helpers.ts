import { db } from "../src/lib/db";
import { encrypt } from "../src/lib/security";
import { saveDraft } from "../src/lib/sending";
export async function prepared() {
  const configuration = {
    mailboxUser: "owner@example.test",
    encryptedPassword: encrypt("fixture-password-only"),
    testRecipients: "test-recipient@example.test",
  };
  await db.appSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...configuration },
    update: configuration,
  });
  const prospect = await db.prospect.create({
    data: {
      fullName: "Test Author",
      email: "test-recipient@example.test",
      bookTitle: "A Test Book",
    },
  });
  const draft = await saveDraft({
    prospectId: prospect.id,
    subject: "Hello {{first_name}}",
    html: "<p>Hello {{first_name}}, your book {{book_title}} caught my eye.</p>",
    text: "Hello {{first_name}}, your book {{book_title}} caught my eye.",
    tracking: false,
  });
  return { prospect, draft };
}
export async function outbound() {
  const { prospect } = await prepared();
  const conversation = await db.conversation.create({
    data: { prospectId: prospect.id, subject: "Test outreach" },
  });
  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: "Outbound",
      messageId: "<outbound@example.test>",
      subject: "Test outreach",
      from: "owner@example.test",
      to: prospect.email,
      html: "<p>Test</p>",
      text: "Test",
      state: "SMTP Accepted",
      service: prospect.service,
    },
  });
  return { prospect, conversation, message };
}
export function incoming(headers = "", body = "Thanks, tell me more.") {
  return Buffer.from(
    `From: Test Author <test-recipient@example.test>\r\nTo: owner@example.test\r\nMessage-ID: <reply@example.test>\r\nSubject: Re: Test outreach\r\nIn-Reply-To: <outbound@example.test>\r\n${headers ? `${headers.trim()}\r\n` : ""}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  );
}
