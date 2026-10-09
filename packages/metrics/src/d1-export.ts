import { createWriteStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { scalar } from "@nuno/shared";
import { ROOT_DIR, config, openLocal } from "@nuno/shared/node";
import { budgetLevel, importAllowed } from "./storage.js";

// pnpm d1:export — size gate, then a data-only SQL dump of the local DB for
// `wrangler d1 execute nuno --remote --file data/d1-import.sql` (schema comes from migrations).
// SPEC §7.11: refuses when the local DB is over the 1.5 GB target.

/** D1 max SQL statement length is 100 KB; stay well under it. */
const MAX_STATEMENT_BYTES = 90_000;
const TABLES = [
  "addresses",
  "cursors",
  "tokens",
  "graduations",
  "curve_trades",
  "transfers",
  "dex_swaps",
  "wallets",
  "funding_edges",
  "link_evidence",
  "entity_members",
  "token_metrics",
  "snapshots",
  "labels",
];

/** SQL literal for a node:sqlite value. */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
}

async function main() {
  const { db, raw, close } = openLocal(config.localDbPath);
  raw.exec("pragma wal_checkpoint(truncate)");
  const bytes = await scalar(db, sql`select page_count * page_size from pragma_page_count(), pragma_page_size()`);
  const target = Number(process.env.STORAGE_TARGET_BYTES || 1_500_000_000);
  if (!importAllowed(bytes, { targetBytes: target, alarmBytes: Infinity, hardStopBytes: Infinity })) {
    throw new Error(`refusing: local DB is ${bytes} bytes (> target ${target}); shrink the window or prune first (SPEC §7.11)`);
  }
  console.log(`[d1] local DB ${bytes.toLocaleString("en-US")} bytes (${budgetLevel(bytes)}), exporting`);

  const out = resolve(ROOT_DIR, "data/d1-import.sql");
  const w = createWriteStream(out);
  let statements = 0;
  for (const table of TABLES) {
    const stmt = raw.prepare(`select * from ${table}`);
    const cols = stmt.columns().map((c) => c.name);
    const head = `insert or ignore into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values `;
    let batch: string[] = [];
    let size = head.length;
    const flush = () => {
      if (!batch.length) return;
      w.write(head + batch.join(",") + ";\n");
      statements++;
      batch = [];
      size = head.length;
    };
    stmt.setReturnArrays(true);
    for (const row of stmt.iterate() as Iterable<unknown[]>) {
      const tuple = `(${row.map(literal).join(",")})`;
      if (size + tuple.length + 1 > MAX_STATEMENT_BYTES) flush();
      batch.push(tuple);
      size += tuple.length + 1;
    }
    flush();
  }
  await new Promise<void>((r) => w.end(r));
  close();
  console.log(`[d1] wrote ${out}: ${statements} statements, ${statSync(out).size.toLocaleString("en-US")} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
