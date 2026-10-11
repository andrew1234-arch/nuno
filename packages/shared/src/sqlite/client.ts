import { getTableColumns, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import type * as schema from "./schema.js";

/** Async SQLite database used by every package: the local node:sqlite file via drizzle's proxy driver. */
export type SqlDb = SqliteRemoteDatabase<typeof schema>;

/** At most 100 bound parameters per statement: a conservative cap that keeps queries batched. */
export const MAX_PARAMS = 100;

/** Insert rows in chunks that stay under MAX_PARAMS, ignoring rows that already exist. */
export async function insertIgnore<T extends SQLiteTable>(db: SqlDb, table: T, rows: Array<T["$inferInsert"]>): Promise<void> {
  if (!rows.length) return;
  // Drizzle binds a parameter for every column (including ones with JS defaults), so size chunks
  // by the table's column count, not by the keys present in the rows.
  const cols = Math.max(1, Object.keys(getTableColumns(table)).length);
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

/** First column of the first row of a raw query, on either driver (proxy returns arrays, others objects). */
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
