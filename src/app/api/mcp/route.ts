import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authorizeMcp } from "@/lib/mcp-auth";
import { createMcpServer } from "@/lib/mcp-server";
import { AppError, safeError } from "@/lib/security";
import { oauthChallenge } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxBody = 512_000;

async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Missing JSON-RPC body.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBody) {
      await reader.cancel();
      throw new AppError(413, "MCP request is too large.");
    }
    chunks.push(value);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid JSON-RPC body.");
  }
  if (Array.isArray(data))
    throw new AppError(
      400,
      "Batch requests are disabled. Prepare one outreach at a time.",
    );
  return data;
}

async function handler(request: Request) {
  try {
    const owner = await authorizeMcp(request);
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { allow: "POST", "cache-control": "no-store" },
      });
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw new AppError(415, "Use application/json.");
    const parsedBody = await body(request);
    const server = createMcpServer(owner.id);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody });
      // Stateless JSON responses are fully consumed before closing the SDK transport.
      const payload = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      return new Response(payload.byteLength ? payload : null, {
        status: response.status,
        headers,
      });
    } finally {
      await server.close();
    }
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return Response.json(
      { error: safeError(error) },
      {
        status,
        headers: {
          "cache-control": "no-store",
          ...(status === 401 ? { "www-authenticate": oauthChallenge() } : {}),
        },
      },
    );
  }
}
export {
  handler as POST,
  handler as GET,
  handler as DELETE,
  handler as OPTIONS,
};
