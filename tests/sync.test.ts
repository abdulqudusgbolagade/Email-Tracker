import { it, expect } from "vitest";
import { simpleParser } from "mailparser";
import { db } from "../src/lib/db";
import {
  classifyIncoming,
  headerIds,
  importIncoming,
  matchThread,
} from "../src/lib/sync";
import { scheduleFollowup } from "../src/lib/followups";
import { incoming, outbound } from "./helpers";
const identity = {
  mailbox: "owner@example.test",
  folder: "INBOX",
  uidValidity: "100",
  uid: 1,
};
it("matches references and validates sender instead of relying on subjects", async () => {
  const { conversation, prospect } = await outbound();
  expect(headerIds(["<a@example.test>", "<b@example.test>"])).toHaveLength(2);
  const parsed = await simpleParser(incoming());
  expect((await matchThread(parsed))?.conversationId).toBe(conversation.id);
  const forged = await simpleParser(
    Buffer.from(
      incoming().toString().replace(prospect.email, "stranger@example.test"),
    ),
  );
  expect(await matchThread(forged)).toBeNull();
  const noHeaders = await simpleParser(
    Buffer.from(
      incoming()
        .toString()
        .replace(
          "In-Reply-To: <outbound@example.test>",
          "References: <unrelated@example.test>",
        ),
    ),
  );
  const result = await matchThread(noHeaders);
  expect(result?.matched).toBe(false);
  expect(result?.conversationId).toBeNull();
});
it("imports a human reply once, advances checkpoint and cancels reminders", async () => {
  const { prospect, conversation } = await outbound();
  await scheduleFollowup(conversation.id);
  await importIncoming(incoming(), identity, "imap-fixture");
  await importIncoming(incoming(), identity, "imap-fixture");
  expect(await db.message.count({ where: { direction: "Inbound" } })).toBe(1);
  expect(
    (
      await db.syncCheckpoint.findUniqueOrThrow({
        where: { id: "imap-fixture" },
      })
    ).lastUid,
  ).toBe(1);
  expect(
    (await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } }))
      .status,
  ).toBe("Replied");
  expect(await db.followUp.count({ where: { state: "Pending" } })).toBe(0);
});
it("handles UIDVALIDITY changes without duplicating the same Message-ID", async () => {
  await outbound();
  await importIncoming(incoming(), identity, "imap-fixture");
  await importIncoming(
    incoming(),
    { ...identity, uidValidity: "101", uid: 10 },
    "imap-fixture",
  );
  expect(await db.message.count({ where: { direction: "Inbound" } })).toBe(1);
  expect(
    (
      await db.syncCheckpoint.findUniqueOrThrow({
        where: { id: "imap-fixture" },
      })
    ).uidValidity,
  ).toBe("101");
});
it("does not count auto-replies or cancel reminders for them", async () => {
  const { conversation } = await outbound();
  await scheduleFollowup(conversation.id);
  const raw = incoming("Auto-Submitted: auto-replied\r\n");
  expect(classifyIncoming(await simpleParser(raw)).automated).toBe(true);
  await importIncoming(raw, identity);
  expect(
    (await db.message.findFirstOrThrow({ where: { direction: "Inbound" } }))
      .qualifiedReply,
  ).toBe(false);
  expect(await db.followUp.count({ where: { state: "Pending" } })).toBe(1);
});
it("honors keep-reminders preference and always cancels on an unsubscribe reply", async () => {
  const { conversation, prospect } = await outbound();
  await db.appSettings.update({
    where: { id: "singleton" },
    data: { keepReminders: true },
  });
  await scheduleFollowup(conversation.id);
  await importIncoming(incoming(), identity);
  expect(await db.followUp.count({ where: { state: "Pending" } })).toBe(1);
  const stop = Buffer.from(
    incoming("", "Unsubscribe")
      .toString()
      .replace("<reply@example.test>", "<unsubscribe@example.test>"),
  );
  await importIncoming(stop, { ...identity, uid: 2 });
  expect(await db.followUp.count({ where: { state: "Pending" } })).toBe(0);
  expect(
    await db.suppression.findUnique({ where: { email: prospect.email } }),
  ).not.toBeNull();
});
it("recognizes multipart delivery reports without treating them as human replies", async () => {
  const raw = Buffer.from(
    'From: mailer-daemon@example.test\r\nTo: owner@example.test\r\nMessage-ID: <dsn@example.test>\r\nSubject: Failure\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="report"\r\n\r\n--report\r\nContent-Type: text/plain\r\n\r\nDelivery failed\r\n--report\r\nContent-Type: message/delivery-status\r\n\r\nOriginal-Message-ID: <outbound@example.test>\r\nAction: failed\r\n\r\n--report--',
  );
  const { message } = await outbound();
  expect(classifyIncoming(await simpleParser(raw)).bounce).toBe(true);
  await importIncoming(raw, identity);
  expect(
    (await db.message.findUniqueOrThrow({ where: { id: message.id } }))
      .delivery,
  ).toBe("Failure notice received");
});
