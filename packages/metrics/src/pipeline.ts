import { inArray, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { clusterWallets, clustersForToken, type ClusterResult, type FundingEdge } from "@nuno/cluster";
import { NADFUN_MAINNET, schema, toHex, type Db, type RpcClient } from "@nuno/shared";
import { ZERO, computeMetrics, evidenceRoot, type TokenMetrics, type VolumeTrade } from "./metrics.js";

/** nad.fun protocol contracts that hold supply but are never holders (from nad.fun/skill.md). */
const PROTOCOL_ADDRESSES = [
  NADFUN_MAINNET.CURVE,
  NADFUN_MAINNET.BONDING_CURVE_ROUTER,
  NADFUN_MAINNET.DEX_ROUTER,
  NADFUN_MAINNET.CREATOR_TREASURY,
  NADFUN_MAINNET.WMON,
  NADFUN_MAINNET.LENS,
].map((a) => a.toLowerCase());

export interface PipelineCtx {
  db: Db;
  /** Archive RPC used for eth_getCode on addresses not yet classified. */
  rpc: RpcClient;
  /** Addresses never used as linking funders (Nansen-labelled or manual list). */
  infrastructure: Set<string>;
  log?: (msg: string) => void;
}

/** Mark unknown addresses as contract/EOA via eth_getCode, caching in `wallets`. */
async function contractSet(ctx: PipelineCtx, addrs: string[], atBlock: number): Promise<Set<string>> {
  const map = new Map<string, boolean | null>();
  for (let i = 0; i < addrs.length; i += 1000) {
    const rows = await ctx.db
      .select({ a: schema.wallets.address, c: schema.wallets.isContract })
      .from(schema.wallets)
      .where(inArray(schema.wallets.address, addrs.slice(i, i + 1000)));
    for (const r of rows) map.set(r.a, r.c);
  }
  const unknown = addrs.filter((a) => map.get(a) == null);
  ctx.log?.(`[pipeline] eth_getCode for ${unknown.length} unclassified addresses`);
  await Promise.all(
    unknown.map(async (a) => {
      const code = await ctx.rpc.call<Hex>("eth_getCode", [a as Address, toHex(atBlock)], { cache: true });
      const isContract = code !== "0x" && code.length > 2;
      map.set(a, isContract);
      await ctx.db
        .insert(schema.wallets)
        .values({ address: a, isContract })
        .onConflictDoUpdate({ target: schema.wallets.address, set: { isContract } });
    }),
  );
  return new Set([...map].filter(([, c]) => c).map(([a]) => a));
}

/** Stored funding edges reachable from `wallets` within `hops` hops. */
async function fundingAncestry(db: Db, wallets: string[], hops: number): Promise<FundingEdge[]> {
  const out: FundingEdge[] = [];
  const seen = new Set<string>();
  let frontier = wallets;
  for (let hop = 0; hop < hops && frontier.length; hop++) {
    const next: string[] = [];
    for (let i = 0; i < frontier.length; i += 1000) {
      const rows = await db.select().from(schema.fundingEdges).where(inArray(schema.fundingEdges.wallet, frontier.slice(i, i + 1000)));
      for (const r of rows) {
        const key = `${r.wallet}|${r.txHash}|${r.funder}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ wallet: r.wallet, funder: r.funder, origin: r.origin, block: r.block, blockTime: r.blockTime, txHash: r.txHash });
        next.push(r.origin);
      }
    }
    frontier = [...new Set(next)];
  }
  return out;
}

export interface TokenRun {
  token: string;
  symbol: string;
  clusterCount: number;
  metrics: TokenMetrics;
  evidenceJson: string;
}

export interface GlobalRun {
  sourceBlock: number;
  result: ClusterResult;
  tokens: TokenRun[];
}

/**
 * One global entity resolution over every tracked token, then per-token metrics that use the
 * global wallet -> entity map. A token's clusters are the global entities active in that token.
 */
export async function runAll(ctx: PipelineCtx, sourceBlock: number): Promise<GlobalRun> {
  const { db } = ctx;
  const tokens = await db.select().from(schema.tokens).where(sql`${schema.tokens.createBlock} <= ${sourceBlock}`);
  const transfers = await db.select().from(schema.transfers).where(sql`${schema.transfers.block} <= ${sourceBlock}`);
  const trades = await db.select().from(schema.curveTrades).where(sql`${schema.curveTrades.block} <= ${sourceBlock}`);

  const excluded = new Set<string>([ZERO, ...PROTOCOL_ADDRESSES]);
  for (const t of tokens) {
    excluded.add(t.curvePool);
    if (t.graduatedPool) excluded.add(t.graduatedPool);
  }

  const participantsByToken = new Map<string, Set<string>>(tokens.map((t) => [t.address, new Set([t.creator])]));
  for (const t of transfers) for (const a of [t.from, t.to]) if (!excluded.has(a)) participantsByToken.get(t.token)?.add(a);
  for (const t of trades) if (!excluded.has(t.trader)) participantsByToken.get(t.token)?.add(t.trader);
  const participants = [...new Set([...participantsByToken.values()].flatMap((s) => [...s]))];

  const contracts = await contractSet(ctx, participants, sourceBlock);
  for (const a of excluded) contracts.add(a);
  const funding = await fundingAncestry(db, participants, 3);
  ctx.log?.(`[pipeline] ${tokens.length} tokens, ${participants.length} wallets, ${funding.length} funding edges`);

  const result = clusterWallets({
    launches: tokens.map((t) => ({ token: t.address, creator: t.creator, createBlock: t.createBlock })),
    wallets: participants,
    contracts,
    infrastructure: ctx.infrastructure,
    funding,
    trades: trades.map((t) => ({ token: t.token, wallet: t.trader, side: t.side, block: t.block, txHash: t.txHash })),
    transfers: transfers.map((t) => ({ token: t.token, from: t.from, to: t.to, block: t.block, txHash: t.txHash })),
  });

  const transfersByToken = groupBy(transfers, (t) => t.token);
  const tradesByToken = groupBy(trades, (t) => t.token);
  const runs: TokenRun[] = tokens.map((token) => {
    const tokClusters = clustersForToken(result, participantsByToken.get(token.address) ?? []);
    const volumeTrades: VolumeTrade[] = (tradesByToken.get(token.address) ?? []).map((t) =>
      t.side === "buy"
        ? { wallet: t.trader, side: "buy", block: t.block, mon: BigInt(t.amountIn), tokens: BigInt(t.amountOut) }
        : { wallet: t.trader, side: "sell", block: t.block, mon: BigInt(t.amountOut), tokens: BigInt(t.amountIn) },
    );
    const metrics = computeMetrics({
      token: token.address,
      creator: token.creator,
      sourceBlock,
      transfers: (transfersByToken.get(token.address) ?? []).map((t) => ({ from: t.from, to: t.to, value: BigInt(t.value) })),
      excludedHolders: contracts,
      entityOf: result.entityOf,
      clusters: tokClusters,
      trades: volumeTrades,
    });
    const { canonical } = evidenceRoot(token.address, sourceBlock, tokClusters);
    return { token: token.address, symbol: token.symbol, clusterCount: tokClusters.length, metrics, evidenceJson: canonical };
  });

  return { sourceBlock, result, tokens: runs };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Replace all stored entities and upsert every token's metrics, in one transaction. */
export async function storeRun(db: Db, run: GlobalRun): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.entityLinks);
    await tx.delete(schema.entityMembers);
    await tx.delete(schema.entities);
    for (const c of run.result.clusters) {
      await tx.insert(schema.entities).values({
        id: c.id,
        members: c.members,
        size: c.members.length,
        createdTokens: c.createdTokens,
        sourceBlock: run.sourceBlock,
      });
      await tx.insert(schema.entityMembers).values(c.members.map((w) => ({ wallet: w, entityId: c.id })));
      for (let i = 0; i < c.links.length; i += 500) {
        await tx.insert(schema.entityLinks).values(
          c.links.slice(i, i + 500).map((l) => ({ entityId: c.id, a: l.a, b: l.b, type: l.type, weight: l.weight, evidence: l.evidence })),
        );
      }
    }
    for (const t of run.tokens) {
      const m = t.metrics;
      const row = {
        sourceBlock: m.sourceBlock,
        totalSupply: m.totalSupply.toString(),
        rawHolders: m.rawHolders,
        realHolders: m.realHolders,
        effectiveTop10Bps: m.effectiveTop10Bps,
        clusterSupplyBps: m.clusterSupplyBps,
        creatorLinkedSupplyBps: m.creatorLinkedSupplyBps,
        rawVolume: m.rawVolume.toString(),
        organicVolume: m.organicVolume.toString(),
        organicVolumeBps: m.organicVolumeBps,
        evidenceRoot: m.evidenceRoot,
        evidenceJson: t.evidenceJson,
        computedAt: new Date(),
      };
      await tx.insert(schema.tokenMetrics).values({ token: t.token, ...row }).onConflictDoUpdate({ target: schema.tokenMetrics.token, set: row });
    }
  });
}
