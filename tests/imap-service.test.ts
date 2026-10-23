import { beforeEach, it, expect, vi } from "vitest";
import { incoming, outbound } from "./helpers";
import { db } from "../src/lib/db";
const fixture = vi.hoisted(() => ({
  fail: false,
  messages: new Map<number, Buffer>(),
  validity: 100n,
  searches: [] as unknown[],
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    usable = true;
    mailbox = { uidValidity: fixture.validity, uidNext: 3 };
    on() {}
    async connect() {}
    async logout() {}
    close() {}
    async getMailboxLock() {
      return { release() {} };
    }
    async search(query: unknown) {
      fixture.searches.push(query);
      return [...fixture.messages.keys()];
    }
    async fetchAll(uids: number[]) {
      return uids.map((uid) => ({
        uid,
        size: fixture.messages.get(uid)!.length,
      }));
    }
    async fetchOne(uid: number) {
      if (fixture.fail && uid === 2) throw new Error("fixture disconnect");
      return { uid, source: fixture.messages.get(uid) };
    }
  },
}));
import { syncInbox } from "../src/lib/sync";
beforeEach(() => {
  fixture.fail = false;
  fixture.messages.clear();
  fixture.validity = 100n;
  fixture.searches = [];
});
it("resumes an interrupted synchronization without duplicating imported replies", async () => {
  await outbound();
  fixture.messages.set(1, incoming());
  fixture.messages.set(
    2,
    Buffer.from(
      incoming()
        .toString()
        .replace("<reply@example.test>", "<reply-two@example.test>"),
    ),
  );
  fixture.fail = true;
  await expect(syncInbox()).rejects.toThrow("fixture disconnect");
  expect((await db.syncCheckpoint.findFirstOrThrow()).lastUid).toBe(1);
  fixture.fail = false;
  await syncInbox();
  expect((await db.syncCheckpoint.findFirstOrThrow()).lastUid).toBe(2);
  expect(await db.message.count({ where: { direction: "Inbound" } })).toBe(2);
});
it("preserves a monotonic checkpoint when importing older history again", async () => {
  await outbound();
  fixture.messages.set(2, incoming());
  await syncInbox();
  fixture.messages.set(
    1,
    Buffer.from(
      incoming()
        .toString()
        .replace("<reply@example.test>", "<older@example.test>"),
    ),
  );
  await syncInbox(true);
  expect((await db.syncCheckpoint.findFirstOrThrow()).lastUid).toBe(2);
});
