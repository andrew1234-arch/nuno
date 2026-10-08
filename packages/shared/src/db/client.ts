import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(url = config.databaseUrl) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}

export async function getCursorBlock(db: Db, name: string): Promise<number | null> {
  const rows = await db.select().from(schema.cursors).where(eq(schema.cursors.name, name));
  return rows[0]?.block ?? null;
}
