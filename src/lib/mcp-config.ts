import { AppError } from "./security";

export function mcpConfiguration() {
  const origin = new URL(process.env.APP_URL || "http://localhost:3000");
  const keyConfigured = /^[a-f0-9]{64}$/.test(
    process.env.MCP_ACCESS_TOKEN_HASH || "",
  );
  const oauthEnabled =
    process.env.MCP_ENABLED === "true" &&
    process.env.MCP_OAUTH_ENABLED === "true";
  return {
    enabled:
      process.env.MCP_ENABLED === "true" && (keyConfigured || oauthEnabled),
    keyConfigured,
    oauthEnabled,
    endpoint: new URL("/api/mcp", origin).href,
    publicHttps: origin.protocol === "https:",
    approval: "Owner confirms each send in the application",
  };
}

export function mcpOrigin(request?: Request) {
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
  if (
    request &&
    (request.headers.get("host") || new URL(request.url).host) !== origin.host
  )
    throw new AppError(403, "MCP host rejected.");
  return origin;
}
