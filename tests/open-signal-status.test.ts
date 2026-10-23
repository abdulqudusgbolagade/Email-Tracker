import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { OpenSignalStatus } from "../src/components/open-signal-status";
import { db } from "../src/lib/db";
import { snapshot, prospectHistory, type Snapshot } from "../src/lib/data";
import { digest, token } from "../src/lib/security";
import { syncTracking } from "../src/lib/tracking";
import { outbound } from "./helpers";

async function renderMessage() {
  const data = JSON.parse(JSON.stringify(await snapshot())) as Snapshot;
  return renderToStaticMarkup(
    createElement(OpenSignalStatus, {
      message: data.messages[0],
      timeZone: "Africa/Lagos",
    }),
  );
}

it("shows tracking off for an untracked send instead of implying it was unread", async () => {
  await outbound();
  const html = await renderMessage();
  expect(html).toContain("Tracking off");
  expect(html).toContain("No open-signal data collected.");
  expect(html).not.toContain("No signal recorded");
  expect(html).not.toContain("0 recorded");
  expect(html).not.toContain("<img");
});

it("keeps tracked messages without events unknown in both list and history data", async () => {
  const { message, prospect } = await outbound();
  const hash = digest(token());
  await db.message.update({
    where: { id: message.id },
    data: { trackingHash: hash },
  });
  const html = await renderMessage();
  expect(html).toContain("No signal recorded");
  expect(html).toContain("Reading status unknown. Images may be blocked.");
  expect(html).not.toMatch(/\bunread\b/i);
  expect(html).not.toContain(hash);
  const history = await prospectHistory(prospect.id);
  expect(history.conversations[0].messages[0].trackingHash).toBe(hash);
});

it("displays synchronized first/latest events in the business timezone without claiming a read", async () => {
  const { message } = await outbound();
  const hash = digest(token());
  const first = "2026-10-23T08:00:00.000Z";
  const latest = "2026-10-23T08:05:00.000Z";
  await db.message.update({
    where: { id: message.id },
    data: { trackingHash: hash },
  });
  await db.remoteToken.create({
    data: {
      hash,
      kind: "signal",
      messageId: message.id,
      expiresAt: new Date(Date.now() + 86400_000),
    },
  });
  process.env.TRACKING_BASE_URL = "https://tracking.example.test";
  process.env.TRACKING_SYNC_SECRET = token();
  vi.stubGlobal("fetch", async () =>
    Response.json({
      events: [first, latest].map((occurred_at, index) => ({
        seq: index + 1,
        id: `status-event-${index}`,
        kind: "signal",
        token_hash: hash,
        occurred_at,
        category: "proxy-possible",
      })),
      cursor: 2,
      more: false,
    }),
  );
  await syncTracking();
  await syncTracking();
  expect(await db.trackingEvent.count()).toBe(2);
  const html = await renderMessage();
  expect(html).toContain("Open signal recorded");
  expect(html).toContain("2 recorded events");
  expect(html).toContain(first);
  expect(html).toContain(latest);
  expect(html).toContain("09:00 AM");
  expect(html).toContain("09:05 AM");
  expect(html).toContain("Africa/Lagos");
  expect(html).toContain("reading unconfirmed");
  expect(html).not.toContain(hash);
  expect(html).not.toContain("<img");
});
