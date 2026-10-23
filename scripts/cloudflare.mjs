import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const worker = fileURLToPath(new URL("../workers/tracking/", import.meta.url));
const child = spawn(
  process.execPath,
  [root + "node_modules/wrangler/bin/wrangler.js", ...process.argv.slice(2)],
  {
    cwd: worker,
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: worker + ".wrangler/logs",
      WRANGLER_SEND_METRICS: "false",
    },
  },
);
child.on("exit", (code) => process.exit(code || 0));
