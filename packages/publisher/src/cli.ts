import { AddressBook } from "@nuno/shared";
import { config, openLocal } from "@nuno/shared/node";
import { publisherFromEnv } from "./env.js";
import { publishAll } from "./publisher.js";

// pnpm publish:snapshots — publish changed snapshots from the local DB (the Worker publishes from D1).
async function main() {
  const cfg = publisherFromEnv();
  if (!cfg.env) throw new Error(`publishing not configured: ${cfg.reason}`);
  const { db, close } = openLocal(config.localDbPath);
  const results = await publishAll({ db, book: new AddressBook(db), ...cfg.env, log: console.log });
  const sent = results.filter((r) => r.txHash).length;
  const failed = results.filter((r) => r.error).length;
  console.log(`[publisher] ${sent} published, ${failed} failed, ${results.length - sent - failed} unchanged`);
  close();
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
