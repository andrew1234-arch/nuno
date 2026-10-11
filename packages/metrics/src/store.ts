import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { hexToBytes } from "viem";
import {
  DEFAULT_CLUSTER_CONFIG,
  buildLinks,
  meetsThreshold,
  pairWeight,
  type Cluster,
  type ClusterConfig,
  type ClusterInput,
  type EdgeType,
  type Evidence,
  type FundingEdge,
  type Link,
} from "@nuno/cluster";
import {
  AddressBook,
  MAX_PARAMS,
  NADFUN_MAINNET,
  chunks,
  insertIgnore,
  isContractCode,
  sqliteSchema as s,
  toHex,
  txBytes,
  txHex,
  type RpcClient,
  type SqlDb,
} from "@nuno/shared";
import { effectiveTrader, swapAsTrade } from "./attribution.js";
import { ZERO, computeMetrics, evidenceRoot, type TokenMetrics, type VolumeTrade } from "./metrics.js";

/**
 * Storage side of clustering + metrics on SQLite (SPEC §7.9a, §7.10).
 *  - Full run (local): every link rebuilt, link_evidence and entity_members replaced, all tokens recomputed.
 *  - Incremental run (cron): links rebuilt only for the neighbourhood of new activity and inserted
 *    idempotently; touched pairs re-scored from ALL their stored evidence; entities only merge.
 */

export interface StoreCtx {
  db: SqlDb;
  book: AddressBook;
  /** Archive RPC for eth_getCode on unclassified addresses. */
  rpc: RpcClient;
  infrastructure: Set<string>;
  cfg?: ClusterConfig;
  log?: (msg: string) => void;
}

const EDGE_NAMES = Object.fromEntries(Object.entries(s.EDGE_TYPE).map(([k, v]) => [v, k])) as Record<number, EdgeType>;
const PROTOCOL = [
  NADFUN_MAINNET.CURVE,
  NADFUN_MAINNET.BONDING_CURVE_ROUTER,
  NADFUN_MAINNET.DEX_ROUTER,
  NADFUN_MAINNET.CREATOR_TREASURY,
  NADFUN_MAINNET.WMON,
  NADFUN_MAINNET.LENS,
].map((a) => a.toLowerCase());

type TokenRow = typeof s.tokens.$inferSelect;
type TradeRow = typeof s.curveTrades.$inferSelect;
type TransferRow = typeof s.transfers.$inferSelect;

async function inChunks<T>(ids: number[], q: (part: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks([...new Set(ids)], MAX_PARAMS - 1)) out.push(...(await q(part)));
  return out;
}

/** Contract classification for address ids, using wallets.is_contract and eth_getCode for unknowns. */
export async function contractIds(ctx: StoreCtx, ids: number[], atBlock: number): Promise<Set<number>> {
  const known = await inChunks(ids, (part) =>
    ctx.db.select({ id: s.wallets.id, c: s.wallets.isContract }).from(s.wallets).where(inArray(s.wallets.id, part)),
  );
  const map = new Map(known.map((k) => [k.id, k.c]));
  const unknown = [...new Set(ids)].filter((id) => map.get(id) == null);
  if (unknown.length) ctx.log?.(`[store] eth_getCode for ${unknown.length} unclassified addresses`);
  const hex = await ctx.book.hexes(unknown);
  for (const part of chunks(unknown, 6)) {
    await Promise.all(
      part.map(async (id) => {
        const code = await ctx.rpc.call<Hex>("eth_getCode", [hex.get(id)! as Address, toHex(atBlock)], { cache: true });
        const isContract = isContractCode(code) ? 1 : 0;
        map.set(id, isContract);
        await ctx.db.insert(s.wallets).values({ id, isContract }).onConflictDoUpdate({ target: s.wallets.id, set: { isContract } });
      }),
    );
  }
  return new Set([...map].filter(([, c]) => c === 1).map(([id]) => id));
}

interface Loaded {
  tokens: TokenRow[];
  trades: TradeRow[];
  transfers: TransferRow[];
  /** Post-graduation Uniswap V3 swaps (volume only). */
  swaps: Array<typeof s.dexSwaps.$inferSelect>;
  funding: Array<typeof s.fundingEdges.$inferSelect>;
}

