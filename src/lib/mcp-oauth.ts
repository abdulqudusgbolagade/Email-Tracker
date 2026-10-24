import { z, ZodError } from "zod";
import {
  OAuthClientMetadataSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { db, retryBusy } from "./db";
import { authorize, rateLimit } from "./auth";
import { AppError, digest, equal, token } from "./security";
import { mcpConfiguration, mcpOrigin } from "./mcp-config";

export const MCP_SCOPE = "grant:outreach";
const opaque = /^[A-Za-z0-9_-]{43}$/;
const accessLifetime = 3600_000;
const grantLifetime = 30 * 24 * 3600_000;
const baseHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "access-control-allow-origin": "*",
};
type Action =
  | "metadata"
  | "resource"
  | "register"
  | "authorize"
  | "token"
  | "revoke"
  | "consent";
class OAuthError extends AppError {
  constructor(
    public code: string,
    message: string,
    status = 400,
  ) {
    super(status, message);
  }
}
function fail(code: string, message: string, status = 400): never {
  throw new OAuthError(code, message, status);
}
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: baseHeaders });

export function oauthGuard(request?: Request) {
  if (!mcpConfiguration().oauthEnabled)
    throw new AppError(
      503,
      "MCP OAuth is disabled. Enable it with local MCP setup first.",
    );
  return mcpOrigin(request);
}
export function oauthChallenge() {
  if (!mcpConfiguration().oauthEnabled)
    return 'Bearer realm="Grant Mail Tracker MCP"';
  return `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/api/mcp", mcpOrigin()).href}", scope="${MCP_SCOPE}"`;
}
function resource(value?: string | null) {
  const expected = mcpConfiguration().endpoint;
  if (value !== undefined && value !== null && value !== expected)
    fail(
      "invalid_target",
      "This token is restricted to this application's MCP endpoint.",
    );
  return expected;
}
function scope(value?: string | null) {
  if (value !== undefined && value !== null && value !== MCP_SCOPE)
    fail("invalid_scope", "Only grant:outreach is supported.");
  return MCP_SCOPE;
}
async function smallBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) {
      await reader.cancel();
      fail("invalid_request", "Request too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function uniqueParams(params: URLSearchParams) {
  for (const key of new Set(params.keys()))
    if (params.getAll(key).length !== 1)
      fail("invalid_request", "Repeated parameters are not supported.");
  return params;
}
async function form(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/x-www-form-urlencoded"
  )
    fail("invalid_request", "Use application/x-www-form-urlencoded.", 415);
  return uniqueParams(new URLSearchParams(await smallBody(request)));
}
function redirectAllowed(value: string) {
  const url = new URL(value);
  const origins = (
    process.env.MCP_OAUTH_REDIRECT_ORIGINS ||
    "https://chatgpt.com,https://chat.openai.com"
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !origins.includes(url.origin) ||
    url.href.length > 2000
  )
    fail(
      "invalid_redirect_uri",
      "Register an HTTPS callback on an explicitly trusted client origin.",
    );
  return url.href;
}
async function register(request: Request) {
  await rateLimit("oauth:registration", 10, 3600_000);
  if ((await db.mcpOAuthClient.count()) >= 200)
    fail(
      "invalid_client_metadata",
      "Registration limit reached. Remove unused clients locally.",
      429,
    );
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    fail("invalid_request", "Use application/json.", 415);
  let raw: unknown;
  try {
    raw = JSON.parse(await smallBody(request));
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail("invalid_client_metadata", "Invalid registration JSON.");
  }
  const data = OAuthClientMetadataSchema.parse(raw);
  if (!data.redirect_uris.length || data.redirect_uris.length > 5)
    fail("invalid_client_metadata", "Register one to five callback URLs.");
  const redirects = data.redirect_uris.map(redirectAllowed);
  const method = data.token_endpoint_auth_method || "client_secret_basic";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method))
    fail(
      "invalid_client_metadata",
      "Unsupported client authentication method.",
    );
  if (
    data.grant_types?.some(
      (x) => !["authorization_code", "refresh_token"].includes(x),
    ) ||
    data.response_types?.some((x) => x !== "code")
  )
    fail(
      "invalid_client_metadata",
      "Only authorization code and refresh grants are supported.",
    );
  scope(data.scope);
  const name = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .parse(data.client_name || "MCP client");
  const secret = method === "none" ? undefined : token();
  const client = await db.mcpOAuthClient.create({
    data: {
      id: token(),
      name,
      redirectUris: JSON.stringify(redirects),
      authMethod: method,
      secretHash: secret ? digest(secret) : null,
    },
  });
  return json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: redirects,
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: MCP_SCOPE,
    },
    201,
  );
}
async function begin(request: Request) {
  const params = uniqueParams(new URL(request.url).searchParams);
  if (request.url.length > 8000)
    fail("invalid_request", "Authorization request too large.");
  const client = await db.mcpOAuthClient.findUnique({
    where: { id: params.get("client_id") || "" },
  });
  if (!client) fail("invalid_client", "Unknown client.");
  const redirects = JSON.parse(client.redirectUris) as string[];
  const redirectUri =
    params.get("redirect_uri") || (redirects.length === 1 ? redirects[0] : "");
  if (!redirects.includes(redirectUri))
    fail("invalid_request", "Callback must exactly match registration.");
  // Recheck the current allowlist, including when an operator removes an origin.
  redirectAllowed(redirectUri);
  if (
    params.get("response_type") !== "code" ||
    params.get("code_challenge_method") !== "S256" ||
    !opaque.test(params.get("code_challenge") || "")
  )
    fail("invalid_request", "Authorization code with S256 PKCE is required.");
  const state = params.get("state");
  if (state && state.length > 2000)
    fail("invalid_request", "State is too large.");
  const audience = resource(params.get("resource"));
  const requestedScope = scope(params.get("scope"));
  const now = new Date();
  await db.mcpOAuthRequest.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } },
  });
  if (
    (await db.mcpOAuthRequest.count({ where: { expiresAt: { gt: now } } })) >=
    500
  )
    fail("temporarily_unavailable", "Authorization queue is full.", 429);
  const row = await db.mcpOAuthRequest.create({
    data: {
      id: token(),
      clientId: client.id,
      redirectUri,
      state,
      challenge: params.get("code_challenge")!,
      scope: requestedScope,
      resource: audience,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    },
  });
  return Response.redirect(
    new URL(`/mcp/authorize?request=${row.id}`, mcpOrigin()).href,
    303,
  );
}
export async function oauthConsentDetails(id: string) {
  oauthGuard();
  if (!opaque.test(id)) throw new AppError(400, "Invalid connection request.");
  const row = await db.mcpOAuthRequest.findUnique({
    where: { id },
    include: { client: true },
  });
  if (!row || row.expiresAt <= new Date() || row.decidedAt)
    throw new AppError(
      410,
      "This connection request expired or was already decided. Start again in Codex.",
    );
  if (row.resource !== resource())
    throw new AppError(
      410,
      "The application address changed. Start again in Codex.",
    );
  redirectAllowed(row.redirectUri);
  return {
    id: row.id,
    name: row.client.name,
    callbackOrigin: new URL(row.redirectUri).origin,
    expiresAt: row.expiresAt,
  };
}
async function consent(request: Request) {
  const { owner } = await authorize(request);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    fail("invalid_request", "Use application/json.", 415);
  const data = z
    .object({ requestId: z.string().regex(opaque), allow: z.boolean() })
    .strict()
    .parse(JSON.parse(await smallBody(request)));
  await oauthConsentDetails(data.requestId);
  const code = token();
  const now = new Date();
  const row = await retryBusy(() =>
    db.$transaction(async (tx) => {
      const result = await tx.mcpOAuthRequest.updateMany({
        where: { id: data.requestId, decidedAt: null, expiresAt: { gt: now } },
        data: {
          decidedAt: now,
          ownerId: owner.id,
          ...(data.allow
            ? {
                codeHash: digest(code),
                codeExpiresAt: new Date(now.getTime() + 120_000),
              }
            : {}),
        },
      });
      if (result.count !== 1)
        throw new AppError(409, "Connection request already decided.");
      await tx.auditLog.create({
        data: {
          action: data.allow ? "mcp.oauth.approve" : "mcp.oauth.deny",
          entityId: owner.id,
        },
      });
      return tx.mcpOAuthRequest.findUniqueOrThrow({
        where: { id: data.requestId },
      });
    }),
  );
  const url = new URL(row.redirectUri);
  // Never inherit authorization response fields from a registered callback query.
  for (const key of ["code", "error", "error_description", "state", "iss"])
    url.searchParams.delete(key);
  url.searchParams.set(
    data.allow ? "code" : "error",
    data.allow ? code : "access_denied",
  );
  if (row.state !== null) url.searchParams.set("state", row.state);
  url.searchParams.set("iss", mcpOrigin().origin);
  return json({ redirectUrl: url.href });
}
async function clientFor(request: Request, params: URLSearchParams) {
  const header = request.headers.get("authorization");
  let id = params.get("client_id") || "";
  let secret = params.get("client_secret") || "";
  let method = secret ? "client_secret_post" : "none";
  if (header) {
    if (!header.startsWith("Basic ") || params.has("client_secret"))
      fail("invalid_client", "Invalid client authentication.", 401);
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator < 0)
        fail("invalid_client", "Invalid client authentication.", 401);
      const basicId = decodeURIComponent(
        decoded.slice(0, separator).replace(/\+/g, " "),
      );
      if (id && id !== basicId)
        fail("invalid_client", "Client identifiers disagree.", 401);
      id = basicId;
      secret = decodeURIComponent(
        decoded.slice(separator + 1).replace(/\+/g, " "),
      );
      method = "client_secret_basic";
    } catch {
      fail("invalid_client", "Invalid client authentication.", 401);
    }
  }
  const client = opaque.test(id)
    ? await db.mcpOAuthClient.findUnique({ where: { id } })
    : null;
  if (
    !client ||
    client.authMethod !== method ||
    (client.secretHash && !equal(digest(secret), client.secretHash))
  )
    fail("invalid_client", "Invalid client authentication.", 401);
  return client;
}
async function issue(
  tx: Prisma.TransactionClient,
  grantId: string,
  expiresAt: Date,
) {
  const access = token();
  const refresh = token();
  const accessExpiry = new Date(
    Math.min(Date.now() + accessLifetime, expiresAt.getTime()),
  );
  await tx.mcpOAuthToken.createMany({
    data: [
      {
        hash: digest(access),
        grantId,
        kind: "access",
        expiresAt: accessExpiry,
      },
      { hash: digest(refresh), grantId, kind: "refresh", expiresAt },
    ],
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(
      1,
      Math.floor((accessExpiry.getTime() - Date.now()) / 1000),
    ),
    refresh_token: refresh,
    scope: MCP_SCOPE,
  };
}
async function exchange(request: Request) {
  const params = await form(request);
  const client = await clientFor(request, params);
  const audience = resource(params.get("resource"));
  scope(params.get("scope"));
  const now = new Date();
  if (params.get("grant_type") === "authorization_code") {
    const raw = params.get("code") || "";
    const row = opaque.test(raw)
      ? await db.mcpOAuthRequest.findUnique({
          where: { codeHash: digest(raw) },
        })
      : null;
    const verifier = params.get("code_verifier") || "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      !row ||
      row.clientId !== client.id ||
      row.redirectUri !== params.get("redirect_uri") ||
      row.resource !== audience ||
      !row.ownerId ||
      !row.codeExpiresAt ||
      row.codeExpiresAt <= now ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      !equal(challenge, row.challenge) ||
      !(await db.owner.findUnique({ where: { id: row.ownerId } }))
    )
      fail(
        "invalid_grant",
        "Invalid or expired authorization code, callback or PKCE verifier.",
      );
    const result = await retryBusy(() =>
      db.$transaction(async (tx) => {
        const grantId = token();
        const used = await tx.mcpOAuthRequest.updateMany({
          where: { id: row.id, consumedAt: null },
          data: { consumedAt: now, grantId },
        });
        if (!used.count) return null;
        const grant = await tx.mcpOAuthGrant.create({
          data: {
            id: grantId,
            ownerId: row.ownerId!,
            clientId: client.id,
            scope: row.scope,
            resource: audience,
            expiresAt: new Date(now.getTime() + grantLifetime),
          },
        });
        return issue(tx, grant.id, grant.expiresAt);
      }),
    );
    if (!result) {
      const used = await db.mcpOAuthRequest.findUnique({
        where: { id: row.id },
      });
      if (used?.grantId)
        await db.mcpOAuthGrant.updateMany({
          where: { id: used.grantId, revokedAt: null },
          data: { revokedAt: now },
        });
      fail(
        "invalid_grant",
        "Authorization codes can be used only once. Reconnect to approve a new grant.",
      );
    }
    return json(result);
  }
  if (params.get("grant_type") === "refresh_token") {
    const raw = params.get("refresh_token") || "";
    const result = await retryBusy(() =>
      db.$transaction(async (tx) => {
        const row = opaque.test(raw)
          ? await tx.mcpOAuthToken.findUnique({
              where: { hash: digest(raw) },
              include: { grant: true },
            })
          : null;
        if (
          !row ||
          row.kind !== "refresh" ||
          row.grant.clientId !== client.id ||
          row.grant.resource !== audience ||
          row.expiresAt <= now ||
          row.grant.expiresAt <= now ||
          row.grant.revokedAt
        )
          return null;
        const used = await tx.mcpOAuthToken.updateMany({
          where: { hash: row.hash, usedAt: null },
          data: { usedAt: now },
        });
        if (!used.count) {
          await tx.mcpOAuthGrant.update({
            where: { id: row.grantId },
            data: { revokedAt: now },
          });
          return null;
        }
        // Retire prior access tokens too; at most one current pair per grant.
        await tx.mcpOAuthToken.updateMany({
          where: { grantId: row.grantId, kind: "access", usedAt: null },
          data: { usedAt: now },
        });
        return issue(tx, row.grantId, row.grant.expiresAt);
      }),
    );
    if (!result)
      fail(
        "invalid_grant",
        "Invalid, expired or reused refresh token. Reconnect if necessary.",
      );
    return json(result);
  }
  fail(
    "unsupported_grant_type",
    "Only authorization_code and refresh_token are supported.",
  );
}
export async function verifyMcpOAuthToken(raw: string) {
  if (!mcpConfiguration().oauthEnabled || !opaque.test(raw)) return null;
  const row = await db.mcpOAuthToken.findUnique({
    where: { hash: digest(raw) },
    include: { grant: { include: { owner: { select: { id: true } } } } },
  });
  const now = new Date();
  if (
    !row ||
    row.kind !== "access" ||
    row.usedAt ||
    row.expiresAt <= now ||
    row.grant.revokedAt ||
    row.grant.expiresAt <= now ||
    row.grant.resource !== resource() ||
    row.grant.scope !== MCP_SCOPE
  )
    return null;
  return row.grant.owner;
}
async function revoke(request: Request) {
  const params = await form(request);
  const client = await clientFor(request, params);
  const raw = params.get("token") || "";
  const row = opaque.test(raw)
    ? await db.mcpOAuthToken.findUnique({
        where: { hash: digest(raw) },
        include: { grant: true },
      })
    : null;
  if (row?.grant.clientId === client.id)
    await db.mcpOAuthGrant.updateMany({
      where: { id: row.grantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  return new Response(null, { status: 200, headers: baseHeaders });
}
export async function oauthConnections(ownerId: string) {
  const rows = await db.mcpOAuthGrant.findMany({
    where: { ownerId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      client: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.client.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}
export async function cleanupOAuth() {
  const now = new Date();
  await db.$transaction([
    db.mcpOAuthRequest.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 86400_000) } },
    }),
    // Retain used refresh hashes for active grants so replay detection survives
    // rotation. Cascading removal cleans tokens after expiry or revocation.
    db.mcpOAuthGrant.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { revokedAt: { lt: new Date(now.getTime() - 86400_000) } },
        ],
      },
    }),
    db.mcpOAuthClient.deleteMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - 7 * 86400_000) },
        grants: { none: {} },
        requests: { none: {} },
      },
    }),
  ]);
}
export async function revokeConnection(ownerId: string, grantId: string) {
  if (!opaque.test(grantId))
    throw new AppError(400, "Invalid connection identifier.");
  await db.$transaction(async (tx) => {
    await tx.mcpOAuthGrant.updateMany({
      where: { id: grantId, ownerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: { action: "mcp.oauth.revoke", entityId: ownerId },
    });
  });
}
export async function oauthRoute(request: Request, action: Action) {
  try {
    const origin = oauthGuard(request);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...baseHeaders,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
        },
      });
    const expectedMethod = ["metadata", "resource", "authorize"].includes(
      action,
    )
      ? "GET"
      : "POST";
    if (request.method !== expectedMethod)
      return new Response(null, {
        status: 405,
        headers: { ...baseHeaders, allow: expectedMethod },
      });
    if (action === "metadata")
      return json(
        OAuthMetadataSchema.parse({
          issuer: origin.origin,
          authorization_endpoint: new URL("/api/mcp/oauth/authorize", origin)
            .href,
          token_endpoint: new URL("/api/mcp/oauth/token", origin).href,
          registration_endpoint: new URL("/api/mcp/oauth/register", origin)
            .href,
          revocation_endpoint: new URL("/api/mcp/oauth/revoke", origin).href,
          scopes_supported: [MCP_SCOPE],
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: [
            "client_secret_post",
            "client_secret_basic",
            "none",
          ],
          revocation_endpoint_auth_methods_supported: [
            "client_secret_post",
            "client_secret_basic",
            "none",
          ],
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
        }),
      );
    if (action === "resource")
      return json(
        OAuthProtectedResourceMetadataSchema.parse({
          resource: resource(),
          resource_name: "Grant Mail Tracker",
          authorization_servers: [origin.origin],
          scopes_supported: [MCP_SCOPE],
          bearer_methods_supported: ["header"],
        }),
      );
    await rateLimit(
      `oauth:${action}`,
      action === "authorize" ? 30 : 60,
      60_000,
    );
    if (action === "register") return await register(request);
    if (action === "authorize") return await begin(request);
    if (action === "consent") return await consent(request);
    if (action === "revoke") return await revoke(request);
    return await exchange(request);
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    return Response.json(
      {
        error:
          error instanceof OAuthError
            ? error.code
            : status === 400
              ? "invalid_request"
              : status === 503
                ? "temporarily_unavailable"
                : "server_error",
        error_description:
          error instanceof AppError
            ? error.message
            : status === 400
              ? "Invalid OAuth request."
              : "OAuth operation failed.",
      },
      {
        status,
        headers: {
          ...baseHeaders,
          ...(error instanceof OAuthError && error.code === "invalid_client"
            ? { "www-authenticate": 'Basic realm="Grant Mail Tracker OAuth"' }
            : {}),
        },
      },
    );
  }
}
