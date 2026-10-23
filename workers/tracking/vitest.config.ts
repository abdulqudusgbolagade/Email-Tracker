import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath, URL } from "node:url";
process.env.WRANGLER_LOG_PATH = fileURLToPath(
  new URL("./.wrangler/logs", import.meta.url),
);
process.env.WRANGLER_SEND_METRICS = "false";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SYNC_SECRET: "fixture-worker-secret-at-least-32-characters",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});