/** Protocol contracts, curve pools and graduated pools: never holders, never members. */
async function excludedIds(ctx: StoreCtx, tokens: TokenRow[]): Promise<Set<number>> {
  const ids = await ctx.book.ids([ZERO, ...PROTOCOL]);
  const out = new Set(ids.values());
  for (const t of tokens) {
    out.add(t.curvePool);
    if (t.graduatedPool) out.add(t.graduatedPool);
  }
  return out;
}

/** Re-attribute bot-contract trades to their signer (same rule as the API and funding queue). */
function attribute(trades: TradeRow[], contracts: Set<number>): TradeRow[] {
  const asStr = new Set([...contracts].map(String));
  return trades.map((t) => ({ ...t, trader: Number(effectiveTrader(String(t.trader), t.txFrom === null ? null : String(t.txFrom), asStr)) }));
}

/** Engine input in hex addresses (the engine's entity ids are the smallest member address). */
async function toInput(ctx: StoreCtx, data: Loaded, wallets: number[], contracts: Set<number>): Promise<{ input: ClusterInput; hex: Map<number, string> }> {
  const ids = [
    ...wallets,
    ...data.tokens.flatMap((t) => [t.id, t.creator]),
    ...data.trades.map((t) => t.token),
    ...data.transfers.flatMap((t) => [t.token, t.from, t.to]),
    ...data.funding.flatMap((f) => [f.wallet, f.funder, f.origin]),
    ...contracts,
  ];
  const hexMap = await ctx.book.hexes(ids);
  const hex = new Map([...hexMap].map(([k, v]) => [k, v.toLowerCase()]));
  const h = (id: number) => hex.get(id)!;
  const input: ClusterInput = {
    launches: data.tokens.map((t) => ({ token: h(t.id), creator: h(t.creator), createBlock: t.createBlock })),
    wallets: wallets.map(h),
    contracts: new Set([...contracts].map(h)),
    infrastructure: ctx.infrastructure,
    funding: data.funding.map(
      (f): FundingEdge => ({ wallet: h(f.wallet), funder: h(f.funder), origin: h(f.origin), block: f.block, blockTime: f.blockTime, txHash: txHex(f.tx) }),
    ),
    trades: data.trades.map((t) => ({ token: h(t.token), wallet: h(t.trader), side: t.side === s.SIDE.buy ? "buy" : "sell", block: t.block, txHash: txHex(t.tx) })),
    transfers: data.transfers.map((t) => ({ token: h(t.token), from: h(t.from), to: h(t.to), block: t.block, txHash: txHex(t.tx) })),
  };
  return { input, hex };
}

/** Links -> link_evidence rows (a < b by address id). */
async function evidenceRows(ctx: StoreCtx, links: Link[]): Promise<Array<typeof s.linkEvidence.$inferInsert>> {
  const ids = await ctx.book.ids(links.flatMap((l) => [l.a, l.b, ...l.evidence.flatMap((e) => [e.token, e.detail].filter((x): x is string => !!x))]));
  const id = (a: string) => ids.get(a.toLowerCase())!;
  return links.flatMap((l) => {
    const [a, b] = [id(l.a), id(l.b)].sort((x, y) => x - y) as [number, number];
    return l.evidence.map((e) => ({
      a,
      b,
      type: s.EDGE_TYPE[l.type],
      tx: txBytes(e.txHash),
      block: e.block,
      token: e.token ? id(e.token) : 0,
      detail: e.detail ? id(e.detail) : 0,
    }));
  });
}

type EvRow = typeof s.linkEvidence.$inferSelect;
const pairKey = (a: number, b: number) => `${a}|${b}`;

/** Accepted pairs among evidence rows (weights derived from the rows themselves). */
function acceptedPairs(rows: EvRow[], cfg: ClusterConfig): Map<string, EvRow[]> {
  const byPair = new Map<string, EvRow[]>();
  for (const r of rows) {
    const k = pairKey(r.a, r.b);
    const l = byPair.get(k);
    if (l) l.push(r);
    else byPair.set(k, [r]);
  }
  const out = new Map<string, EvRow[]>();
  for (const [k, rs] of byPair) {
    const w = pairWeight(
      rs.map((r) => ({ type: EDGE_NAMES[r.type]!, txHash: txHex(r.tx), block: r.block, token: r.token ? String(r.token) : undefined })),
      cfg,
    );
    if (meetsThreshold(w, cfg)) out.set(k, rs);
  }
  return out;
}

