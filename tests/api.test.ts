import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { hashPassword, login } from "../src/lib/auth";
import { csrfFor } from "../src/lib/security";
import { DELETE, POST } from "../src/app/api/[...path]/route";
import { queueSend, executeSend } from "../src/lib/sending";
import { prepared } from "./helpers";
async function request(path: string, method: string, body: unknown) {
  await db.owner.create({
    data: {
      email: "owner@example.test",
      passwordHash: await hashPassword("fixture-owner-123456"),
    },
  });
  const raw = await login("owner@example.test", "fixture-owner-123456");
  return new Request(`http://localhost:3000/api/${path}`, {
    method,
    headers: {
      origin: "http://localhost:3000",
      cookie: `grant_session=${raw}`,
      "x-csrf-token": csrfFor(raw),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
it("returns the original operation on an API retry after SMTP acceptance", async () => {
  const { draft, prospect } = await prepared();
  const key = randomUUID();
  const operation = await queueSend(draft.id, draft.revision, key);
  await executeSend(operation.id, {
    submit: async () => ({ accepted: [prospect.email] }),
    preserve: async () => {},
  });
  const response = await POST(
    await request("send", "POST", {
      draftId: draft.id,
      revision: draft.revision,
      idempotencyKey: key,
      confirmed: true,
      recentContactConfirmed: false,
    }),
    { params: Promise.resolve({ path: ["send"] }) },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).id).toBe(operation.id);
  expect(await db.sendAttempt.count()).toBe(1);
});
it("erases queued history safely while preserving suppression against reimport", async () => {
  const { draft, prospect } = await prepared();
  await queueSend(draft.id, draft.revision, randomUUID());
  const response = await DELETE(
    await request(`prospects/${prospect.id}`, "DELETE", { confirmed: true }),
    { params: Promise.resolve({ path: ["prospects", prospect.id] }) },
  );
  expect(response.status).toBe(200);
  expect(await db.prospect.count()).toBe(0);
  expect(await db.sendAttempt.count()).toBe(0);
  expect(await db.message.count()).toBe(0);
  expect(
    await db.suppression.findUnique({ where: { email: prospect.email } }),
  ).not.toBeNull();
});
