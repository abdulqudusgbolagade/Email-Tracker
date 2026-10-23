import { it, expect, vi } from "vitest";
import { db } from "../src/lib/db";
import { syncTracking, workerRequest } from "../src/lib/tracking";
import { digest, token } from "../src/lib/security";
import { outbound } from "./helpers";
it("ingests events once and atomically advances the durable cursor", async () => {
  const { message } = await outbound();
  const hash = digest(token());
  await db.remoteToken.create({
    data: {
      hash,
      kind: "signal",
      messageId: message.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  process.env.TRACKING_BASE_URL = "https://tracking.example.test";
  process.env.TRACKING_SYNC_SECRET = token();
  const event = {
    seq: 1,
    id: "remote-event-1",
    kind: "signal",
    token_hash: hash,
    occurred_at: new Date().toISOString(),
    category: "proxy-possible",
  };
  const request = vi.fn(async () =>
    Response.json({ events: [event], cursor: 1, more: false }),
  );
  vi.stubGlobal("fetch", request);
  await syncTracking();
  await syncTracking();
  expect(await db.trackingEvent.count()).toBe(1);
  expect(
    (await db.message.findUniqueOrThrow({ where: { id: message.id } }))
      .signalCount,
  ).toBe(1);
  expect(
    (await db.syncCheckpoint.findUniqueOrThrow({ where: { id: "tracking" } }))
      .cursor,
  ).toBe(1);
  const headers = request.mock.calls[0] as unknown as [URL, RequestInit];
  expect((headers[1].headers as Record<string, string>)["x-signature"]).toMatch(
    /^[a-f0-9]{64}$/,
  );
});
it("rejects malformed remote data without advancing a cursor", async () => {
  process.env.TRACKING_BASE_URL = "https://tracking.example.test";
  process.env.TRACKING_SYNC_SECRET = token();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ events: [{ bad: true }], cursor: 50, more: false }),
    ),
  );
  await expect(syncTracking()).rejects.toThrow();
  expect(await db.syncCheckpoint.count()).toBe(0);
});
it("imports public opt-outs independently of tracking and suppresses contact", async () => {
  const { prospect, conversation } = await outbound();
  const hash = digest(token());
  await db.remoteToken.create({
    data: {
      hash,
      kind: "optout",
      prospectId: prospect.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await db.followUp.create({
    data: { conversationId: conversation.id, dueAt: new Date() },
  });
  process.env.TRACKING_BASE_URL = "https://tracking.example.test";
  process.env.TRACKING_SYNC_SECRET = token();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        events: [
          {
            seq: 1,
            id: "optout-1",
            kind: "optout",
            token_hash: hash,
            occurred_at: new Date().toISOString(),
            category: "confirmed-optout",
          },
        ],
        cursor: 1,
        more: false,
      }),
    ),
  );
  await syncTracking();
  expect(
    await db.suppression.findUnique({ where: { email: prospect.email } }),
  ).not.toBeNull();
  expect(await db.followUp.count({ where: { state: "Pending" } })).toBe(0);
});
it("fails closed for unavailable public opt-out synchronization", async () => {
  process.env.TRACKING_BASE_URL = "https://tracking.example.test";
  process.env.TRACKING_SYNC_SECRET = token();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network");
    }),
  );
  await expect(workerRequest("/admin/changes", { cursor: 0 })).rejects.toThrow(
    "paused",
  );
});
it("does not bypass active public opt-outs when Worker configuration is removed", async () => {
  await db.remoteToken.create({
    data: {
      hash: digest(token()),
      kind: "optout",
      prospectId: "fixture",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await expect(syncTracking()).rejects.toThrow(
    "Restore the Worker configuration",
  );
});