/** Union accepted pairs on top of existing memberships; returns wallet -> entity (smallest member address). */
async function mergeEntities(ctx: StoreCtx, accepted: Map<string, EvRow[]>, existing: Map<number, number>): Promise<Map<number, number>> {
  const parent = new Map<number, number>();
  const nodes = new Set<number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) {
      const n = parent.get(c) ?? r;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    nodes.add(a);
    nodes.add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [w, e] of existing) union(w, e);
  for (const rs of accepted.values()) union(rs[0]!.a, rs[0]!.b);

  const groups = new Map<number, number[]>();
  for (const x of nodes) {
    const r = find(x);
    const g = groups.get(r);
    if (g) g.push(x);
    else groups.set(r, [x]);
  }
  const hex = await ctx.book.hexes([...nodes]);
  const out = new Map<number, number>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Entity id = member with the smallest address (stable across runs and with the engine).
    const id = members.reduce((m, x) => (hex.get(x)! < hex.get(m)! ? x : m), members[0]!);
    for (const w of members) out.set(w, id);
  }
  return out;
}

async function writeMembers(ctx: StoreCtx, members: Map<number, number>, replaceAll: boolean) {
  if (replaceAll) await ctx.db.delete(s.entityMembers);
  const rows = [...members].map(([wallet, entity]) => ({ wallet, entity }));
  for (const part of chunks(rows, Math.floor(MAX_PARAMS / 2))) {
    await ctx.db.insert(s.entityMembers).values(part).onConflictDoUpdate({ target: s.entityMembers.wallet, set: { entity: sql`excluded.entity` } });
  }
}

/** Participants (holders/senders/receivers, attributed traders, creator) per token, excluding contracts. */
function participants(data: Loaded, attributed: TradeRow[], excluded: Set<number>, contracts: Set<number>): Map<number, Set<number>> {
  const by = new Map<number, Set<number>>(data.tokens.map((t) => [t.id, new Set([t.creator])]));
  for (const t of data.transfers) for (const a of [t.from, t.to]) if (!excluded.has(a)) by.get(t.token)?.add(a);
  for (const t of attributed) if (!contracts.has(t.trader)) by.get(t.token)?.add(t.trader);
  return by;
}

/** Clusters (engine shape, hex) for the given entity ids, with their accepted links' evidence. */
async function clustersFor(ctx: Pick<StoreCtx, "db" | "book">, entityIds: number[], cfg: ClusterConfig): Promise<Cluster[]> {
  if (!entityIds.length) return [];
  const members = await inChunks(entityIds, (part) => ctx.db.select().from(s.entityMembers).where(inArray(s.entityMembers.entity, part)));
  const byEntity = new Map<number, number[]>();
  for (const m of members) byEntity.set(m.entity, [...(byEntity.get(m.entity) ?? []), m.wallet]);
  const allWallets = members.map((m) => m.wallet);
  const ev = await inChunks(allWallets, (part) => ctx.db.select().from(s.linkEvidence).where(inArray(s.linkEvidence.a, part)));
  const entityOf = new Map(members.map((m) => [m.wallet, m.entity]));
  const accepted = acceptedPairs(ev.filter((r) => entityOf.get(r.a) !== undefined && entityOf.get(r.a) === entityOf.get(r.b)), cfg);
  const creators = await inChunks(allWallets, (part) =>
    ctx.db.select({ id: s.tokens.id, creator: s.tokens.creator }).from(s.tokens).where(inArray(s.tokens.creator, part)),
  );
  const hex = await ctx.book.hexes([...allWallets, ...ev.flatMap((r) => [r.token, r.detail]), ...creators.map((c) => c.id)]);
  const h = (id: number) => hex.get(id)!.toLowerCase();
  const out: Cluster[] = [];
  for (const [entity, ws] of byEntity) {
    const set = new Set(ws);
    const links: Link[] = [];
    for (const rs of accepted.values()) {
      if (!set.has(rs[0]!.a)) continue;
      const byType = new Map<number, EvRow[]>();
      for (const r of rs) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
      for (const [type, trs] of byType) {
        links.push({
          a: h(trs[0]!.a),
          b: h(trs[0]!.b),
          type: EDGE_NAMES[type]!,
          weight: (cfg.weights as Record<EdgeType, number>)[EDGE_NAMES[type]!],
          evidence: trs.map(
            (r): Evidence => ({
              type: EDGE_NAMES[type]!,
              txHash: txHex(r.tx),
              block: r.block,
              ...(r.token ? { token: h(r.token) } : {}),
              ...(r.detail ? { detail: h(r.detail) } : {}),
            }),
          ),
        });
      }
    }
    out.push({
      id: h(entity),
      members: ws.map(h).sort(),
      createdTokens: creators.filter((c) => set.has(c.creator)).map((c) => h(c.id)).sort(),
      links,
    });
  }
  return out;
}

