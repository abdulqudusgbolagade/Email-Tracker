import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import { db } from "../src/lib/db";
import { hashPassword, login } from "../src/lib/auth";
import { csrfFor, digest, token } from "../src/lib/security";
import { POST as mcp } from "../src/app/api/mcp/route";
import { POST as api } from "../src/app/api/[...path]/route";
import { executeSend, saveDraft } from "../src/lib/sending";
import { syncTracking } from "../src/lib/tracking";
import { prepared } from "./helpers";
import { reviewReturn } from "../src/lib/review-link";

const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});
async function enable() {
  const owner = await db.owner.create({
    data: {
      email: "owner@example.test",
      passwordHash: await hashPassword("fixture-owner-123456"),
    },
  });
  const key = token();
  process.env.MCP_ENABLED = "true";
  process.env.MCP_ACCESS_TOKEN_HASH = digest(key);
  return { owner, key };
}
function request(
  key?: string,
  overrides: {
    host?: string;
    origin?: string;
    method?: string;
    data?: unknown;
    cookie?: string;
  } = {},
) {
  const method = overrides.method || "POST";
  return new Request("http://localhost:3000/api/mcp", {
    method,
    headers: {
      host: overrides.host || "localhost:3000",
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(overrides.origin ? { origin: overrides.origin } : {}),
      ...(overrides.cookie ? { cookie: overrides.cookie } : {}),
    },
    ...(method === "POST"
      ? {
          body: JSON.stringify(
            overrides.data || {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: "test", version: "1" },
              },
            },
          ),
        }
      : {}),
  });
}
async function connect(key: string) {
  const client = new Client({
    name: "grant-owner-controlled-test",
    version: "1.0.0",
  });
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3000/api/mcp"),
    {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
      fetch: async (url, init) => {
        const req = new Request(url, init);
        req.headers.set("host", "localhost:3000");
        return mcp(req);
      },
    },
  );
  await client.connect(transport);
  return client;
}
function draftInput(prospectId: string) {
  return {
    requestId: randomUUID(),
    prospectId,
    subject: "Hello {{first_name}}",
    html: "<p>Hello {{first_name}}, a note about {{book_title}}.</p>",
    text: "Hello {{first_name}}, a note about {{book_title}}.",
    tracking: false,
  };
}

