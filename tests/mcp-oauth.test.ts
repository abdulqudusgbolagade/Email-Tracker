import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../src/lib/db";
import { hashPassword, login } from "../src/lib/auth";
import { csrfFor, digest, token } from "../src/lib/security";
import {
  oauthRoute,
  MCP_SCOPE,
  verifyMcpOAuthToken,
  revokeConnection,
  cleanupOAuth,
} from "../src/lib/mcp-oauth";
import { POST as mcp } from "../src/app/api/mcp/route";
import { DELETE as api } from "../src/app/api/[...path]/route";
import { GET as metadataRoute } from "../src/app/.well-known/oauth-authorization-server/route";
import { GET as resourceRoute } from "../src/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { reviewReturn } from "../src/lib/review-link";
import { snapshot } from "../src/lib/data";

const origin = "https://grant.example.test";
const endpoint = origin + "/api/mcp";
const callback = "https://chatgpt.com/connector_platform/oauth_redirect";
afterEach(() => {
  process.env.APP_URL = "http://localhost:3000";
});
async function enable() {
  process.env.APP_URL = origin;
  process.env.MCP_ENABLED = "true";
  process.env.MCP_OAUTH_ENABLED = "true";
  const owner = await db.owner.create({
    data: {
      email: "owner@example.test",
      passwordHash: await hashPassword("fixture-owner-123456"),
    },
  });
  const raw = await login(owner.email, "fixture-owner-123456");
  return { owner, raw };
}
function req(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(origin + path, {
    method,
    headers: { host: new URL(origin).host, ...headers },
    ...(body !== undefined
      ? { body: typeof body === "string" ? body : JSON.stringify(body) }
      : {}),
  });
}
async function register(method = "none", redirects = [callback]) {
  const response = await oauthRoute(
    req(
      "/api/mcp/oauth/register",
      "POST",
      {
        client_name: "Controlled Codex test",
        redirect_uris: redirects,
        token_endpoint_auth_method: method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { "content-type": "application/json" },
    ),
    "register",
  );
  expect(response.status).toBe(201);
  return response.json() as Promise<{
    client_id: string;
    client_secret?: string;
  }>;
}
async function start(clientId: string, overrides: Record<string, string> = {}) {
  const verifier = token() + token();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    resource: endpoint,
    scope: MCP_SCOPE,
    state: "controlled-state",
    ...overrides,
  });
  const response = await oauthRoute(
    req(`/api/mcp/oauth/authorize?${params}`),
    "authorize",
  );
  return {
    verifier,
    response,
    requestId: response.headers.get("location")
      ? new URL(response.headers.get("location")!).searchParams.get("request")!
      : "",
  };
}
async function decide(
  raw: string,
  requestId: string,
  allow = true,
  headers: Record<string, string> = {},
) {
  return oauthRoute(
    req(
      "/api/mcp/oauth/consent",
      "POST",
      { requestId, allow },
      {
        "content-type": "application/json",
        cookie: `grant_session=${raw}`,
        origin,
        "x-csrf-token": csrfFor(raw),
        ...headers,
      },
    ),
    "consent",
  );
}
async function exchange(
  params: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return oauthRoute(
    req(
      "/api/mcp/oauth/token",
      "POST",
      new URLSearchParams(params).toString(),
      { "content-type": "application/x-www-form-urlencoded", ...headers },
    ),
    "token",
  );
}
async function grant(raw: string, method = "none") {
  const client = await register(method);
  const started = await start(client.client_id);
  expect(started.response.status).toBe(303);
  const response = await decide(raw, started.requestId);
  expect(response.status).toBe(200);
  const callbackUrl = new URL((await response.json()).redirectUrl);
  const code = callbackUrl.searchParams.get("code")!;
  const params = {
    grant_type: "authorization_code",
    client_id: client.client_id,
    code,
    code_verifier: started.verifier,
    redirect_uri: callback,
    resource: endpoint,
  };
  return { client, started, code, params, callbackUrl };
}