async function computeAndStoreMetrics(
  ctx: StoreCtx,
  data: Loaded,
  tokenIds: number[],
  attributed: TradeRow[],
  excluded: Set<number>,
  contracts: Set<number>,
  sourceBlock: number,
  cfg: ClusterConfig,
): Promise<Array<{ token: number; symbol: string; metrics: TokenMetrics; entities: number }>> {
  const parts = participants(data, attributed, excluded, contracts);
  const allParts = [...new Set([...parts.values()].flatMap((x) => [...x]))];
  const mem = await inChunks(allParts, (part) => ctx.db.select().from(s.entityMembers).where(inArray(s.entityMembers.wallet, part)));
  const entityOfId = new Map(mem.map((m) => [m.wallet, m.entity]));
  const hex = await ctx.book.hexes([
    ...allParts,
    ...mem.map((m) => m.entity),
    ...data.transfers.flatMap((t) => [t.from, t.to]),
    ...data.swaps.flatMap((w) => [w.recipient, ...(w.txFrom ? [w.txFrom] : [])]),
    ...contracts,
    ...data.tokens.flatMap((t) => [t.id, t.creator]),
  ]);
  const wmon = NADFUN_MAINNET.WMON.toLowerCase();
  const h = (id: number) => hex.get(id)!.toLowerCase();
  const entityOf = new Map([...entityOfId].map(([w, e]) => [h(w), h(e)]));
  const contractHex = new Set([...contracts].map(h));

  const out: Array<{ token: number; symbol: string; metrics: TokenMetrics; entities: number }> = [];
  // An entity active in many tokens is loaded once, not once per token.
  const clusterCache = new Map<number, Cluster>();
  const entityIdByHex = new Map([...new Set(mem.map((m) => m.entity))].map((e) => [h(e), e]));
  for (const tok of data.tokens.filter((t) => tokenIds.includes(t.id))) {
    const ents = [...new Set([...(parts.get(tok.id) ?? [])].map((p) => entityOfId.get(p)).filter((e): e is number => e !== undefined))];
    const missingEnts = ents.filter((e) => !clusterCache.has(e));
    for (const c of await clustersFor(ctx, missingEnts, cfg)) clusterCache.set(entityIdByHex.get(c.id)!, c);
    const clusters = ents.map((e) => clusterCache.get(e)).filter((c): c is Cluster => c !== undefined);
    const trades: VolumeTrade[] = attributed
      .filter((t) => t.token === tok.id)
      .map((t) =>
        t.side === s.SIDE.buy
          ? { wallet: h(t.trader), side: "buy", block: t.block, mon: BigInt(t.amountIn), tokens: BigInt(t.amountOut) }
          : { wallet: h(t.trader), side: "sell", block: t.block, mon: BigInt(t.amountOut), tokens: BigInt(t.amountIn) },
      );
    // DEX swaps after graduation: attributed to the tx signer (the Swap sender is the router).
    for (const w of data.swaps.filter((x) => x.token === tok.id)) {
      const t = swapAsTrade({ amount0: BigInt(w.amount0), amount1: BigInt(w.amount1) }, h(tok.id), wmon);
      if (t) trades.push({ wallet: h(w.txFrom ?? w.recipient), side: t.side, block: w.block, mon: t.mon, tokens: t.tokens });
    }
    const metrics = computeMetrics({
      token: h(tok.id),
      creator: h(tok.creator),
      sourceBlock,
      transfers: data.transfers.filter((t) => t.token === tok.id).map((t) => ({ from: h(t.from), to: h(t.to), value: BigInt(t.value) })),
      excludedHolders: contractHex,
      entityOf,
      clusters,
      trades,
    });
    const row = {
      sourceBlock,
      totalSupply: metrics.totalSupply.toString(),
      rawHolders: metrics.rawHolders,
      realHolders: metrics.realHolders,
      effectiveTop10Bps: metrics.effectiveTop10Bps,
      clusterSupplyBps: metrics.clusterSupplyBps,
      creatorLinkedSupplyBps: metrics.creatorLinkedSupplyBps,
      rawVolume: metrics.rawVolume.toString(),
      organicVolume: metrics.organicVolume.toString(),
      organicVolumeBps: metrics.organicVolumeBps,
      evidenceRoot: hexToBytes(metrics.evidenceRoot),
      computedAt: Date.now(),
    };
    await ctx.db.insert(s.tokenMetrics).values({ token: tok.id, ...row }).onConflictDoUpdate({ target: s.tokenMetrics.token, set: row });
    out.push({ token: tok.id, symbol: tok.symbol, metrics, entities: clusters.length });
  }
  return out;
}

