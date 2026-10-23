import { config } from "dotenv";
config({ quiet: true });
const { db, initializeDatabase } = await import("../src/lib/db");
const { runTick } = await import("../src/lib/jobs");
await initializeDatabase();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
console.log(
  "Grant Mail Tracker job runner started. Only owner-confirmed queued sends are eligible.",
);
while (!stopping) {
  try {
    await runTick();
  } catch {
    console.error(
      "Runner tick failed. Check the database and Settings health; no credentials are logged.",
    );
  }
  for (let i = 0; i < 10 && !stopping; i++)
    await new Promise((resolve) => setTimeout(resolve, 1000));
}
await db.$disconnect();
