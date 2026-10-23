import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-owner-password-123");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Make every conversation count." }),
  ).toBeVisible();
});
test("uses real empty metrics, protects exports and supports every navigation item", async ({
  page,
  browser,
}) => {
  await expect(
    page.getByText("Recorded image requests · not reads"),
  ).toBeVisible();
  for (const [name, heading] of [
    ["Inbox", "Inbox"],
    ["Sent Emails", "Sent Emails"],
    ["Campaigns", "Campaigns"],
    ["Follow-ups", "Follow-ups"],
    ["Analytics", "Analytics"],
    ["Settings", "Settings"],
  ]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(
    "http://localhost:3100/api/exports/prospects",
  );
  expect(response.status()).toBe(401);
  await anonymous.close();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("creates and edits a prospect, personalizes a saved draft and blocks an unconfigured send", async ({
  page,
}, testInfo) => {
  const suffix = testInfo.project.name;
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Prospects", exact: true })
    .click();
  await page.getByRole("button", { name: "Add prospect", exact: true }).click();
  await page
    .getByLabel("Full name", { exact: true })
    .fill(`Owner Test ${suffix}`);
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`controlled-${suffix}@example.test`);
  await page
    .getByLabel("Book title", { exact: true })
    .fill("An Owner-Controlled Test");
  await page
    .getByRole("button", { name: "Save prospect", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const row = page
    .getByRole("row")
    .filter({ hasText: `controlled-${suffix}@example.test` });
  await expect(row).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Browser-tested record. Never a real prospect.");
  await page.getByRole("button", { name: "Save prospect" }).click();
  await row
    .getByRole("link", { name: `Compose for Owner Test ${suffix}` })
    .click();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Hello {{first_name}}");
  const editor = page.getByRole("textbox", { name: "Email body", exact: true });
  await editor.fill("Hello {{first_name}}, a note about {{book_title}}.");
  await page.getByRole("button", { name: "Preview & review" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hello Owner", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Email preview"]')
      .getByText("Hello Owner, a note about An Owner-Controlled Test."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm & send" }),
  ).toBeDisabled();
  await page
    .getByLabel("I reviewed this recipient and message and authorize sending.")
    .check();
  await page.getByRole("button", { name: "Confirm & send" }).click();
  await expect(page.getByRole("alert").last()).toContainText(
    "Configure the authorized mailbox",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({
    path: testInfo.outputPath("compose.png"),
    fullPage: true,
  });
});
test("stores settings without returning the password and applies CSRF checks", async ({
  page,
}) => {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page
    .getByLabel("Signature", { exact: true })
    .fill("Grant Publishing Co.\nOwner-controlled browser test");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  const snapshot = await page.request.get("/api/data");
  const data = await snapshot.json();
  expect(data.settings.encryptedPassword).toBeUndefined();
  const rejected = await page.request.post("/api/prospects", {
    headers: { Origin: "http://localhost:3100" },
    data: { fullName: "Rejected", email: "blocked@example.test" },
  });
  expect(rejected.status()).toBe(403);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await page.screenshot({
    path: `test-results/overview-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("creates a real campaign and imports validated prospect records", async ({
  page,
}, testInfo) => {
  const suffix = testInfo.project.name;
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Campaigns", exact: true })
    .click();
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill(`Owned test campaign ${suffix}`);
  await page
    .getByRole("button", { name: "Save campaign", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: `Owned test campaign ${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Prospects", exact: true })
    .click();
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await page.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "owned-test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `fullName,email,bookTitle\nCSV Author ${suffix},csv-${suffix}@example.test,Test Book`,
    ),
  });
  await page
    .getByRole("button", { name: "Validate & preview", exact: true })
    .click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "1 created, 0 updated, 0 skipped",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: `csv-${suffix}@example.test` }),
  ).toBeVisible();
});