async function loadAll(ctx: StoreCtx, sourceBlock: number): Promise<Loaded> {
  const { db } = ctx;
  return {
    tokens: await db.select().from(s.tokens).where(and(lte(s.tokens.createBlock, sourceBlock), eq(s.tokens.pruned, 0))),
    trades: await db.select().from(s.curveTrades).where(lte(s.curveTrades.block, sourceBlock)),
    transfers: await db.select().from(s.transfers).where(lte(s.transfers.block, sourceBlock)),
    swaps: await db.select().from(s.dexSwaps).where(lte(s.dexSwaps.block, sourceBlock)),
    funding: await db.select().from(s.fundingEdges),
  };
}

/** Tokens a set of wallets traded (incl. bot-routed and DEX) or sent/received. */
async function tokensTouchedBy(ctx: Pick<StoreCtx, "db">, ids: number[]): Promise<number[]> {
  const out = new Set<number>();
  // The id list is bound 5 times: 19 ids x 5 = 95 parameters, under the 100 limit.
  for (const part of chunks([...new Set(ids)], Math.floor((MAX_PARAMS - 1) / 5))) {
    const list = sql.join(part.map((x) => sql`${x}`), sql`, `);
    const rs = await ctx.db.all<unknown>(sql`
      select token from curve_trades where trader in (${list})
      union select token from curve_trades where tx_from in (${list})
      union select token from transfers where "from" in (${list})
      union select token from transfers where "to" in (${list})
      union select token from dex_swaps where tx_from in (${list})`);
    for (const r of rs) out.add(Number(Array.isArray(r) ? r[0] : Object.values(r as Record<string, unknown>)[0]));
  }
  return [...out];
}

/** The subset of `ids` that traded (attributed) or sent/received a tracked, unpruned token. */
async function participantsAmong(ctx: StoreCtx, ids: number[]): Promise<number[]> {
  const out = new Set<number>();
  // The id list is bound 5 times: 19 ids x 5 = 95 parameters, under the 100-parameter cap.
  for (const part of chunks(ids, Math.floor((MAX_PARAMS - 1) / 5))) {
    const list = sql.join(part.map((x) => sql`${x}`), sql`, `);
    const rs = await ctx.db.all<unknown>(sql`
      select ct.trader from curve_trades ct where ct.trader in (${list})
      union select ct.tx_from from curve_trades ct join wallets sw on sw.id = ct.trader
        where sw.is_contract = 1 and ct.tx_from in (${list})
      union select tr."from" from transfers tr where tr."from" in (${list})
      union select tr."to" from transfers tr where tr."to" in (${list})
      union select t.creator from tokens t where t.creator in (${list})`);
    for (const r of rs) out.add(Number(Array.isArray(r) ? r[0] : Object.values(r as Record<string, unknown>)[0]));
  }
  return [...out];
}

export interface RunSummary {
  sourceBlock: number;
  entities: number;
  tokens: Array<{ token: number; symbol: string; metrics: TokenMetrics; entities: number }>;
  reattributed: number;
}

