import { createDb } from "@nuno/shared";
import { publishAll, publisherFromEnv } from "./publisher.js";

async function main() {
  const cfg = publisherFromEnv();
  if (!cfg.env) throw new Error(`publishing not configured: ${cfg.reason}`);
  const { db, sql } = createDb();
  const results = await publishAll({ db, ...cfg.env, log: console.log });
  const sent = results.filter((r) => r.txHash).length;
  const failed = results.filter((r) => r.error).length;
  console.log(`[publisher] ${sent} published, ${failed} failed, ${results.length - sent - failed} unchanged`);
  await sql.end();
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
