import { inArray, sql } from "drizzle-orm";
import { AddressBook, MAX_PARAMS, chunks, rows, sqliteSchema as s, type SqlDb } from "@nuno/shared";
import { Nansen, isInfraLabel } from "./nansen.js";

/**
 * Nansen checks, in priority order, within the free-plan budget (directive 5):
 *  (a) hub funders: an origin that first-funded ≥ 3 token participants (a candidate cluster). One
 *      related-wallets call on a wallet it funded returns the hub with its `address_label`
 *      (1 credit; the labels endpoint costs 100 and is unusable on the free plan). Infrastructure
 *      labels are stored and stop the hub from linking wallets.
 *  (b) top entities by size: related-wallets on the entity id wallet, shown with the evidence
 *      (display only; it does not create links).
 * Biggest groups first. Every result is cached forever; cached addresses are never re-queried.
 */
export const HUB_MIN_WALLETS = 3;
const TOP_ENTITIES = 3;

export async function nansenChecks(db: SqlDb, book: AddressBook, nansen: Nansen, log: (m: string) => void) {
  const result = { hubsChecked: 0, hubsInfra: 0, entitiesChecked: 0, creditsSpent: 0, stopped: null as string | null };

  // (a) Hubs: origins funding ≥ 3 distinct participants, biggest first, not yet labelled.
  const hubs = await rows<{ origin: number; n: number; child: number }>(
    db,
    sql`select fe.origin as origin, count(distinct fe.wallet) as n, min(fe.wallet) as child
        from funding_edges fe
        where fe.wallet in (select trader from curve_trades union select tx_from from curve_trades where tx_from is not null
                            union select "to" from transfers)
          and fe.origin not in (select address from labels)
        group by fe.origin having count(distinct fe.wallet) >= ${HUB_MIN_WALLETS}
        order by n desc`,
    ["origin", "n", "child"],
  );
  for (const h of hubs) {
    const [hubHex, childHex] = [await book.hex(Number(h.origin)), await book.hex(Number(h.child))];
    if (!hubHex || !childHex) continue;
    const related = await nansen.relatedWallets(childHex);
    if (!related) {
      result.stopped = nansen.disabled;
      break;
    }
    const hubRow = related.find((r) => r.address === hubHex.toLowerCase());
    const label = hubRow?.label ?? null;
    const category = isInfraLabel(label) ? "infrastructure" : label ? "labelled" : "unlabelled";
    await db
      .insert(s.labels)
      .values({ address: Number(h.origin), label: label ?? "", category, fetchedAt: Date.now() })
      .onConflictDoUpdate({ target: s.labels.address, set: { label: label ?? "", category, fetchedAt: Date.now() } });
    result.hubsChecked++;
    if (category === "infrastructure") {
      result.hubsInfra++;
      log(`[nansen] hub ${hubHex} funds ${h.n} participants and is labelled "${label}": treated as infrastructure`);
    }
  }

  // (b) Top entities by size: related wallets of the entity id wallet (cached, display only).
  if (!nansen.disabled) {
    const top = await rows<{ entity: number; n: number }>(
      db,
      sql`select entity, count(*) as n from entity_members group by entity order by n desc limit ${TOP_ENTITIES}`,
      ["entity", "n"],
    );
    for (const e of top) {
      const hex = await book.hex(Number(e.entity));
      if (!hex) continue;
      if (await nansen.cached(hex)) continue;
      if (!(await nansen.relatedWallets(hex))) break;
      result.entitiesChecked++;
    }
  }
  result.creditsSpent = nansen.spent;
  result.stopped = result.stopped ?? nansen.disabled;
  return result;
}

/** Labels for display (exports): address id -> { label, category }. */
export async function labelsFor(db: SqlDb, ids: number[]) {
  const out = new Map<number, { label: string; category: string }>();
  for (const part of chunks([...new Set(ids)], MAX_PARAMS - 1)) {
    for (const r of await db.select().from(s.labels).where(inArray(s.labels.address, part))) out.set(r.address, { label: r.label, category: r.category });
  }
  return out;
}
