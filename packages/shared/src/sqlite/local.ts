import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { MAX_PARAMS, type SqlDb } from "./client.js";
import * as schema from "./schema.js";

// Node-only: the local SQLite file used for backfill and full runs (SPEC §7.10).

export const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

/** Apply drizzle-kit migrations not yet recorded in `_migrations` (local file). */
export function migrate(raw: DatabaseSync, dir = MIGRATIONS_DIR): string[] {
  raw.exec("create table if not exists _migrations (name text primary key, applied_at integer not null)");
  const applied = new Set((raw.prepare("select name from _migrations").all() as Array<{ name: string }>).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(resolve(dir, f), "utf8");
    raw.exec("begin");
    try {
      for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) raw.exec(stmt);
      raw.prepare("insert into _migrations (name, applied_at) values (?, ?)").run(f, Date.now());
      raw.exec("commit");
    } catch (err) {
      raw.exec("rollback");
      throw new Error(`migration ${f} failed: ${(err as Error).message}`);
    }
    ran.push(f);
  }
  return ran;
}

/** Normalise node:sqlite values for drizzle (blobs arrive as Uint8Array already). */
const params = (ps: unknown[]) => ps.map((p) => (typeof p === "boolean" ? Number(p) : p)) as Parameters<ReturnType<DatabaseSync["prepare"]>["run"]>;

/** Open (and migrate) a local SQLite file, or ":memory:" for tests. */
export function openLocal(path: string): { db: SqlDb; raw: DatabaseSync; close: () => void } {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  // Loaded at runtime: bundlers/test runners (vite) don't know the node:sqlite builtin yet.
  const { DatabaseSync: Sqlite } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const raw = new Sqlite(path);
  raw.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = off;");
  migrate(raw);
  const db = drizzle(
    async (sql, ps, method) => {
      // Conservative cap on bound parameters: keeps every query batched and portable.
      if (ps.length > MAX_PARAMS) throw new Error(`too many SQL variables: ${ps.length} > ${MAX_PARAMS} (parameter cap)`);
      const stmt = raw.prepare(sql);
      if (method === "run") {
        stmt.run(...params(ps));
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      if (method === "get") {
        const row = stmt.get(...params(ps)) as unknown[] | undefined;
        return { rows: (row ?? undefined) as unknown as unknown[] };
      }
      return { rows: stmt.all(...params(ps)) as unknown as unknown[][] };
    },
    { schema },
  );
  return { db, raw, close: () => raw.close() };
}

