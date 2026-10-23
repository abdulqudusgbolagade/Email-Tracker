import { it, expect, vi } from "vitest";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { cleanHtml, renderContent } from "../src/lib/composition";
import { queueSend, executeSend, saveDraft } from "../src/lib/sending";
import { mailboxConfig, testMailbox } from "../src/lib/mailbox";
import { prepared } from "./helpers";
it("sanitizes HTML, escapes personalization and blocks unresolved placeholders", async () => {
  const { prospect } = await prepared();
  const rendered = renderContent(
    {
      subject: "Hi {{first_name}}",
      html: '<script>alert(1)</script><p>{{book_title}}</p><img src="https://evil.example/pixel">',
      text: "{{book_title}}",
    },
    { ...prospect, bookTitle: "<script>book</script>" },
    "Signature",
  );
  expect(rendered.html).not.toContain("<script>");
  expect(rendered.html).not.toContain("<img");
  expect(rendered.html).toContain("&lt;script&gt;book");
  expect(rendered.text).toContain("unsubscribe");
  expect(() =>
    renderContent(
      { subject: "{{unknown}}", html: "<p>Hi</p>", text: "Hi" },
      prospect,
      "",
    ),
  ).toThrow("placeholder");
  expect(cleanHtml('<a href="javascript:alert(1)">x</a>')).not.toContain(
    "javascript",
  );
});
it("produces immutable MIME and returns the same operation under concurrent confirmation", async () => {
  const { draft } = await prepared();
  const key = randomUUID();
  const operations = await Promise.all([
    queueSend(draft.id, draft.revision, key),
    queueSend(draft.id, draft.revision, key),
  ]);
  expect(operations[0].id).toBe(operations[1].id);
  expect(await db.message.count()).toBe(1);
  const message = await db.message.findFirstOrThrow();
  const parsed = await simpleParser(Buffer.from(message.rawMime!));
  expect(parsed.subject).toBe("Hello Test");
  expect(parsed.text).toContain("unsubscribe");
  expect(parsed.html).not.toContain("/p/");
  expect(parsed.messageId).toBe(message.messageId);
  await expect(queueSend(draft.id, draft.revision + 1, key)).rejects.toThrow(
    "another send",
  );
});
it("claims once, records SMTP acceptance and never resends when Sent preservation fails", async () => {
  const { draft } = await prepared();
  const operation = await queueSend(draft.id, draft.revision, randomUUID());
  const submit = vi.fn(async () => ({
    accepted: ["test-recipient@example.test"],
  }));
  const preserve = vi.fn(async () => {
    throw new Error("IMAP unavailable");
  });
  await Promise.all([
    executeSend(operation.id, { submit, preserve }),
    executeSend(operation.id, { submit, preserve }),
  ]);
  await executeSend(operation.id, { submit, preserve });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    (await db.sendAttempt.findUniqueOrThrow({ where: { id: operation.id } }))
      .state,
  ).toBe("SMTP Accepted");
  expect((await db.message.findFirstOrThrow()).delivery).toBe("Unconfirmed");
  expect(await db.followUp.count()).toBe(1);
});
it("keeps ambiguous network failures uncertain and prevents automatic retries", async () => {
  const { draft } = await prepared();
  const operation = await queueSend(draft.id, draft.revision, randomUUID());
  const submit = vi.fn(async () => {
    throw Object.assign(new Error("fixture"), { code: "ETIMEDOUT" });
  });
  await executeSend(operation.id, { submit });
  await executeSend(operation.id, { submit });
  expect(submit).toHaveBeenCalledTimes(1);
  expect((await db.sendAttempt.findFirstOrThrow()).state).toBe(
    "Outcome Unknown",
  );
  const updated = await saveDraft({ ...draft, revision: 1, text: "An edit" });
  await expect(
    queueSend(updated.id, updated.revision, randomUUID()),
  ).rejects.toThrow("uncertain");
});
it("records explicit SMTP rejection and rechecks suppression after confirmation", async () => {
  const { draft, prospect } = await prepared();
  const operation = await queueSend(draft.id, draft.revision, randomUUID());
  await db.suppression.create({
    data: { email: prospect.email, reason: "Fixture opt-out" },
  });
  const submit = vi.fn(async () => ({ accepted: [prospect.email] }));
  await executeSend(operation.id, { submit });
  expect(submit).not.toHaveBeenCalled();
  expect((await db.sendAttempt.findFirstOrThrow()).state).toBe("Rejected");
});
it("blocks non-test recipients, missing tracking setup and stale draft revisions", async () => {
  const { draft } = await prepared();
  await db.appSettings.update({
    where: { id: "singleton" },
    data: { testRecipients: "" },
  });
  await expect(queueSend(draft.id, 1, randomUUID())).rejects.toThrow(
    "Test mode",
  );
  await db.appSettings.update({
    where: { id: "singleton" },
    data: { testRecipients: "test-recipient@example.test" },
  });
  await expect(queueSend(draft.id, 2, randomUUID())).rejects.toThrow(
    "revision",
  );
  const tracked = await saveDraft({ ...draft, revision: 1, tracking: true });
  await expect(
    queueSend(tracked.id, tracked.revision, randomUUID()),
  ).rejects.toThrow("Cloudflare");
});
it("retains TLS certificate verification and tests SMTP independently", async () => {
  await prepared();
  const configuration = await mailboxConfig();
  expect(configuration.smtp.secure).toBe(true);
  expect(configuration.smtp.tls.rejectUnauthorized).toBe(true);
  const verify = vi.fn(async () => true);
  const close = vi.fn();
  vi.spyOn(nodemailer, "createTransport").mockReturnValue({
    verify,
    close,
  } as unknown as ReturnType<typeof nodemailer.createTransport>);
  await testMailbox("smtp");
  expect(verify).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect((await db.appSettings.findFirstOrThrow()).lastImapTest).toBeNull();
});
it("submits real MIME to a local SMTP sink without live recipients", async () => {
  const { draft } = await prepared();
  const operation = await queueSend(draft.id, draft.revision, randomUUID());
  const received: Buffer[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        received.push(Buffer.concat(chunks));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture SMTP port missing");
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: address.port,
    secure: false,
    ignoreTLS: true,
  }); // Isolated test sink only; application transport always verifies TLS.
  try {
    await executeSend(operation.id, {
      submit: async (raw, from, to) =>
        transport.sendMail({ envelope: { from, to }, raw }),
      preserve: async () => {},
    });
  } finally {
    transport.close();
    await new Promise<void>((resolve) => server.close(resolve));
  }
  expect(received).toHaveLength(1);
  expect((await simpleParser(received[0])).subject).toBe("Hello Test");
});
it("distinguishes definite SMTP rejection from a network-uncertain outcome", async () => {
  const { draft } = await prepared();
  const operation = await queueSend(draft.id, draft.revision, randomUUID());
  await executeSend(operation.id, {
    submit: async () => {
      throw Object.assign(new Error("fixture rejection"), {
        responseCode: 550,
        code: "EENVELOPE",
      });
    },
  });
  expect(
    (await db.sendAttempt.findUniqueOrThrow({ where: { id: operation.id } }))
      .state,
  ).toBe("Rejected");
  expect(await db.followUp.count()).toBe(0);
});
it("enforces limits across separately confirmed sends without dropping the queue", async () => {
  const { draft, prospect } = await prepared();
  await db.appSettings.update({
    where: { id: "singleton" },
    data: { hourlyLimit: 1 },
  });
  const first = await queueSend(draft.id, draft.revision, randomUUID());
  const submit = vi.fn(async () => ({ accepted: [prospect.email] }));
  const preserve = async () => {};
  await executeSend(first.id, { submit, preserve });
  const secondDraft = await saveDraft({
    prospectId: prospect.id,
    subject: "Another confirmed message",
    html: "<p>Test</p>",
    text: "Test",
    tracking: false,
  });
  const second = await queueSend(
    secondDraft.id,
    secondDraft.revision,
    randomUUID(),
  );
  await executeSend(second.id, { submit, preserve });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    (await db.sendAttempt.findUniqueOrThrow({ where: { id: second.id } }))
      .state,
  ).toBe("Queued");
});
it("registers only hashes and includes one unpredictable pixel in the frozen MIME", async () => {
  const { draft } = await prepared();
  process.env.TRACKING_BASE_URL = "https://tracking.example.test";
  process.env.TRACKING_SYNC_SECRET =
    "fixture-shared-secret-with-at-least-32-characters";
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL, init: RequestInit) => {
      requests.push(String(init.body));
      return Response.json({ ok: true });
    }),
  );
  const tracked = await saveDraft({ ...draft, revision: 1, tracking: true });
  await queueSend(tracked.id, tracked.revision, randomUUID());
  expect(requests).toHaveLength(2);
  expect(requests.join("")).not.toContain("example.test");
  const parsed = await simpleParser(
    Buffer.from((await db.message.findFirstOrThrow()).rawMime!),
  );
  expect(String(parsed.html).match(/<img /g)).toHaveLength(1);
  expect(String(parsed.html)).toMatch(/\/p\/[A-Za-z0-9_-]{43}\.gif/);
  expect((await db.message.findFirstOrThrow()).html).not.toContain("<img");
});
