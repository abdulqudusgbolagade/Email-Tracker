import { test as base, expect, type APIRequestContext } from "@playwright/test";
type OwnerState = Awaited<ReturnType<APIRequestContext["storageState"]>>;
// Authenticate once per worker/project through the real login API. Keep cookies
// in memory and preserve production login throttling. OAuth tests cover UI login.
export const test = base.extend<object, { ownerState: OwnerState }>({
  ownerState: [
    async ({ playwright }, provide) => {
      const context = await playwright.request.newContext({
        baseURL: "http://localhost:3100",
      });
      try {
        const response = await context.post("/api/auth/login", {
          headers: { origin: "http://localhost:3100" },
          data: {
            email: "owner@example.test",
            password: "fixture-owner-password-123",
          },
        });
        expect(response.status()).toBe(200);
        await provide(await context.storageState());
      } finally {
        await context.dispose();
      }
    },
    { scope: "worker" },
  ],
  storageState: async ({ ownerState }, provide) => {
    await provide(ownerState);
  },
});
export { expect };
