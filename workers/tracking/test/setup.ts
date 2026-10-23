import { env, applyD1Migrations } from "cloudflare:test";
import type { Env } from "../src/index";
import type { D1Migration } from "@cloudflare/vitest-plugin";
declare global {
  namespace Cloudflare {
    interface Env extends WorkerTestEnv {}
  }
}
interface WorkerTestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
