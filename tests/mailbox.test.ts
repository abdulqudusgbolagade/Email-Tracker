import { beforeEach, expect, it, vi } from "vitest";
import { db } from "../src/lib/db";
import { outbound } from "./helpers";
const fake = vi.hoisted(() => ({
  exists: false,
  fail: false,
  append: vi.fn(),
  open: vi.fn(),
  options: {} as Record<string, unknown>,
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    usable = true;
    constructor(options: Record<string, unknown>) {
      fake.options = options;
    }
    on() {}
    async connect() {}
    async list() {
      return [{ path: "Sent", specialUse: "\\Sent" }];
    }
    async getMailboxLock() {
      return { release() {} };
    }
    async search() {
      return fake.exists ? [1] : [];
    }
    async append(...args: unknown[]) {
      fake.append(...args);
      if (fake.fail) throw new Error("fixture interruption");
      fake.exists = true;
    }
    async mailboxOpen() {
      fake.open();
    }
    async logout() {}
    close() {}
  },
}));
import { saveSentCopy, testMailbox } from "../src/lib/mailbox";
beforeEach(() => {
  fake.exists = false;
  fake.fail = false;
  fake.append.mockClear();
  fake.open.mockClear();
});
it("discovers Sent and appends the original MIME only once", async () => {
  const { message } = await outbound();
  const raw = new Uint8Array(
    Buffer.from("Message-ID: <outbound@example.test>\r\n\r\nFixture"),
  );
  await db.message.update({
    where: { id: message.id },
    data: { rawMime: raw },
  });
  const record = await db.message.findUniqueOrThrow({
    where: { id: message.id },
  });
  await saveSentCopy(record);
  await saveSentCopy(record);
  expect(fake.append).toHaveBeenCalledTimes(1);
  expect(
    (await db.message.findUniqueOrThrow({ where: { id: message.id } }))
      .sentCopySaved,
  ).toBe(true);
});
it("does not duplicate a provider-saved Sent copy", async () => {
  const { message } = await outbound();
  fake.exists = true;
  await saveSentCopy({ ...message, rawMime: new Uint8Array([1]) });
  expect(fake.append).not.toHaveBeenCalled();
});
it("does not blindly retry an interrupted Sent APPEND", async () => {
  const { message } = await outbound();
  fake.fail = true;
  await expect(
    saveSentCopy({ ...message, rawMime: new Uint8Array([1]) }),
  ).rejects.toThrow("fixture");
  fake.fail = false;
  await expect(
    saveSentCopy({ ...message, rawMime: new Uint8Array([1]) }),
  ).rejects.toThrow("uncertain");
  expect(fake.append).toHaveBeenCalledTimes(1);
});
it("tests IMAP independently with TLS and read-only Inbox access", async () => {
  await outbound();
  await testMailbox("imap");
  expect(fake.open).toHaveBeenCalledTimes(1);
  expect(fake.options.secure).toBe(true);
  expect(
    (fake.options.tls as { rejectUnauthorized: boolean }).rejectUnauthorized,
  ).toBe(true);
  const settings = await db.appSettings.findFirstOrThrow();
  expect(settings.lastImapTest).not.toBeNull();
  expect(settings.lastSmtpTest).toBeNull();
});
