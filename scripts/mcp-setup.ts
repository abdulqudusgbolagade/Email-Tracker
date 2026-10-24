import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { config } from "dotenv";
import { digest, token } from "../src/lib/security";

// Exported for isolated filesystem tests; never prints or returns the raw key.
export function configureMcp(
  root: string,
  action: "enable" | "rotate" | "revoke" | "oauth",
) {
  const envFile = join(root, ".env");
  const keyFile = join(root, ".mcp-access-token");
  if (!existsSync(envFile)) throw new Error("Run npm run setup first.");
  let contents = readFileSync(envFile, "utf8");
  if (
    action === "enable" &&
    /^(?:export\s+)?MCP_ENABLED\s*=\s*["']?true/m.test(contents)
  )
    throw new Error(
      "MCP is already enabled. Use --rotate to replace its key, or --revoke to disable it.",
    );
  const raw = action === "enable" || action === "rotate" ? token() : "";
  const values: Record<string, string> = {
    MCP_ENABLED: action === "revoke" ? "false" : "true",
    ...(action !== "oauth"
      ? { MCP_ACCESS_TOKEN_HASH: raw ? digest(raw) : "" }
      : {}),
    ...(action === "oauth" || action === "revoke"
      ? { MCP_OAUTH_ENABLED: action === "oauth" ? "true" : "false" }
      : {}),
  };
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`, "gm");
    const line = `${name}="${value}"`;
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.trimEnd()}${eol}${line}${eol}`;
  }
  if (raw)
    writeFileSync(keyFile, raw + "\n", {
      mode: 0o600,
      flag: action === "rotate" ? "w" : "wx",
    });
  const temporary = join(root, ".env.mcp-tmp");
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, envFile);
  if (action === "revoke") rmSync(keyFile, { force: true });
  return { enabled: action !== "revoke", keyFile };
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("mcp-setup.ts")) {
  if (!existsSync(".env"))
    throw new Error("Run npm run setup in the main project folder first.");
  const action = process.argv.includes("--revoke")
    ? "revoke"
    : process.argv.includes("--oauth")
      ? "oauth"
      : process.argv.includes("--rotate")
        ? "rotate"
        : "enable";
  config({ quiet: true });
  const { db } = await import("../src/lib/db");
  try {
    if (action !== "revoke" && !(await db.owner.count()))
      throw new Error("Provision your owner account with npm run setup first.");
    const result = configureMcp(process.cwd(), action);
    if (action === "revoke") {
      await db.$transaction([
        db.mcpOAuthGrant.updateMany({
          where: { revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        db.mcpOAuthRequest.deleteMany(),
      ]);
    }
    console.log(
      action === "oauth"
        ? "MCP OAuth enabled. No mailbox password or integration key goes in the client form. Use the public HTTPS /api/mcp endpoint and approve access in your app."
        : result.enabled
          ? "MCP key saved to the ignored .mcp-access-token file. Read it privately and enter it in the client's secure bearer-key field. The raw key is not printed here."
          : "MCP disabled in .env and the local key file removed.",
    );
    console.log(
      "Restart the application to apply this change. Keep normal outreach disabled during the integration test.",
    );
  } finally {
    await db.$disconnect();
  }
}