/** Full recompute (local or the recluster job, SPEC §7.9a). */
export async function fullRun(ctx: StoreCtx, sourceBlock: number): Promise<RunSummary> {
  const cfg = ctx.cfg ?? DEFAULT_CLUSTER_CONFIG;
  const data = await loadAll(ctx, sourceBlock);
  const excluded = await excludedIds(ctx, data.tokens);
  const candidates = [...new Set([...data.tokens.map((t) => t.creator), ...data.transfers.flatMap((t) => [t.from, t.to]), ...data.trades.flatMap((t) => (t.txFrom ? [t.trader, t.txFrom] : [t.trader]))])].filter(
    (a) => !excluded.has(a),
  );
  const contracts = await contractIds(ctx, candidates, sourceBlock);
  for (const e of excluded) contracts.add(e);
  const attributed = attribute(data.trades, contracts);
  const reattributed = attributed.filter((t, i) => t.trader !== data.trades[i]!.trader).length;
  const parts = participants(data, attributed, excluded, contracts);
  const wallets = [...new Set([...parts.values()].flatMap((x) => [...x]))];

  const { input } = await toInput(ctx, { ...data, trades: attributed }, wallets, contracts);
  const links = buildLinks(input, cfg);
  await ctx.db.delete(s.linkEvidence);
  await insertIgnore(ctx.db, s.linkEvidence, await evidenceRows(ctx, links));
  const allEv = await ctx.db.select().from(s.linkEvidence);
  const members = await mergeEntities(ctx, acceptedPairs(allEv, cfg), new Map());
  await writeMembers(ctx, members, true);
  ctx.log?.(`[store] full run: ${wallets.length} wallets, ${links.length} links, ${new Set(members.values()).size} entities, ${reattributed} trades re-attributed`);

  const tokens = await computeAndStoreMetrics(ctx, { ...data }, data.tokens.map((t) => t.id), attributed, excluded, contracts, sourceBlock, cfg);
  return { sourceBlock, entities: new Set(members.values()).size, tokens, reattributed };
}

/**
 * Incremental update for activity after `sinceBlock` and newly resolved funding (cron, SPEC §7.9a).
 * Bounded: loads trades/transfers only for affected tokens, plus all funding edges (≤5 per wallet).
 */
