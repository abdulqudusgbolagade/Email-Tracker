import { expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { configureMcp } from "../scripts/mcp-setup";
import { digest } from "../src/lib/security";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "grant-mcp-setup-"));
  const original =
    'APP_URL="http://localhost:3000"\r\nCREDENTIAL_ENCRYPTION_KEY="fixture-key-preserve"\r\nMAILBOX_PASSWORD="fixture-mailbox-preserve"\r\nMCP_ENABLED="false"\r\nMCP_ACCESS_TOKEN_HASH=""\r\n';
  writeFileSync(join(root, ".env"), original);
  return { root, original };
}
it("provisions a separate key without returning it or replacing mailbox/encryption settings", () => {
  const { root } = fixture();
  try {
    const result = configureMcp(root, "enable");
    const key = readFileSync(result.keyFile, "utf8").trim();
    const settings = parse(readFileSync(join(root, ".env")));
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(settings.MCP_ACCESS_TOKEN_HASH).toBe(digest(key));
    expect(settings.CREDENTIAL_ENCRYPTION_KEY).toBe("fixture-key-preserve");
    expect(settings.MAILBOX_PASSWORD).toBe("fixture-mailbox-preserve");
    expect(JSON.stringify(result)).not.toContain(key);
    if (process.platform !== "win32")
      expect(statSync(result.keyFile).mode & 0o777).toBe(0o600);
    expect(() => configureMcp(root, "enable")).toThrow("already enabled");
    expect(readFileSync(result.keyFile, "utf8").trim()).toBe(key);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("rotates and revokes the dedicated key while retaining the application secrets", () => {
  const { root } = fixture();
  try {
    const first = configureMcp(root, "enable");
    const old = readFileSync(first.keyFile, "utf8").trim();
    configureMcp(root, "rotate");
    const rotated = readFileSync(first.keyFile, "utf8").trim();
    expect(rotated).not.toBe(old);
    expect(parse(readFileSync(join(root, ".env"))).MCP_ACCESS_TOKEN_HASH).toBe(
      digest(rotated),
    );
    configureMcp(root, "revoke");
    expect(existsSync(first.keyFile)).toBe(false);
    expect(parse(readFileSync(join(root, ".env")))).toMatchObject({
      MCP_ENABLED: "false",
      MCP_ACCESS_TOKEN_HASH: "",
      CREDENTIAL_ENCRYPTION_KEY: "fixture-key-preserve",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
