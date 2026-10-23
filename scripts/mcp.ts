import { chdir } from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Resolve the app's database and .env from its installation, regardless of the
// MCP client's current directory. stdout is reserved for the MCP protocol.
chdir(fileURLToPath(new URL("../", import.meta.url)));
config({ quiet: true });
const { db } = await import("../src/lib/db");
const { mcpConfiguration } = await import("../src/lib/mcp-auth");
const { createMcpServer } = await import("../src/lib/mcp-server");
const { AppError, safeError } = await import("../src/lib/security");

try {
  if (!mcpConfiguration().enabled)
    throw new AppError(
      503,
      "MCP is disabled. Run npm run mcp:setup locally, then restart the client.",
    );
  const owner = await db.owner.findFirst({ select: { id: true } });
  if (!owner) throw new AppError(503, "Provision the owner account first.");
  // A local stdio client is authorized by the OS user that can launch this
  // process and read this installation. It is never exposed as a public socket.
  const server = createMcpServer(owner.id);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    await db.$disconnect();
  };
  server.server.onclose = () => {
    void close();
  };
  process.on("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });
  process.stdin.once("end", () => {
    void close();
  });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(safeError(error));
  await db.$disconnect();
  process.exitCode = 1;
}