export async function incrementalRun(ctx: StoreCtx, sinceBlock: number, sourceBlock: number, newlyFunded: number[] = []): Promise<RunSummary> {
  const cfg = ctx.cfg ?? DEFAULT_CLUSTER_CONFIG;
  const { db } = ctx;
  const touchedTokens = new Set<number>([
    ...(await db.selectDistinct({ t: s.curveTrades.token }).from(s.curveTrades).where(gt(s.curveTrades.block, sinceBlock))).map((r) => r.t),
    ...(await db.selectDistinct({ t: s.transfers.token }).from(s.transfers).where(gt(s.transfers.block, sinceBlock))).map((r) => r.t),
    ...(await db.select({ t: s.tokens.id }).from(s.tokens).where(gt(s.tokens.createBlock, sinceBlock))).map((r) => r.t),
  ]);
  // Tokens of newly funded wallets are affected too (their funding links can merge entities).
  if (newlyFunded.length) {
    for (const t of await tokensTouchedBy(ctx, await participantsAmong(ctx, newlyFunded))) touchedTokens.add(t);
  }
  if (!touchedTokens.size) return { sourceBlock, entities: 0, tokens: [], reattributed: 0 };

  const tokenIds = [...touchedTokens];
  const tokens = await inChunks(tokenIds, (part) => db.select().from(s.tokens).where(and(inArray(s.tokens.id, part), eq(s.tokens.pruned, 0))));
  const data: Loaded = {
    tokens,
    trades: await inChunks(tokenIds, (part) => db.select().from(s.curveTrades).where(and(inArray(s.curveTrades.token, part), lte(s.curveTrades.block, sourceBlock)))),
    transfers: await inChunks(tokenIds, (part) => db.select().from(s.transfers).where(and(inArray(s.transfers.token, part), lte(s.transfers.block, sourceBlock)))),
    swaps: await inChunks(tokenIds, (part) => db.select().from(s.dexSwaps).where(and(inArray(s.dexSwaps.token, part), lte(s.dexSwaps.block, sourceBlock)))),
    funding: await db.select().from(s.fundingEdges),
  };
  const excluded = await excludedIds(ctx, tokens);
  const candidates = [...new Set([...tokens.map((t) => t.creator), ...data.transfers.flatMap((t) => [t.from, t.to]), ...data.trades.flatMap((t) => (t.txFrom ? [t.trader, t.txFrom] : [t.trader])), ...newlyFunded])].filter(
    (a) => !excluded.has(a),
  );
  const contracts = await contractIds(ctx, candidates, sourceBlock);
  for (const e of excluded) contracts.add(e);
  const attributed = attribute(data.trades, contracts);
  const parts = participants(data, attributed, excluded, contracts);

  // Neighbourhood: participants of affected tokens + newly funded wallets + every wallet sharing a
  // funding ancestor with them (so funding-based links to older wallets are found too).
  // Newly funded wallets seed the neighbourhood only if they are token participants: hop-2/3 funding
  // ancestors that never traded or held must not become entity members (same rule as the full run).
  const seed = new Set([...[...parts.values()].flatMap((x) => [...x]), ...(await participantsAmong(ctx, newlyFunded))]);
  const infraIds = new Set<number>();
  for (const a of ctx.infrastructure) {
    const id = await ctx.book.find(a);
    if (id !== undefined) infraIds.add(id);
  }
  const originsOf = new Map<number, number[]>();
  for (const f of data.funding) originsOf.set(f.wallet, [...(originsOf.get(f.wallet) ?? []), f.origin]);
  const ancestors = (w: number) => {
    const out = new Set<number>();
    let frontier = [w];
    for (let hop = 0; hop < cfg.maxFundingHops && frontier.length; hop++) {
      // Never walk through infrastructure: an exchange shares an "ancestor" with everyone it funded.
      frontier = frontier.flatMap((x) => originsOf.get(x) ?? []).filter((o) => !out.has(o) && !infraIds.has(o));
      frontier.forEach((o) => out.add(o));
    }
    return out;
  };
  const seedAnc = new Set([...seed].flatMap((w) => [...ancestors(w)]));
  // Only token participants (traders/holders) can be cluster members, exactly as in the full run:
  // funding ancestors that never traded or held a tracked token must not join entities.
  const fundedSharing = [...new Set(data.funding.map((f) => f.wallet))].filter(
    (w) => !contracts.has(w) && !seed.has(w) && [...ancestors(w)].some((a) => seedAnc.has(a)),
  );
  const neighbours = await participantsAmong(ctx, fundedSharing);
  const wallets = [...new Set([...seed, ...neighbours])].filter((w) => !contracts.has(w));

  const { input } = await toInput(ctx, { ...data, trades: attributed }, wallets, contracts);
  const links = buildLinks(input, cfg);
  const rowsNew = await evidenceRows(ctx, links);
  await insertIgnore(db, s.linkEvidence, rowsNew);

  // Re-score every touched pair from ALL its stored evidence, then merge entities (never split).
  const pairs = [...new Set(rowsNew.map((r) => pairKey(r.a!, r.b!)))].map((k) => k.split("|").map(Number) as [number, number]);
  const ev: EvRow[] = [];
  for (const part of chunks(pairs, 40)) {
    ev.push(
      ...(await db
        .select()
        .from(s.linkEvidence)
        .where(sql.join(part.map(([a, b]) => sql`(${s.linkEvidence.a} = ${a} and ${s.linkEvidence.b} = ${b})`), sql` or `))),
    );
  }
  const accepted = acceptedPairs(ev, cfg);
  const endpoints = [...new Set([...accepted.values()].flatMap((rs) => [rs[0]!.a, rs[0]!.b]))];
  const current = await inChunks(endpoints, (part) => db.select().from(s.entityMembers).where(inArray(s.entityMembers.wallet, part)));
  const entitiesTouched = [...new Set(current.map((m) => m.entity))];
  const existing = await inChunks(entitiesTouched, (part) => db.select().from(s.entityMembers).where(inArray(s.entityMembers.entity, part)));
  const before = new Map(existing.map((m) => [m.wallet, m.entity]));
  const merged = await mergeEntities(ctx, accepted, before);
  // Only wallets whose entity actually changed matter: re-generated evidence for pairs that were
  // already merged must not trigger a recompute of every token the entity touches.
  const changed = new Map([...merged].filter(([w, e]) => before.get(w) !== e));
  if (changed.size) await writeMembers(ctx, changed, false);

  // Tokens of wallets whose entity changed are recomputed too (their entity-level metrics moved).
  const mergedWallets = [...changed.keys()];
  // Via trades, transfers and DEX swaps: a wallet holding through transfers is affected too.
  const missing = (await tokensTouchedBy(ctx, mergedWallets)).filter((t) => !touchedTokens.has(t));
  if (missing.length) {
    const moreTokens = await inChunks(missing, (part) => db.select().from(s.tokens).where(and(inArray(s.tokens.id, part), eq(s.tokens.pruned, 0))));
    const more = await inChunks(missing, (part) => db.select().from(s.curveTrades).where(and(inArray(s.curveTrades.token, part), lte(s.curveTrades.block, sourceBlock))));
    const moreTransfers = await inChunks(missing, (part) => db.select().from(s.transfers).where(and(inArray(s.transfers.token, part), lte(s.transfers.block, sourceBlock))));
    // Same exclusions and classification as the tokens loaded up front: their pools are never holders.
    for (const e of await excludedIds(ctx, moreTokens)) {
      excluded.add(e);
      contracts.add(e);
    }
    const moreCandidates = [...new Set([...moreTokens.map((t) => t.creator), ...moreTransfers.flatMap((t) => [t.from, t.to]), ...more.flatMap((t) => (t.txFrom ? [t.trader, t.txFrom] : [t.trader]))])].filter(
      (x) => !excluded.has(x),
    );
    for (const c of await contractIds(ctx, moreCandidates, sourceBlock)) contracts.add(c);
    data.tokens.push(...moreTokens);
    data.trades.push(...more);
    attributed.push(...attribute(more, contracts));
    data.transfers.push(...moreTransfers);
    data.swaps.push(...(await inChunks(missing, (part) => db.select().from(s.dexSwaps).where(and(inArray(s.dexSwaps.token, part), lte(s.dexSwaps.block, sourceBlock))))));
  }
  const results = await computeAndStoreMetrics(ctx, data, data.tokens.map((t) => t.id), attributed, excluded, contracts, sourceBlock, cfg);
  ctx.log?.(`[store] incremental: ${tokenIds.length} tokens touched, ${links.length} links, ${changed.size} membership changes, ${results.length} tokens recomputed`);
  return { sourceBlock, entities: new Set(merged.values()).size, tokens: results, reattributed: 0 };
}

