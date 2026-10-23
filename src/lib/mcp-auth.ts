import { db } from "./db";
import { rateLimit } from "./auth";
import { AppError, digest, equal } from "./security";

export function mcpConfiguration() {
  const origin = new URL(process.env.APP_URL || "http://localhost:3000");
  return {
    enabled:
      process.env.MCP_ENABLED === "true" &&
      /^[a-f0-9]{64}$/.test(process.env.MCP_ACCESS_TOKEN_HASH || ""),
    endpoint: new URL("/api/mcp", origin).href,
    publicHttps: origin.protocol === "https:",
    approval: "Owner confirms each send in the application",
  };
}

export async function authorizeMcp(request: Request) {
  if (!mcpConfiguration().enabled)
    throw new AppError(
      503,
      "MCP is disabled. Provision a separate integration key locally.",
    );
  const origin = new URL(process.env.APP_URL || "http://localhost:3000");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    origin.hostname,
  );
  if (
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && loopback)) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new AppError(
      503,
      "MCP requires an HTTPS application origin; HTTP is allowed only on loopback for local tests.",
    );
  // Validate the actual Host, not caller-supplied forwarding headers.
  const host = request.headers.get("host") || new URL(request.url).host;
  if (host !== origin.host) throw new AppError(403, "MCP host rejected.");
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
  if (!match || !equal(digest(match[1]), process.env.MCP_ACCESS_TOKEN_HASH!)) {
    await rateLimit("mcp:invalid-auth", 30, 60_000);
    throw new AppError(401, "A valid MCP bearer key is required.");
  }
  const owner = await db.owner.findFirst({ select: { id: true } });
  if (!owner)
    throw new AppError(503, "Provision the owner account before enabling MCP.");
  const settings = await db.appSettings.findUnique({
    where: { id: "singleton" },
  });
  await rateLimit(`mcp:${owner.id}`, settings?.requestLimit || 120, 60_000);
  return owner;
}
