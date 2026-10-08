import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SQL } from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteTable } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.js";

/**
 * Async SQLite database used by every package: the local node:sqlite file (via drizzle's proxy
 * driver, no native deps) and Cloudflare D1 (drizzle-orm/d1) share this type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the result type differs per driver (proxy vs D1).
export type SqlDb = BaseSQLiteDatabase<"async", any, typeof schema>;

export const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

/** Apply drizzle-kit migrations not yet recorded in `_migrations` (local file only; D1 uses wrangler). */
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

/** D1 / SQLite allow at most 100 bound parameters per statement (D1 limit, checked 2026-10-08). */
export const MAX_PARAMS = 100;

/** Insert rows in chunks that stay under MAX_PARAMS, ignoring rows that already exist. */
export async function insertIgnore<T extends SQLiteTable>(db: SqlDb, table: T, rows: Array<T["$inferInsert"]>): Promise<void> {
  if (!rows.length) return;
  const cols = Math.max(1, Object.keys(rows[0]!).length);
  const size = Math.max(1, Math.floor(MAX_PARAMS / cols));
  for (let i = 0; i < rows.length; i += size) {
    await db.insert(table).values(rows.slice(i, i + size)).onConflictDoNothing();
  }
}

export function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** First column of the first row of a raw query, on either driver (proxy returns arrays, D1 objects). */
export async function scalar(db: SqlDb, query: SQL): Promise<number> {
  const r: unknown = await db.get(query);
  if (Array.isArray(r)) return Number(r[0] ?? 0);
  if (r && typeof r === "object") return Number(Object.values(r)[0] ?? 0);
  return 0;
}

/** Raw rows as objects keyed by column name, on either driver. */
export async function rows<T extends Record<string, unknown>>(db: SqlDb, query: SQL, columns: Array<keyof T & string>): Promise<T[]> {
  const rs: unknown[] = await db.all(query);
  return rs.map((r) => (Array.isArray(r) ? (Object.fromEntries(columns.map((c, i) => [c, r[i]])) as T) : (r as T)));
}
