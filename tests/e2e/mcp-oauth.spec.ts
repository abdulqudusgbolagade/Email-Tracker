import { test, expect } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";

test("signs in for explicit OAuth consent, denies/approves, connects and revokes on desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  const origin = "http://localhost:3100";
  const metadata = await request.get("/.well-known/oauth-authorization-server");
  expect(metadata.status()).toBe(200);
  expect((await metadata.json()).issuer).toBe(origin);
  const resource = await request.get(
    "/.well-known/oauth-protected-resource/api/mcp",
  );
  expect(resource.status()).toBe(200);
  expect((await resource.json()).resource).toBe(origin + "/api/mcp");
  const callback = "https://chatgpt.com/connector_platform/oauth_redirect";
  const verifier = randomBytes(48).toString("base64url");
  const registration = await request.post("/api/mcp/oauth/register", {
    data: {
      client_name: `Browser controlled test ${testInfo.project.name}`,
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
    },
  });
  expect(registration.status()).toBe(201);
  const { client_id } = await registration.json();
  const authorization = new URLSearchParams({
    client_id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: "browser-fixture-state",
    resource: origin + "/api/mcp",
    scope: "grant:outreach",
  });
  const started = await request.get(
    `/api/mcp/oauth/authorize?${authorization}`,
    { maxRedirects: 0 },
  );
  expect(started.status()).toBe(303);
  await page.goto(started.headers().location);
  await expect(page).toHaveURL(/\/login\?next=/);
  const destination = new URL(page.url()).searchParams.get("next")!;
  expect(destination).toMatch(/^\/mcp\/authorize\?request=/);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-owner-password-123");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your outreach tools" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // Capture only the trusted callback locally; no real third-party request occurs.
  await page.route(callback + "**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Controlled OAuth callback</h1>",
    }),
  );
  await page.getByRole("button", { name: "Deny access", exact: true }).click();
  await expect(page).toHaveURL(/error=access_denied/);
  expect(new URL(page.url()).searchParams.get("state")).toBe(
    "browser-fixture-state",
  );
  const second = await request.get(
    `/api/mcp/oauth/authorize?${authorization}`,
    { maxRedirects: 0 },
  );
  await page.goto(second.headers().location);
  await expect(
    page.getByRole("heading", { name: "Connect your outreach tools" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve connection", exact: true })
    .click();
  await expect(page).toHaveURL(/code=/);
  const callbackUrl = new URL(page.url());
  expect(callbackUrl.searchParams.get("iss")).toBe(origin);
  const exchange = await request.post("/api/mcp/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id,
      code: callbackUrl.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: callback,
      resource: origin + "/api/mcp",
    },
  });
  expect(exchange.status()).toBe(200);
  const tokens = await exchange.json();
  async function list() {
    return request.post("/api/mcp", {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: "application/json, text/event-stream",
      },
      data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
  }
  const tools = await list();
  expect(tools.status()).toBe(200);
  expect((await tools.json()).result.tools).toHaveLength(6);
  await page.goto("/settings");
  const connection = page
    .locator(".connection-check")
    .filter({ hasText: `Browser controlled test ${testInfo.project.name}` });
  await expect(connection).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await connection
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await expect(connection).toHaveCount(0);
  expect((await list()).status()).toBe(401);
});
