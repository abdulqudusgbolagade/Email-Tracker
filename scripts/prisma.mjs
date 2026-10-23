import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
// Prisma uses the standard XDG cache on Linux. Keep it writable in cloud tasks.
// TLS, package integrity and engine checksums remain enabled.
const child = spawn(
  process.execPath,
  [join(root, "node_modules/prisma/build/index.js"), ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(process.platform === "linux"
        ? { XDG_CACHE_HOME: join(root, ".cache") }
        : {}),
    },
  },
);
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
