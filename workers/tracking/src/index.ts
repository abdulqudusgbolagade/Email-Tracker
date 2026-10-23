import type {
  D1Database,
  RateLimit,
  ExportedHandler,
} from "@cloudflare/workers-types";
export interface Env {
  DB: D1Database;
  SYNC_SECRET: string;
  SIGNAL_LIMITER: RateLimit;
}
const GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hashPattern = /^[a-f0-9]{64}$/;
export const validToken = (value: string) => tokenPattern.test(value);
export async function sha(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function category(ua: string) {
  if (/bot|crawler|scanner|security|prefetch/i.test(ua))
    return "automation-possible";
  if (/googleimageproxy|proxy|apple mail privacy/i.test(ua))
    return "proxy-possible";
  return "unclassified";
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
async function allowed(request: Request, env: Env, tokenHash: string) {
  const ipKey = await sha(
    `${env.SYNC_SECRET}:${new Date().toISOString().slice(0, 10)}:${request.headers.get("cf-connecting-ip") || "local"}`,
  );
  const [ip, token] = await Promise.all([
    env.SIGNAL_LIMITER.limit({ key: `ip:${ipKey}` }),
    env.SIGNAL_LIMITER.limit({ key: `token:${tokenHash}` }),
  ]);
  return ip.success && token.success;
}
async function pixel(request: Request, raw: string, env: Env) {
  try {
    if (request.method === "GET" && validToken(raw)) {
      const hash = await sha(raw);
      if (await allowed(request, env, hash)) {
        const registration = await env.DB.prepare(
          "SELECT kind FROM registrations WHERE token_hash = ? AND expires_at > ?",
        )
          .bind(hash, new Date().toISOString())
          .first<{ kind: string }>();
        if (registration?.kind === "signal") {
          const at = new Date();
          const classification = category(
            request.headers.get("user-agent") || "",
          );
          const dedup = `${hash}:${Math.floor(at.getTime() / 60000)}:${classification}`;
          await env.DB.prepare(
            "INSERT OR IGNORE INTO events (id,token_hash,kind,occurred_at,category,dedup_key) VALUES (?,?,?,?,?,?)",
          )
            .bind(
              crypto.randomUUID(),
              hash,
              "signal",
              at.toISOString(),
              classification,
              dedup,
            )
            .run();
        }
      }
    }
  } catch {
    /* Logging failure must never break image rendering. */
  }
  return new Response(request.method === "HEAD" ? null : GIF, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
      expires: "0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
async function authenticate(request: Request, env: Env, body: string) {
  if (!env.SYNC_SECRET || env.SYNC_SECRET.length < 32) return false;
  const stamp = request.headers.get("x-timestamp") || "";
  const nonce = request.headers.get("x-nonce") || "";
  const signature = request.headers.get("x-signature") || "";
  if (
    !/^\d{13}$/.test(stamp) ||
    Math.abs(Date.now() - Number(stamp)) > 5 * 60000 ||
    !/^[a-f0-9-]{36}$/.test(nonce) ||
    !hashPattern.test(signature)
  )
    return false;
  const path = new URL(request.url).pathname;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SYNC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.match(/../g)!, (x) =>
    parseInt(x, 16),
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(
      `${stamp}\n${nonce}\n${request.method}\n${path}\n${body}`,
    ),
  );
  if (!valid) return false;
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO nonces(nonce,expires_at) VALUES (?,?)",
  )
    .bind(nonce, Date.now() + 10 * 60000)
    .run();
  return result.meta.changes === 1;
}
async function admin(request: Request, env: Env) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const body = await request.text();
  if (body.length > 20000) return json({ error: "Body too large" }, 413);
  if (!(await authenticate(request, env, body)))
    return json({ error: "Unauthorized" }, 401);
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const path = new URL(request.url).pathname;
  if (path === "/admin/register") {
    const { hash, kind, expiresAt } = input;
    if (
      typeof hash !== "string" ||
      !hashPattern.test(hash) ||
      !["signal", "optout"].includes(String(kind)) ||
      typeof expiresAt !== "string" ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now() ||
      Date.parse(expiresAt) > Date.now() + 181 * 86400000
    )
      return json({ error: "Invalid registration" }, 400);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO registrations(token_hash,kind,expires_at) VALUES (?,?,?)",
    )
      .bind(hash, kind, expiresAt)
      .run();
    return json({ ok: true });
  }
  if (path === "/admin/changes") {
    const cursor = input.cursor;
    if (
      typeof cursor !== "number" ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0
    )
      return json({ error: "Invalid cursor" }, 400);
    const results = await env.DB.prepare(
      "SELECT seq,id,token_hash,kind,occurred_at,category FROM events WHERE seq > ? ORDER BY seq LIMIT 201",
    )
      .bind(cursor)
      .all();
    const events = results.results.slice(0, 200);
    return json({
      events,
      cursor: events.length ? events[events.length - 1].seq : cursor,
      more: results.results.length > 200,
    });
  }
  if (path === "/admin/delete") {
    if (
      !Array.isArray(input.hashes) ||
      input.hashes.length > 20 ||
      !input.hashes.every((x) => typeof x === "string" && hashPattern.test(x))
    )
      return json({ error: "Invalid token hashes" }, 400);
    const statements = input.hashes.flatMap((hash) => [
      env.DB.prepare("DELETE FROM registrations WHERE token_hash = ?").bind(
        hash,
      ),
      env.DB.prepare("DELETE FROM events WHERE token_hash = ?").bind(hash),
    ]);
    if (statements.length) await env.DB.batch(statements);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
async function unsubscribe(request: Request, raw: string, env: Env) {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "x-content-type-options": "nosniff",
  };
  if (!validToken(raw))
    return new Response("Invalid unsubscribe link.", { status: 400, headers });
  const hash = await sha(raw);
  if (!(await allowed(request, env, hash)))
    return new Response("Please retry shortly.", { status: 429, headers });
  const registration = await env.DB.prepare(
    "SELECT kind FROM registrations WHERE token_hash = ? AND expires_at > ?",
  )
    .bind(hash, new Date().toISOString())
    .first<{ kind: string }>();
  if (registration?.kind !== "optout")
    return new Response(
      "This link has expired. Reply “unsubscribe” to the original message.",
      { status: 410, headers },
    );
  let content =
    '<h1>Stop outreach from Grant Publishing Co.?</h1><p>Confirm below to request no further outreach. Opening this page alone changes nothing.</p><form method="post"><input type="hidden" name="confirm" value="yes"><button type="submit">Unsubscribe</button></form>';
  if (request.method === "POST") {
    if (
      request.headers.get("origin") !== new URL(request.url).origin ||
      (await request.formData()).get("confirm") !== "yes"
    )
      return new Response("Confirmation rejected.", { status: 403, headers });
    await env.DB.prepare(
      "INSERT OR IGNORE INTO events(id,token_hash,kind,occurred_at,category,dedup_key) VALUES (?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        hash,
        "optout",
        new Date().toISOString(),
        "confirmed-optout",
        `optout:${hash}`,
      )
      .run();
    content =
      "<h1>Unsubscribe recorded</h1><p>Your request will be applied before further outreach is sent through Grant Mail Tracker.</p>";
  } else if (request.method !== "GET")
    return new Response("Method not allowed", { status: 405, headers });
  return new Response(
    `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Grant Publishing Co. · Unsubscribe</title><style>body{font:17px system-ui;color:#182941;max-width:600px;margin:12vh auto;padding:24px;line-height:1.6}button{background:#182941;color:white;border:0;border-radius:6px;padding:12px 20px;font:inherit;cursor:pointer}</style><main>${content}</main></html>`,
    { headers },
  );
}
const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const match = path.match(/^\/p\/(.*)\.gif$/);
    if (match) return pixel(request, match[1], env);
    try {
      if (path.startsWith("/admin/")) return await admin(request, env);
      if (path.startsWith("/u/"))
        return await unsubscribe(request, path.slice(3), env);
      if (path === "/health") return json({ ok: true });
      return json({ error: "Not found" }, 404);
    } catch {
      return json({ error: "Service unavailable" }, 503);
    }
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM events WHERE occurred_at < ?").bind(
        new Date(Date.now() - 90 * 86400000).toISOString(),
      ),
      env.DB.prepare("DELETE FROM registrations WHERE expires_at < ?").bind(
        new Date().toISOString(),
      ),
      env.DB.prepare("DELETE FROM nonces WHERE expires_at < ?").bind(
        Date.now(),
      ),
    ]);
  },
};
export default handler;
