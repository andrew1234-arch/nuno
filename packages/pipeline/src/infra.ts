import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { infrastructureSet } from "@nuno/metrics";
import { AddressBook, sqliteSchema as s, type SqlDb } from "@nuno/shared";
import { ROOT_DIR } from "@nuno/shared/node";

/**
 * Addresses that must never link wallets, from three sources:
 *  1. `data/infra-addresses.json`: hand-maintained, every entry has a `source` (directive 5 fallback);
 *  2. `packages/metrics/src/infrastructure.json`: the on-chain exchange-like heuristic (`pnpm infra:scan`);
 *  3. Nansen labels classified as infrastructure (`labels.category = 'infrastructure'`).
 */
export interface ManualInfraEntry {
  address: string;
  /** Where this classification comes from (URL, explorer label, Nansen, etc.). Required. */
  source: string;
  note?: string;
}

export function manualInfrastructure(path = resolve(ROOT_DIR, "data/infra-addresses.json")): ManualInfraEntry[] {
  try {
    const list = JSON.parse(readFileSync(path, "utf8")) as ManualInfraEntry[];
    for (const e of list) if (!e.source) throw new Error(`infra entry ${e.address} has no source`);
    return list;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function infrastructure(db: SqlDb, book: AddressBook): Promise<Set<string>> {
  const out = new Set<string>([...manualInfrastructure().map((e) => e.address.toLowerCase()), ...infrastructureSet()]);
  const labelled = await db.select({ a: s.labels.address }).from(s.labels).where(eq(s.labels.category, "infrastructure"));
  for (const h of (await book.hexes(labelled.map((r) => r.a))).values()) out.add(h.toLowerCase());
  return out;
}
