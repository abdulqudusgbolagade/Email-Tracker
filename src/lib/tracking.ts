import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./security";

export function trackingConfigured() {
  return Boolean(
    process.env.TRACKING_BASE_URL && process.env.TRACKING_SYNC_SECRET,
  );
}
export async function workerRequest(path: string, data: unknown = {}) {
  if (!trackingConfigured())
    throw new AppError(
      503,
      "Configure the public tracking Worker first, or turn tracking off.",
    );
  const origin = new URL(process.env.TRACKING_BASE_URL!);
  if (
    origin.protocol !== "https:" &&
    !(
      process.env.NODE_ENV === "test" &&
      ["localhost", "127.0.0.1"].includes(origin.hostname)
    )
  )
    throw new AppError(400, "Tracking requires a public HTTPS origin.");
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const body = JSON.stringify(data);
  const signature = createHmac("sha256", process.env.TRACKING_SYNC_SECRET!)
    .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`)
    .digest("hex");
  let response: Response;
  try {
    response = await fetch(new URL(path, origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-timestamp": timestamp,
        "x-nonce": nonce,
        "x-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new AppError(
      503,
      "Tracking service unavailable. Sending is paused until opt-out synchronization succeeds.",
    );
  }
  if (!response.ok)
    throw new AppError(
      503,
      "Tracking service rejected synchronization. Check its secret and deployment configuration.",
    );
  return response.json();
}
const eventSchema = z.object({
  seq: z.number().int(),
  id: z.string(),
  kind: z.enum(["signal", "optout"]),
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  occurred_at: z.string().datetime(),
  category: z.string().max(40),
});
const changesSchema = z.object({
  events: z.array(eventSchema).max(500),
  cursor: z.number().int().nonnegative(),
  more: z.boolean(),
});
export async function syncTracking() {
  if (!trackingConfigured()) {
    if (
      await db.remoteToken.count({
        where: { kind: "optout", expiresAt: { gt: new Date() } },
      })
    )
      throw new AppError(
        503,
        "Restore the Worker configuration before sending: active public unsubscribe links must be synchronized.",
      );
    return;
  }
  for (let page = 0; page < 100; page++) {
    const checkpoint = await db.syncCheckpoint.findUnique({
      where: { id: "tracking" },
    });
    const cursor = checkpoint?.cursor || 0;
    const result = changesSchema.parse(
      await workerRequest("/admin/changes", { cursor }),
    );
    if (result.cursor < cursor)
      throw new AppError(503, "Tracking cursor moved backwards.");
    await db.$transaction(async (tx) => {
      for (const e of result.events) {
        const mapping = await tx.remoteToken.findUnique({
          where: { hash: e.token_hash },
        });
        if (!mapping) continue;
        if (e.kind === "signal" && mapping.messageId) {
          const exists = await tx.trackingEvent.findUnique({
            where: { id: e.id },
          });
          if (exists) continue;
          const message = await tx.message.findUnique({
            where: { id: mapping.messageId },
          });
          if (!message) continue;
          const at = new Date(e.occurred_at);
          await tx.trackingEvent.create({
            data: {
              id: e.id,
              messageId: mapping.messageId,
              occurredAt: at,
              category: e.category,
            },
          });
          await tx.message.update({
            where: { id: message.id },
            data: {
              signalCount: { increment: 1 },
              firstSignal:
                message.firstSignal && message.firstSignal < at
                  ? message.firstSignal
                  : at,
              latestSignal:
                message.latestSignal && message.latestSignal > at
                  ? message.latestSignal
                  : at,
            },
          });
        } else if (e.kind === "optout" && mapping.prospectId) {
          const prospect = await tx.prospect.findUnique({
            where: { id: mapping.prospectId },
          });
          if (!prospect) continue;
          await tx.suppression.upsert({
            where: { email: prospect.email },
            create: { email: prospect.email, reason: "Public unsubscribe" },
            update: {},
          });
          await tx.prospect.update({
            where: { id: prospect.id },
            data: { status: "Do Not Contact", followUpDate: null },
          });
          await tx.followUp.updateMany({
            where: {
              conversation: { prospectId: prospect.id },
              state: "Pending",
            },
            data: { state: "Cancelled" },
          });
        }
      }
      await tx.syncCheckpoint.upsert({
        where: { id: "tracking" },
        create: { id: "tracking", cursor: result.cursor },
        update: { cursor: result.cursor },
      });
    });
    if (!result.more) return;
  }
  throw new AppError(
    503,
    "Tracking synchronization is still catching up. Retry after the next background run.",
  );
}
