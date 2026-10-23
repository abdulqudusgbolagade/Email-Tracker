import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "dotenv";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";

const unattended = process.argv.includes("--non-interactive");
const reset = process.argv.includes("--reset-owner");
if (reset && unattended)
  throw new Error("Owner reset requires an interactive terminal.");
if (!existsSync(".env")) {
  const source = readFileSync(".env.example", "utf8").replace(
    'CREDENTIAL_ENCRYPTION_KEY=""',
    `CREDENTIAL_ENCRYPTION_KEY="${randomBytes(32).toString("hex")}"`,
  );
  writeFileSync(".env", source, { mode: 0o600, flag: "wx" });
}
config({ quiet: true });
if (!/^[a-f0-9]{64}$/i.test(process.env.CREDENTIAL_ENCRYPTION_KEY || ""))
  throw new Error(
    "Missing encryption key in existing .env. Generate 32 random bytes as hex; do not replace an existing key used to encrypt credentials.",
  );
mkdirSync("data", { recursive: true });
const file = resolve(
  (process.env.DATABASE_URL || "file:./data/grant.db").slice(5),
);
mkdirSync(dirname(file), { recursive: true });
new Database(file).close();
for (const args of [["generate"], ["migrate", "deploy"]]) {
  const result = spawnSync(
    process.execPath,
    ["scripts/prisma.mjs", ...args],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
const { db, initializeDatabase } = await import("../src/lib/db");
const { hashPassword } = await import("../src/lib/auth");
await initializeDatabase();
await db.appSettings.upsert({
  where: { id: "singleton" },
  create: { id: "singleton" },
  update: {},
});
if (((await db.owner.count()) === 0 || reset) && !unattended) {
  if (!stdin.isTTY)
    throw new Error(
      "Owner setup requires an interactive terminal. Use --non-interactive to initialize the database only.",
    );
  const rl = createInterface({ input: stdin, output: stdout });
  const { emailSchema } = await import("../src/lib/validation");
  const email = emailSchema.parse(await rl.question("Owner sign-in email: "));
  rl.close();
  async function hidden(prompt: string): Promise<string> {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    return new Promise((resolve, reject) => {
      let text = "";
      const onData = (chunk: Buffer) => {
        for (const c of chunk.toString()) {
          if (c === "\u0003") {
            cleanup();
            reject(new Error("Setup cancelled."));
            return;
          }
          if (c === "\r" || c === "\n") {
            cleanup();
            resolve(text);
            return;
          }
          if (c === "\u007f" || c === "\b") text = text.slice(0, -1);
          else if (c.charCodeAt(0) >= 32) text += c;
        }
      };
      function cleanup() {
        stdin.off("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write("\n");
      }
      stdin.on("data", onData);
    });
  }
  const password = await hidden(
    "Owner password (at least 12 characters, hidden): ",
  );
  const confirm = await hidden("Confirm password (hidden): ");
  if (password.length < 12 || password !== confirm)
    throw new Error("Passwords must match and contain at least 12 characters.");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    if (reset) {
      await tx.session.deleteMany();
      await tx.owner.deleteMany();
    }
    await tx.owner.create({ data: { email, passwordHash } });
    await tx.auditLog.create({
      data: { action: reset ? "owner.reset" : "owner.provisioned" },
    });
  });
  console.log("Owner created. No mailbox credentials have been configured.");
} else if (!(await db.owner.count()))
  console.log(
    "Database initialized. Run npm run setup interactively to provision the owner.",
  );
await db.$disconnect();
console.log("Setup complete. Run npm run dev.");