it("is disabled by default and requires an owner even with a configured key", async () => {
  expect((await mcp(request())).status).toBe(503);
  process.env.MCP_ENABLED = "true";
  const key = token();
  process.env.MCP_ACCESS_TOKEN_HASH = digest(key);
  expect((await mcp(request(key))).status).toBe(503);
});
it("connects over a real local stdio process without an internet endpoint or protocol noise", async () => {
  await enable();
  const client = new Client({ name: "grant-local-test", version: "1.0.0" });
  clients.push(client);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/mcp.ts")],
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY!,
      APP_URL: "http://localhost:3000",
      MCP_ENABLED: "true",
      MCP_ACCESS_TOKEN_HASH: process.env.MCP_ACCESS_TOKEN_HASH!,
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  expect((await client.listTools()).tools).toHaveLength(6);
  const result = await client.callTool({
    name: "grant_get_setup",
    arguments: {},
  });
  expect(result.isError).not.toBe(true);
  expect(
    (result.structuredContent as { mcp: { publicHttps: boolean } }).mcp
      .publicHttps,
  ).toBe(false);
});
it("keeps review links through login without accepting external redirects or arbitrary routes", () => {
  expect(reviewReturn("/compose?draft=mcp-1234")).toBe(
    "/compose?draft=mcp-1234",
  );
  for (const value of [
    "https://evil.example/compose?draft=id",
    "//evil.example/compose?draft=id",
    "/settings",
    "/compose?draft=one&draft=two",
    "/compose?draft=id&next=https://evil.example",
    "/compose?draft=%0aevil",
    "/compose?draft=id#fragment",
  ]) {
    expect(reviewReturn(value)).toBe("/overview");
  }
});
it("rejects missing, incorrect and rotated keys and does not accept browser sessions as MCP credentials", async () => {
  const { key } = await enable();
  const cookie = `grant_session=${await login("owner@example.test", "fixture-owner-123456")}`;
  for (const req of [
    request(),
    request(token()),
    request(undefined, { cookie }),
  ]) {
    const response = await mcp(req);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  process.env.MCP_ACCESS_TOKEN_HASH = digest(token());
  expect((await mcp(request(key))).status).toBe(401);
});
it("rejects DNS rebinding, foreign browser origins and plaintext public configuration", async () => {
  const { key } = await enable();
  expect((await mcp(request(key, { host: "evil.example" }))).status).toBe(403);
  expect(
    (await mcp(request(key, { origin: "https://evil.example" }))).status,
  ).toBe(403);
  process.env.APP_URL = "http://public.example";
  try {
    expect((await mcp(request(key, { host: "public.example" }))).status).toBe(
      503,
    );
  } finally {
    process.env.APP_URL = "http://localhost:3000";
  }
});
it("bounds request bodies, rejects batches and supports stateless JSON only", async () => {
  const { key } = await enable();
  expect((await mcp(request(key, { method: "GET" }))).status).toBe(405);
  expect(
    (
      await mcp(
        request(key, {
          data: [{ jsonrpc: "2.0", id: 1, method: "tools/list" }],
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await mcp(request(key, { data: { value: "x".repeat(512_000) } }))).status,
  ).toBe(413);
  const req = request(key);
  req.headers.set("content-type", "text/plain");
  expect((await mcp(req)).status).toBe(415);
});
it("enforces the database-backed integration request limit", async () => {
  const { key } = await enable();
  await db.appSettings.create({ data: { id: "singleton", requestLimit: 1 } });
  expect((await mcp(request(key))).status).toBe(200);
  expect((await mcp(request(key, { method: "GET" }))).status).toBe(429);
});
it("negotiates through the official SDK client and exposes no sending bypass or credential values", async () => {
  await prepared();
  const { key } = await enable();
  const client = await connect(key);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(6);
  expect(tools.map((t) => t.name)).toContain("grant_prepare_outreach");
  expect(tools.some((t) => /^(send|grant_send)/.test(t.name))).toBe(false);
  const result = await client.callTool({
    name: "grant_get_setup",
    arguments: {},
  });
  const content = JSON.stringify(result);
  expect(content).toContain("owner@example.test");
  expect(content).not.toContain("fixture-password-only");
  expect(content).not.toContain("encryptedPassword");
  expect(content).not.toContain(key);
  expect(content).not.toContain(digest(key));
});
it("adds and searches prospects while preserving normalization, duplicates and suppression", async () => {
  const { key } = await enable();
  const client = await connect(key);
  await db.suppression.create({
    data: { email: "stopped@example.test", reason: "Owner opt-out" },
  });
  const input = { fullName: "Stopped Author", email: " Stopped@Example.test " };
  const created = await client.callTool({
    name: "grant_add_prospect",
    arguments: input,
  });
  expect(created.structuredContent).toMatchObject({
    email: "stopped@example.test",
    status: "Do Not Contact",
  });
  const duplicate = await client.callTool({
    name: "grant_add_prospect",
    arguments: input,
  });
  expect(duplicate.isError).toBe(true);
  const found = await client.callTool({
    name: "grant_find_prospects",
    arguments: { query: "stopped" },
  });
  expect(
    (found.structuredContent as { prospects: { status: string }[] }).prospects,
  ).toHaveLength(1);
  expect(
    (found.structuredContent as { prospects: { status: string }[] })
      .prospects[0].status,
  ).toBe("Do Not Contact");
  expect(await db.sendAttempt.count()).toBe(0);
});
it("prepares a personalized draft without queueing SMTP and deduplicates concurrent retries", async () => {
  const { prospect } = await prepared();
  const { key } = await enable();
  const client = await connect(key);
  const input = draftInput(prospect.id);
  const results = await Promise.all(
    [0, 1].map(() =>
      client.callTool({ name: "grant_prepare_outreach", arguments: input }),
    ),
  );
  const first = results[0].structuredContent as {
    draftId: string;
    approvalRequired: boolean;
    preview: { subject: string; html: string };
    reviewUrl: string;
  };
  expect(results[0].isError).not.toBe(true);
  expect((results[1].structuredContent as { draftId: string }).draftId).toBe(
    first.draftId,
  );
  expect(first.preview.subject).toBe("Hello Test");
  expect(first.preview.html).not.toContain("<img");
  expect(first.approvalRequired).toBe(true);
  expect(first.reviewUrl).toContain(`/compose?draft=${first.draftId}`);
  expect(await db.sendAttempt.count()).toBe(0);
  expect(await db.message.count()).toBe(0);
  const reused = await client.callTool({
    name: "grant_prepare_outreach",
    arguments: { ...input, subject: "Different content" },
  });
  expect(reused.isError).toBe(true);
  expect(JSON.stringify(reused)).toContain(
    "requestId belongs to different outreach",
  );
  const unconfigured = await client.callTool({
    name: "grant_prepare_outreach",
    arguments: { ...draftInput(prospect.id), tracking: true },
  });
  expect(unconfigured.structuredContent).toMatchObject({
    trackingRequested: true,
    trackingServiceConfigured: false,
    approvalRequired: true,
  });
  expect(await db.sendAttempt.count()).toBe(0);
});
it("keeps owner edits on retried preparation and blocks suppressed contacts", async () => {
  const { prospect } = await prepared();
  const { key } = await enable();
  const client = await connect(key);
  const input = draftInput(prospect.id);
  const result = await client.callTool({
    name: "grant_prepare_outreach",
    arguments: input,
  });
  const { draftId } = result.structuredContent as { draftId: string };
  const draft = await db.draft.findUniqueOrThrow({ where: { id: draftId } });
  await saveDraft({ ...draft, subject: "Owner edited this" });
  const retried = await client.callTool({
    name: "grant_prepare_outreach",
    arguments: input,
  });
  expect(
    (retried.structuredContent as { preview: { subject: string } }).preview
      .subject,
  ).toBe("Owner edited this");
  await db.suppression.create({
    data: { email: prospect.email, reason: "Owner stopped contact" },
  });
  const blocked = await client.callTool({
    name: "grant_prepare_outreach",
    arguments: draftInput(prospect.id),
  });
  expect(blocked.isError).toBe(true);
  expect(await db.sendAttempt.count()).toBe(0);
});
it("routes owner-approved tracked outreach through the existing retry-safe queue and reports signals without claiming a read", async () => {
  const { prospect } = await prepared();
  const { key } = await enable();
  const client = await connect(key);
  process.env.TRACKING_BASE_URL = "https://tracking.example.test";
  process.env.TRACKING_SYNC_SECRET = token();
  vi.stubGlobal("fetch", async () =>
    Response.json({ events: [], cursor: 0, more: false }),
  );
  const result = await client.callTool({
    name: "grant_prepare_outreach",
    arguments: { ...draftInput(prospect.id), tracking: true },
  });
  const draft = result.structuredContent as {
    draftId: string;
    revision: number;
  };
  const params = { params: Promise.resolve({ path: ["send"] }) };
  const sendBody = {
    draftId: draft.draftId,
    revision: draft.revision,
    idempotencyKey: randomUUID(),
    confirmed: true,
    recentContactConfirmed: false,
  };
  const bypass = new Request("http://localhost:3000/api/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(sendBody),
  });
  expect((await api(bypass, params)).status).toBe(401);
  const raw = await login("owner@example.test", "fixture-owner-123456");
  const confirmation = () =>
    new Request("http://localhost:3000/api/send", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `grant_session=${raw}`,
        "x-csrf-token": csrfFor(raw),
        "content-type": "application/json",
      },
      body: JSON.stringify(sendBody),
    });
  const approved = await api(confirmation(), params);
  expect(approved.status).toBe(200);
  const operation = await approved.json();
  expect((await (await api(confirmation(), params)).json()).id).toBe(
    operation.id,
  );
  const message = await db.message.findFirstOrThrow();
  const mime = await simpleParser(Buffer.from(message.rawMime!));
  expect(String(mime.html).match(/\/p\//g)).toHaveLength(1);
  const submit = vi.fn(async () => ({ accepted: [prospect.email] }));
  await executeSend(operation.id, { submit, preserve: async () => {} });
  await executeSend(operation.id, { submit, preserve: async () => {} });
  expect(submit).toHaveBeenCalledTimes(1);
  const status = await client.callTool({
    name: "grant_get_outreach_status",
    arguments: { draftId: draft.draftId },
  });
  expect(JSON.stringify(status)).toContain("SMTP Accepted");
  expect(JSON.stringify(status)).toContain("Unconfirmed");
  vi.stubGlobal("fetch", async () =>
    Response.json({
      events: [
        {
          seq: 1,
          id: "mcp-signal-1",
          kind: "signal",
          token_hash: message.trackingHash,
          occurred_at: new Date().toISOString(),
          category: "proxy-possible",
        },
      ],
      cursor: 1,
      more: false,
    }),
  );
  await syncTracking();
  const activity = await client.callTool({
    name: "grant_get_prospect_activity",
    arguments: { prospectId: prospect.id },
  });
  const data = activity.structuredContent as {
    messages: {
      openSignalStatus: string;
      readingConfirmed: boolean;
      signalCount: number;
    }[];
  };
  expect(data.messages[0]).toMatchObject({
    openSignalStatus: "Open signal recorded",
    readingConfirmed: false,
    signalCount: 1,
  });
  expect(JSON.stringify(activity)).not.toContain(message.trackingHash);
});
