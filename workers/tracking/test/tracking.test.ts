import { SELF, env } from "cloudflare:test";
import { it, expect, vi, beforeEach } from "vitest";
import handler, { category, sha, validToken } from "../src/index";
import type { Env } from "../src/index";
const raw = "a".repeat(43);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM registrations"),
    env.DB.prepare("DELETE FROM nonces"),
  ]);
});
async function signed(path: string, data: unknown, offset = 0) {
  const body = JSON.stringify(data);
  const stamp = String(Date.now() + offset);
  const nonce = crypto.randomUUID();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SYNC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${stamp}\n${nonce}\nPOST\n${path}\n${body}`),
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return new Request(`https://worker.example${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": stamp,
      "x-nonce": nonce,
      "x-signature": signature,
    },
    body,
  });
}
async function register(kind = "signal") {
  const request = await signed("/admin/register", {
    hash: await sha(raw),
    kind,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  expect((await SELF.fetch(request)).status).toBe(200);
}
it("validates opaque tokens and never identifies a request as definitely human", () => {
  expect(validToken(raw)).toBe(true);
  expect(validToken("recipient@example.com")).toBe(false);
  expect(validToken("../invalid")).toBe(false);
  expect(category("GoogleImageProxy")).toBe("proxy-possible");
  expect(category("ScannerBot")).toBe("automation-possible");
  expect(category("Browser")).toBe("unclassified");
});
it("returns a valid image for invalid tokens, HEAD requests and logging failure", async () => {
  const invalid = await SELF.fetch("https://worker.example/p/invalid.gif");
  expect(invalid.status).toBe(200);
  expect(invalid.headers.get("content-type")).toBe("image/gif");
  expect(new Uint8Array(await invalid.arrayBuffer()).slice(0, 6)).toEqual(
    new TextEncoder().encode("GIF89a"),
  );
  const head = await SELF.fetch(`https://worker.example/p/${raw}.gif`, {
    method: "HEAD",
  });
  expect((await head.arrayBuffer()).byteLength).toBe(0);
  const broken = {
    ...env,
    DB: {
      prepare() {
        throw new Error("fixture outage");
      },
    },
    SIGNAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  } as unknown as Env;
  const result = await handler.fetch!(
    new Request(`https://worker.example/p/${raw}.gif`) as never,
    broken,
    {} as never,
  );
  expect(result.status).toBe(200);
});
it("registers hashes, deduplicates pixel events and returns cursor pages", async () => {
  await register();
  for (let i = 0; i < 3; i++)
    expect(
      (
        await SELF.fetch(`https://worker.example/p/${raw}.gif`, {
          headers: { "user-agent": "GoogleImageProxy" },
        })
      ).status,
    ).toBe(200);
  const result = await SELF.fetch(
    await signed("/admin/changes", { cursor: 0 }),
  );
  const body = (await result.json()) as {
    events: { token_hash: string; category: string }[];
    cursor: number;
  };
  expect(body.events).toHaveLength(1);
  expect(body.events[0].token_hash).toBe(await sha(raw));
  expect(body.events[0].category).toBe("proxy-possible");
  expect(body.cursor).toBeGreaterThan(0);
  const next = (await (
    await SELF.fetch(await signed("/admin/changes", { cursor: body.cursor }))
  ).json()) as { events: unknown[] };
  expect(next.events).toHaveLength(0);
});
it("rejects unauthorized writes, expired signatures, modified bodies and replay", async () => {
  expect(
    (
      await SELF.fetch("https://worker.example/admin/register", {
        method: "POST",
        body: "{}",
      })
    ).status,
  ).toBe(401);
  const expired = await signed("/admin/changes", { cursor: 0 }, -600001);
  expect((await SELF.fetch(expired)).status).toBe(401);
  const original = await signed("/admin/changes", { cursor: 0 });
  const replay = original.clone();
  expect((await SELF.fetch(original)).status).toBe(200);
  expect((await SELF.fetch(replay as unknown as Request)).status).toBe(401);
  const good = await signed("/admin/changes", { cursor: 0 });
  const modified = new Request(good.url, {
    method: "POST",
    headers: good.headers,
    body: '{"cursor":500}',
  });
  expect((await SELF.fetch(modified)).status).toBe(401);
});
it("requires an explicit unsubscribe POST and exports the opt-out once", async () => {
  await register("optout");
  expect((await SELF.fetch(`https://worker.example/u/${raw}`)).status).toBe(
    200,
  );
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS n FROM events").first<{
        n: number;
      }>()
    )?.n,
  ).toBe(0);
  expect(
    (
      await SELF.fetch(`https://worker.example/u/${raw}`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "confirm=yes",
      })
    ).status,
  ).toBe(403);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await SELF.fetch(`https://worker.example/u/${raw}`, {
          method: "POST",
          headers: {
            origin: "https://worker.example",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "confirm=yes",
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = ?")
        .bind("optout")
        .first<{ n: number }>()
    )?.n,
  ).toBe(1);
});
it("revokes registrations and deletes associated events", async () => {
  await register();
  await SELF.fetch(`https://worker.example/p/${raw}.gif`);
  expect(
    (
      await SELF.fetch(
        await signed("/admin/delete", { hashes: [await sha(raw)] }),
      )
    ).status,
  ).toBe(200);
  await SELF.fetch(`https://worker.example/p/${raw}.gif`);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS n FROM events").first<{
        n: number;
      }>()
    )?.n,
  ).toBe(0);
});
it("prunes expired events, registrations and replay nonces", async () => {
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  await env.DB.prepare(
    "INSERT INTO registrations(token_hash,kind,expires_at) VALUES (?,?,?)",
  )
    .bind(await sha(raw), "signal", old)
    .run();
  await env.DB.prepare(
    "INSERT INTO events(id,token_hash,kind,occurred_at,category,dedup_key) VALUES (?,?,?,?,?,?)",
  )
    .bind("old-event", await sha(raw), "signal", old, "unclassified", "old")
    .run();
  await env.DB.prepare("INSERT INTO nonces(nonce,expires_at) VALUES (?,?)")
    .bind("old-nonce", Date.now() - 1)
    .run();
  await handler.scheduled!({} as never, env, {} as never);
  for (const table of ["events", "registrations", "nonces"])
    expect(
      (
        await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
});