it("keeps discovery disabled by default and publishes resource-bound OAuth metadata when enabled", async () => {
  expect(
    (await metadataRoute(req("/.well-known/oauth-authorization-server")))
      .status,
  ).toBe(503);
  await enable();
  const response = await metadataRoute(
    req("/.well-known/oauth-authorization-server"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    issuer: origin,
    code_challenge_methods_supported: ["S256"],
    response_types_supported: ["code"],
  });
  const metadata = await resourceRoute(
    req("/.well-known/oauth-protected-resource/api/mcp"),
    { params: Promise.resolve({ path: ["api", "mcp"] }) },
  );
  expect(await metadata.json()).toMatchObject({
    resource: endpoint,
    scopes_supported: [MCP_SCOPE],
  });
  expect(
    (
      await resourceRoute(req("/.well-known/oauth-protected-resource/other"), {
        params: Promise.resolve({ path: ["other"] }),
      })
    ).status,
  ).toBe(404);
  const unauthenticated = await mcp(req("/api/mcp", "POST", {}));
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get("www-authenticate")).toContain(
    "resource_metadata=",
  );
  expect(
    (await oauthRoute(req("/api/mcp/oauth/token", "OPTIONS"), "token")).status,
  ).toBe(204);
});
it("rejects untrusted, plaintext and malicious callback registrations without fetching their URLs", async () => {
  await enable();
  for (const uri of [
    "https://evil.example/callback",
    "http://chatgpt.com/callback",
    "https://chatgpt.com.evil.example/callback",
    "https://user:secret@chatgpt.com/callback",
    callback + "#fragment",
  ]) {
    const response = await oauthRoute(
      req(
        "/api/mcp/oauth/register",
        "POST",
        { redirect_uris: [uri], token_endpoint_auth_method: "none" },
        { "content-type": "application/json" },
      ),
      "register",
    );
    expect(response.status).toBe(400);
  }
  expect(await db.mcpOAuthClient.count()).toBe(0);
});
it("enforces exact callbacks, PKCE, supported scope/audience and parameter uniqueness before redirecting", async () => {
  await enable();
  const client = await register();
  const invalidInputs: Record<string, string>[] = [
    { redirect_uri: callback + "?changed=1" },
    { code_challenge_method: "plain" },
    { code_challenge: "weak" },
    { resource: "https://evil.example/api/mcp" },
    { scope: "mailbox:password" },
    { response_type: "token" },
  ];
  for (const input of invalidInputs) {
    const { response } = await start(client.client_id, input);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  }
  const repeat = await oauthRoute(
    req("/api/mcp/oauth/authorize?client_id=one&client_id=two"),
    "authorize",
  );
  expect(repeat.status).toBe(400);
  expect(await db.mcpOAuthRequest.count()).toBe(0);
});
it("requires owner session, same origin, CSRF and an explicit one-time consent decision", async () => {
  const { raw } = await enable();
  const { client_id } = await register();
  const started = await start(client_id);
  expect(await db.mcpOAuthGrant.count()).toBe(0);
  expect((await decide("invalid-session", started.requestId)).status).toBe(401);
  expect(
    (
      await decide(raw, started.requestId, true, {
        origin: "https://evil.example",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await decide(raw, started.requestId, true, {
        "x-csrf-token": "incorrect",
      })
    ).status,
  ).toBe(403);
  const response = await decide(raw, started.requestId, false);
  const redirectUrl = new URL((await response.json()).redirectUrl);
  expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
  expect(redirectUrl.searchParams.get("state")).toBe("controlled-state");
  expect(redirectUrl.searchParams.get("iss")).toBe(origin);
  expect((await decide(raw, started.requestId)).status).toBe(410);
  expect(await db.mcpOAuthGrant.count()).toBe(0);
  expect(await db.sendAttempt.count()).toBe(0);
});
it("binds codes to client, callback, audience and PKCE and persists only hashed secrets", async () => {
  const { raw, owner } = await enable();
  const { params, code, client } = await grant(raw);
  const other = await register();
  for (const override of [
    { code_verifier: token() },
    { client_id: other.client_id },
    { redirect_uri: callback + "?changed" },
    { resource: "https://other.example/api/mcp" },
  ]) {
    expect((await exchange({ ...params, ...override })).status).toBe(400);
  }
  const result = await exchange(params);
  expect(result.status).toBe(200);
  const tokens = await result.json();
  expect(await verifyMcpOAuthToken(tokens.access_token)).toEqual({
    id: owner.id,
  });
  expect(await verifyMcpOAuthToken(tokens.refresh_token)).toBeNull();
  const rows = JSON.stringify({
    requests: await db.mcpOAuthRequest.findMany(),
    tokens: await db.mcpOAuthToken.findMany(),
    clients: await db.mcpOAuthClient.findMany(),
  });
  for (const secret of [code, tokens.access_token, tokens.refresh_token])
    expect(rows).not.toContain(secret);
  expect(rows).toContain(digest(code));
  expect(tokens.access_token).not.toBe(tokens.refresh_token);
  expect(client.client_secret).toBeUndefined();
});
it("authenticates confidential clients with registered post/basic methods and never accepts a wrong secret", async () => {
  const { raw } = await enable();
  for (const method of ["client_secret_post", "client_secret_basic"]) {
    const { params, client } = await grant(raw, method);
    expect((await exchange({ ...params, client_secret: "wrong" })).status).toBe(
      401,
    );
    const headers: Record<string, string> =
      method === "client_secret_basic"
        ? {
            authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`,
          }
        : {};
    const response = await exchange(
      {
        ...params,
        ...(method === "client_secret_post"
          ? { client_secret: client.client_secret! }
          : {}),
      },
      headers,
    );
    expect(response.status).toBe(200);
    expect(
      (
        await db.mcpOAuthClient.findUniqueOrThrow({
          where: { id: client.client_id },
        })
      ).secretHash,
    ).toBe(digest(client.client_secret!));
  }
});
it("consumes concurrent code exchanges only once and revokes a grant on code reuse", async () => {
  const { raw } = await enable();
  const { params } = await grant(raw);
  const responses = await Promise.all([exchange(params), exchange(params)]);
  expect(responses.map((x) => x.status).sort()).toEqual([200, 400]);
  expect(await db.mcpOAuthGrant.count()).toBe(1);
  expect(await db.mcpOAuthToken.count()).toBe(2);
  const successful = await responses.find((x) => x.status === 200)!.json();
  expect(await verifyMcpOAuthToken(successful.access_token)).toBeNull();
});
it("rotates refresh tokens, retires old access tokens and revokes the family on refresh replay", async () => {
  const { raw } = await enable();
  const { params, client } = await grant(raw);
  const first = await (await exchange(params)).json();
  const refreshParams = {
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: first.refresh_token,
    resource: endpoint,
  };
  const secondResponse = await exchange(refreshParams);
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json();
  expect(second.refresh_token).not.toBe(first.refresh_token);
  expect(await verifyMcpOAuthToken(first.access_token)).toBeNull();
  expect(await verifyMcpOAuthToken(second.access_token)).not.toBeNull();
  expect((await exchange(refreshParams)).status).toBe(400);
  expect(await verifyMcpOAuthToken(second.access_token)).toBeNull();
  expect(
    (await exchange({ ...refreshParams, refresh_token: second.refresh_token }))
      .status,
  ).toBe(400);
});
it("retains replay evidence for active grants and cleans expired grants, tokens and unused registrations", async () => {
  const { raw } = await enable();
  const { params, client } = await grant(raw);
  const tokens = await (await exchange(params)).json();
  const refreshed = await (
    await exchange({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
    })
  ).json();
  await cleanupOAuth();
  expect(await verifyMcpOAuthToken(refreshed.access_token)).not.toBeNull();
  expect(
    (
      await db.mcpOAuthToken.findUniqueOrThrow({
        where: { hash: digest(tokens.refresh_token) },
      })
    ).usedAt,
  ).not.toBeNull();
  await db.mcpOAuthGrant.updateMany({ data: { expiresAt: new Date(0) } });
  expect(
    (
      await exchange({
        grant_type: "refresh_token",
        client_id: client.client_id,
        refresh_token: refreshed.refresh_token,
      })
    ).status,
  ).toBe(400);
  await db.mcpOAuthClient.updateMany({ data: { createdAt: new Date(0) } });
  await db.mcpOAuthRequest.updateMany({ data: { expiresAt: new Date(0) } });
  await cleanupOAuth();
  expect(await db.mcpOAuthGrant.count()).toBe(0);
  expect(await db.mcpOAuthToken.count()).toBe(0);
  expect(await db.mcpOAuthClient.count()).toBe(0);
});
it("enforces expiry and origin changes, supports revocation, and keeps connection data free of secrets", async () => {
  const { raw, owner } = await enable();
  const { params, client } = await grant(raw);
  const tokens = await (await exchange(params)).json();
  const data = await snapshot();
  expect(data.mcpConnections).toHaveLength(1);
  expect(JSON.stringify(data)).not.toContain(tokens.access_token);
  process.env.APP_URL = "https://changed.example.test";
  expect(await verifyMcpOAuthToken(tokens.access_token)).toBeNull();
  process.env.APP_URL = origin;
  await db.mcpOAuthToken.update({
    where: { hash: digest(tokens.access_token) },
    data: { expiresAt: new Date(0) },
  });
  expect(await verifyMcpOAuthToken(tokens.access_token)).toBeNull();
  const refreshed = await (
    await exchange({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
    })
  ).json();
  expect(await verifyMcpOAuthToken(refreshed.access_token)).not.toBeNull();
  await revokeConnection(owner.id, data.mcpConnections[0].id);
  expect(await verifyMcpOAuthToken(refreshed.access_token)).toBeNull();
});
it("limits token revocation to the authenticated client and protects owner revocation with browser authorization", async () => {
  const { raw } = await enable();
  const { params, client } = await grant(raw);
  const tokens = await (await exchange(params)).json();
  const other = await register();
  async function revokeAs(id: string) {
    return oauthRoute(
      req(
        "/api/mcp/oauth/revoke",
        "POST",
        new URLSearchParams({
          client_id: id,
          token: tokens.refresh_token,
        }).toString(),
        { "content-type": "application/x-www-form-urlencoded" },
      ),
      "revoke",
    );
  }
  expect((await revokeAs(other.client_id)).status).toBe(200);
  expect(await verifyMcpOAuthToken(tokens.access_token)).not.toBeNull();
  const connection = (await snapshot()).mcpConnections[0];
  const path = ["mcp", "connections", connection.id];
  expect(
    (
      await api(
        req(`/api/${path.join("/")}`, "DELETE", undefined, {
          authorization: `Bearer ${tokens.access_token}`,
        }),
        { params: Promise.resolve({ path }) },
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await api(
        req(`/api/${path.join("/")}`, "DELETE", undefined, {
          cookie: `grant_session=${raw}`,
          origin,
          "x-csrf-token": csrfFor(raw),
        }),
        { params: Promise.resolve({ path }) },
      )
    ).status,
  ).toBe(200);
  expect(await verifyMcpOAuthToken(tokens.access_token)).toBeNull();
  expect((await revokeAs(client.client_id)).status).toBe(200);
});
it("expires approval requests/codes, bounds bodies/methods/hosts, and rejects browser cookies as MCP tokens", async () => {
  const { raw } = await enable();
  const { params, started } = await grant(raw);
  await db.mcpOAuthRequest.update({
    where: { id: started.requestId },
    data: { codeExpiresAt: new Date(0) },
  });
  expect((await exchange(params)).status).toBe(400);
  const other = await start(params.client_id);
  await db.mcpOAuthRequest.update({
    where: { id: other.requestId },
    data: { expiresAt: new Date(0) },
  });
  expect((await decide(raw, other.requestId)).status).toBe(410);
  expect((await oauthRoute(req("/api/mcp/oauth/token"), "token")).status).toBe(
    405,
  );
  expect(
    (
      await oauthRoute(
        req("/api/mcp/oauth/token", "POST", "a".repeat(17_000), {
          "content-type": "application/x-www-form-urlencoded",
        }),
        "token",
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await oauthRoute(
        req("/.well-known/oauth-authorization-server", "GET", undefined, {
          host: "evil.example",
        }),
        "metadata",
      )
    ).status,
  ).toBe(403);
  expect(
    (await mcp(req("/api/mcp", "POST", {}, { cookie: `grant_session=${raw}` })))
      .status,
  ).toBe(401);
  expect(reviewReturn(`/mcp/authorize?request=${other.requestId}`)).toBe(
    `/mcp/authorize?request=${other.requestId}`,
  );
  expect(
    reviewReturn(
      `/mcp/authorize?request=${other.requestId}&next=https://evil.example`,
    ),
  ).toBe("/overview");
});
it("completes discovery, registration, PKCE and token exchange using the official SDK OAuth client, then lists the six tools", async () => {
  const { raw } = await enable();
  let information: OAuthClientInformationMixed | undefined;
  let tokens: OAuthTokens | undefined;
  let authorizationUrl: URL | undefined;
  let verifier = "";
  const provider: OAuthClientProvider = {
    redirectUrl: callback,
    clientMetadata: {
      redirect_uris: [callback],
      client_name: "Official SDK controlled test",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    clientInformation: () => information,
    saveClientInformation: (value) => {
      information = value;
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    redirectToAuthorization: (value) => {
      authorizationUrl = value;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    state: () => "official-sdk-state",
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    request.headers.set("host", new URL(origin).host);
    const path = new URL(request.url).pathname;
    if (path.startsWith("/.well-known/oauth-protected-resource"))
      return oauthRoute(request, "resource");
    if (path === "/.well-known/oauth-authorization-server")
      return oauthRoute(request, "metadata");
    const action = path.split("/").at(-1);
    if (action === "register" || action === "token")
      return oauthRoute(request, action);
    if (path === "/api/mcp") return mcp(request);
    return new Response(null, { status: 404 });
  };
  expect(await auth(provider, { serverUrl: endpoint, fetchFn })).toBe(
    "REDIRECT",
  );
  expect(authorizationUrl).toBeDefined();
  const begin = await oauthRoute(new Request(authorizationUrl!), "authorize");
  const requestId = new URL(begin.headers.get("location")!).searchParams.get(
    "request",
  )!;
  const approved = await decide(raw, requestId);
  const callbackUrl = new URL((await approved.json()).redirectUrl);
  expect(callbackUrl.searchParams.get("state")).toBe("official-sdk-state");
  expect(
    await auth(provider, {
      serverUrl: endpoint,
      authorizationCode: callbackUrl.searchParams.get("code")!,
      fetchFn,
    }),
  ).toBe("AUTHORIZED");
  expect(tokens?.access_token).toBeDefined();
  const client = new Client({ name: "oauth-integration-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: { authorization: `Bearer ${tokens!.access_token}` },
        },
        fetch: fetchFn,
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(6);
  } finally {
    await client.close();
  }
  expect(await db.sendAttempt.count()).toBe(0);
});
