import { and, eq, inArray, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { clusterToken, type ClusterInput, type ClusterResult, type FundingEdge } from "@nuno/cluster";
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
  /** Archive RPC used for eth_getCode on holders not yet classified. */
  rpc: RpcClient;
  /** Addresses never used as linking funders (Nansen-labelled or manual list). */
  infrastructure: Set<string>;
  log?: (msg: string) => void;
}

/** Mark unknown addresses as contract/EOA via eth_getCode, caching in `wallets`. */
async function contractSet(ctx: PipelineCtx, addrs: string[], atBlock: number): Promise<Set<string>> {
  const known = addrs.length
    ? await ctx.db.select({ a: schema.wallets.address, c: schema.wallets.isContract }).from(schema.wallets).where(inArray(schema.wallets.address, addrs))
    : [];
  const map = new Map(known.map((k) => [k.a, k.c]));
  const unknown = addrs.filter((a) => map.get(a) == null);
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

export interface TokenRun {
  token: string;
  symbol: string;
  clusters: ClusterResult;
  metrics: TokenMetrics;
  evidenceJson: string;
}

export async function runToken(ctx: PipelineCtx, tokenAddr: string, sourceBlock: number): Promise<TokenRun | null> {
  const { db } = ctx;
  const [token] = await db.select().from(schema.tokens).where(eq(schema.tokens.address, tokenAddr));
  if (!token) return null;

  const transfers = await db
    .select()
    .from(schema.transfers)
    .where(and(eq(schema.transfers.token, tokenAddr), sql`${schema.transfers.block} <= ${sourceBlock}`));
  const trades = await db
    .select()
    .from(schema.curveTrades)
    .where(and(eq(schema.curveTrades.token, tokenAddr), sql`${schema.curveTrades.block} <= ${sourceBlock}`));

  const excluded = new Set([...PROTOCOL_ADDRESSES, token.curvePool, ...(token.graduatedPool ? [token.graduatedPool] : []), ZERO]);
  const participants = [...new Set([...transfers.flatMap((t) => [t.from, t.to]), ...trades.map((t) => t.trader), token.creator])].filter(
    (a) => !excluded.has(a),
  );
  const contracts = await contractSet(ctx, participants, sourceBlock);
  for (const a of excluded) contracts.add(a);

  // Funding ancestry: walk stored edges from participants up to 3 hops.
  const funding: FundingEdge[] = [];
  let frontier = participants;
  const seen = new Set<string>();
  for (let hop = 0; hop < 3 && frontier.length; hop++) {
    const rows = await db.select().from(schema.fundingEdges).where(inArray(schema.fundingEdges.wallet, frontier));
    const next: string[] = [];
    for (const r of rows) {
      const key = `${r.wallet}|${r.txHash}|${r.funder}`;
      if (seen.has(key)) continue;
      seen.add(key);
      funding.push({ wallet: r.wallet, funder: r.funder, origin: r.origin, block: r.block, blockTime: r.blockTime, txHash: r.txHash });
      next.push(r.origin);
    }
    frontier = [...new Set(next)];
  }

  const input: ClusterInput = {
    token: tokenAddr,
    creator: token.creator,
    createBlock: token.createBlock,
    wallets: participants,
    contracts,
    infrastructure: ctx.infrastructure,
    funding,
    trades: trades.map((t) => ({ wallet: t.trader, side: t.side, block: t.block, txHash: t.txHash })),
    transfers: transfers.map((t) => ({ from: t.from, to: t.to, block: t.block, txHash: t.txHash })),
  };
  const clusters = clusterToken(input);

  const volumeTrades: VolumeTrade[] = trades.map((t) =>
    t.side === "buy"
      ? { wallet: t.trader, side: "buy", block: t.block, mon: BigInt(t.amountIn), tokens: BigInt(t.amountOut) }
      : { wallet: t.trader, side: "sell", block: t.block, mon: BigInt(t.amountOut), tokens: BigInt(t.amountIn) },
  );
  const metrics = computeMetrics({
    token: tokenAddr,
    creator: token.creator,
    sourceBlock,
    transfers: transfers.map((t) => ({ from: t.from, to: t.to, value: BigInt(t.value) })),
    excludedHolders: contracts,
    entityOf: clusters.entityOf,
    clusters: clusters.clusters,
    trades: volumeTrades,
  });
  const { canonical } = evidenceRoot(tokenAddr, sourceBlock, clusters.clusters);
  return { token: tokenAddr, symbol: token.symbol, clusters, metrics, evidenceJson: canonical };
}

/** Replace a token's stored clusters/links and upsert its metrics, in one transaction. */
export async function storeRun(db: Db, run: TokenRun): Promise<void> {
  const m = run.metrics;
  await db.transaction(async (tx) => {
    await tx.delete(schema.clusterLinks).where(eq(schema.clusterLinks.token, run.token));
    await tx.delete(schema.clusters).where(eq(schema.clusters.token, run.token));
    for (const c of run.clusters.clusters) {
      await tx.insert(schema.clusters).values({ token: run.token, id: c.id, members: c.members, containsCreator: c.containsCreator, sourceBlock: m.sourceBlock });
      if (c.links.length) {
        await tx.insert(schema.clusterLinks).values(
          c.links.map((l) => ({ token: run.token, clusterId: c.id, a: l.a, b: l.b, type: l.type, weight: l.weight, evidence: l.evidence })),
        );
      }
    }
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
      evidenceJson: run.evidenceJson,
      computedAt: new Date(),
    };
    await tx.insert(schema.tokenMetrics).values({ token: run.token, ...row }).onConflictDoUpdate({ target: schema.tokenMetrics.token, set: row });
  });
}

export async function allTokens(db: Db): Promise<string[]> {
  const rows = await db.select({ a: schema.tokens.address }).from(schema.tokens);
  return rows.map((r) => r.a);
}
