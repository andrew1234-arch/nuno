import { eq, inArray, sql } from "drizzle-orm";
import { MAX_PARAMS, MONAD_SECONDS_PER_BLOCK, chunks, rows, sqliteSchema as s, txHex, type SqlDb } from "@nuno/shared";

/**
 * Daily prune (SPEC §7.11 rules 5, 6, 9). Pruned tokens keep their `tokens` row (pruned = 1) and
 * their latest `token_metrics` row as the one-row summary; their event rows are deleted.
 */
export interface PruneOptions {
  /** Current indexed head block. */
  head: number;
  /** Tokens created before this block are outside the window (rule 6). */
  windowStartBlock: number;
  /** Rule 5: after 24 h, tokens with fewer distinct buyers than this are pruned. */
  minBuyers: number;
  /** Rule 9: one snapshot per day kept in addition to the latest per token. */
  nowMs: number;
}

export interface PruneResult {
  prunedTokens: number;
  deletedTrades: number;
  deletedTransfers: number;
  deletedSwaps: number;
  deletedSnapshots: number;
}

const BLOCKS_PER_DAY = Math.round(86_400 / MONAD_SECONDS_PER_BLOCK);

export async function prune(db: SqlDb, o: PruneOptions): Promise<PruneResult> {
  const result: PruneResult = { prunedTokens: 0, deletedTrades: 0, deletedTransfers: 0, deletedSwaps: 0, deletedSnapshots: 0 };

  // Rule 6: outside the window. Rule 5: older than 24 h with too few distinct buyers.
  const candidates = await rows<{ id: number; create_block: number; buyers: number }>(
    db,
    sql`select t.id as id, t.create_block as create_block,
               (select count(distinct case when sw.is_contract = 1 and ct.tx_from is not null then ct.tx_from else ct.trader end)
                  from curve_trades ct left join wallets sw on sw.id = ct.trader
                  where ct.token = t.id and ct.side = ${s.SIDE.buy}) as buyers
        from tokens t where t.pruned = 0`,
    ["id", "create_block", "buyers"],
  );
  const toPrune = candidates
    .filter((t) => Number(t.create_block) < o.windowStartBlock || (o.head - Number(t.create_block) >= BLOCKS_PER_DAY && Number(t.buyers) < o.minBuyers))
    .map((t) => Number(t.id));

  for (const part of chunks(toPrune, MAX_PARAMS - 1)) {
    const count = async (table: typeof s.curveTrades | typeof s.transfers | typeof s.dexSwaps) =>
      Number((await db.select({ n: sql<number>`count(*)` }).from(table).where(inArray(table.token, part)))[0]?.n ?? 0);
    result.deletedTrades += await count(s.curveTrades);
    result.deletedTransfers += await count(s.transfers);
    result.deletedSwaps += await count(s.dexSwaps);
    await db.delete(s.curveTrades).where(inArray(s.curveTrades.token, part));
    await db.delete(s.transfers).where(inArray(s.transfers.token, part));
    await db.delete(s.dexSwaps).where(inArray(s.dexSwaps.token, part));
    await db.update(s.tokens).set({ pruned: 1 }).where(inArray(s.tokens.id, part));
  }
  result.prunedTokens = toPrune.length;

  // Rule 9: keep the latest snapshot per token, plus the latest one of each earlier UTC day.
  const snaps = await db.select({ tx: s.snapshots.tx, token: s.snapshots.token, at: s.snapshots.publishedAt, block: s.snapshots.publishBlock }).from(s.snapshots);
  const keep = new Set<string>();
  const latest = new Map<number, (typeof snaps)[number]>();
  const perDay = new Map<string, (typeof snaps)[number]>();
  for (const sn of snaps) {
    const l = latest.get(sn.token);
    if (!l || sn.block > l.block) latest.set(sn.token, sn);
    const day = `${sn.token}:${new Date(sn.at).toISOString().slice(0, 10)}`;
    const d = perDay.get(day);
    if (!d || sn.block > d.block) perDay.set(day, sn);
  }
  for (const sn of [...latest.values(), ...perDay.values()]) keep.add(txHex(sn.tx));
  const drop = snaps.filter((sn) => !keep.has(txHex(sn.tx)));
  for (const sn of drop) await db.delete(s.snapshots).where(eq(s.snapshots.tx, sn.tx));
  result.deletedSnapshots = drop.length;
  return result;
}