/** Canonical evidence JSON for a token (served by the API so anyone can recompute evidenceRoot). */
export async function evidenceJsonFor(ctx: Pick<StoreCtx, "db" | "book" | "cfg">, tokenId: number): Promise<string | null> {
  const cfg = ctx.cfg ?? DEFAULT_CLUSTER_CONFIG;
  const tokenHex = (await ctx.book.hex(tokenId))!.toLowerCase();
  const [tok] = await ctx.db.select().from(s.tokens).where(eq(s.tokens.id, tokenId));
  if (!tok) return null; // not a tracked token: no evidence (never a root that looks valid)
  const parts = new Set<number>([tok.creator]);
  const trades = await ctx.db.select().from(s.curveTrades).where(eq(s.curveTrades.token, tokenId));
  const transfers = await ctx.db.select().from(s.transfers).where(eq(s.transfers.token, tokenId));
  const contracts = await ctx.db.select({ id: s.wallets.id }).from(s.wallets).where(eq(s.wallets.isContract, 1));
  const c = new Set(contracts.map((x) => x.id));
  for (const t of attribute(trades, c)) if (!c.has(t.trader)) parts.add(t.trader);
  for (const t of transfers) for (const a of [t.from, t.to]) if (!c.has(a)) parts.add(a);
  const mem = await inChunks([...parts], (part) => ctx.db.select().from(s.entityMembers).where(inArray(s.entityMembers.wallet, part)));
  const clusters = await clustersFor(ctx, [...new Set(mem.map((m) => m.entity))], cfg);
  return evidenceRoot(tokenHex, clusters).canonical;
}

export { clustersFor };
