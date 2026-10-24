import { db } from "./db";
import { rateLimit } from "./auth";
import { AppError, digest, equal } from "./security";
import { mcpConfiguration, mcpOrigin } from "./mcp-config";
import { verifyMcpOAuthToken } from "./mcp-oauth";
export { mcpConfiguration } from "./mcp-config";

export async function authorizeMcp(request: Request) {
  if (!mcpConfiguration().enabled)
    throw new AppError(
      503,
      "MCP is disabled. Enable the connector using local MCP setup.",
    );
  const origin = mcpOrigin(request);
  const browserOrigin = request.headers.get("origin");
  const allowed = [
    origin.origin,
    ...(process.env.MCP_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  if (browserOrigin && !allowed.includes(browserOrigin))
    throw new AppError(403, "MCP origin rejected.");

  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("authorization") || "",
  );
  const keyValid =
    match &&
    mcpConfiguration().keyConfigured &&
    equal(digest(match[1]), process.env.MCP_ACCESS_TOKEN_HASH!);
  const oauthOwner =
    match && !keyValid ? await verifyMcpOAuthToken(match[1]) : null;
  if (!keyValid && !oauthOwner) {
    await rateLimit("mcp:invalid-auth", 30, 60_000);
    throw new AppError(
      401,
      "Authorize this MCP connection using OAuth or a dedicated bearer key.",
    );
  }
  const owner =
    oauthOwner || (await db.owner.findFirst({ select: { id: true } }));
  if (!owner)
    throw new AppError(503, "Provision the owner account before enabling MCP.");
  const settings = await db.appSettings.findUnique({
    where: { id: "singleton" },
  });
  await rateLimit(`mcp:${owner.id}`, settings?.requestLimit || 120, 60_000);
  return owner;
}
