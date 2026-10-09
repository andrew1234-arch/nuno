import { eq, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import {
  AddressBook,
  insertIgnore,
  isContractCode,
  rows,
  sqliteSchema as s,
  toHex,
  txBytes,
  type BlockTraceEntry,
  type RpcBlock,
  type RpcClient,
  type SqlDb,
} from "@nuno/shared";
import { firstTrueBlock } from "./search.js";
import { directTransfersFromBlock, extractInboundTransfers, type InboundTransfer } from "./trace.js";

export interface FundingCtx {
  db: SqlDb;
  book: AddressBook;
  /** Must serve archive state and debug_traceBlockByNumber (e.g. rpc1.monad.xyz). */
  rpc: RpcClient;
  log?: (msg: string) => void;
}

export type WalletFunding =
  | { status: "resolved"; block: number; blockTime: number; transfers: InboundTransfer[]; isContract: boolean }
  | { status: "unfunded"; isContract: boolean }
  | { status: "contract"; isContract: true };

async function isContract(rpc: RpcClient, addr: Address, block: number): Promise<boolean> {
  return isContractCode(await rpc.call<Hex>("eth_getCode", [addr, toHex(block)], { cache: true }));
}

async function touched(rpc: RpcClient, addr: Address, block: number): Promise<boolean> {
  const [bal, nonce] = await Promise.all([
    rpc.call<Hex>("eth_getBalance", [addr, toHex(block)], { cache: true }),
    rpc.call<Hex>("eth_getTransactionCount", [addr, toHex(block)], { cache: true }),
  ]);
  return BigInt(bal) > 0n || BigInt(nonce) > 0n;
}

/**
 * Find the first native-MON funding of `wallet` at or before `beforeBlock`, with evidence.
 * Source: archive state (binary search) + callTracer on the funding block.
 */
export async function resolveFirstFunding(rpc: RpcClient, wallet: Address, beforeBlock: number): Promise<WalletFunding> {
  if (await isContract(rpc, wallet, beforeBlock)) return { status: "contract", isContract: true };

  const block = await firstTrueBlock(0, beforeBlock, (b) => touched(rpc, wallet, b));
  if (block === null) return { status: "unfunded", isContract: false };

  // Block bodies and traces can be MBs: never cached (long-running processes would grow unbounded).
  const body = await rpc.call<RpcBlock>("eth_getBlockByNumber", [toHex(block), true]);
  let transfers = directTransfersFromBlock(body, wallet);
  if (transfers.length === 0) {
    const traces = await rpc.call<BlockTraceEntry[]>(
      "debug_traceBlockByNumber",
      [toHex(block), { tracer: "callTracer" }],
    );
    transfers = extractInboundTransfers(traces, wallet);
  }
  return { status: "resolved", block, blockTime: Number(body.timestamp), transfers, isContract: false };
}

/** SPEC §7.11 rule 7: at most this many inbound funding edges are stored per wallet. */
export const MAX_EDGES_PER_WALLET = 5;

/** Persist one wallet's funding result; returns the origin EOAs (hex) to resolve at the next hop. */
async function store(ctx: FundingCtx, wallet: Address, f: WalletFunding): Promise<Address[]> {
  const { db, book } = ctx;
  const walletId = await book.id(wallet);
  const now = Date.now();
  if (f.status !== "resolved") {
    const row = { isContract: f.isContract ? 1 : 0, fundingStatus: s.FUNDING_STATUS.unfunded, resolvedAt: now };
    await db.insert(s.wallets).values({ id: walletId, ...row }).onConflictDoUpdate({ target: s.wallets.id, set: row });
    return [];
  }
  const transfers = f.transfers.slice(0, MAX_EDGES_PER_WALLET);
  const ids = await book.ids(transfers.flatMap((t) => [t.funder, t.origin]));
  await insertIgnore(
    db,
    s.fundingEdges,
    transfers.map((t) => ({
      wallet: walletId,
      funder: ids.get(t.funder)!,
      origin: ids.get(t.origin)!,
      kind: s.FUNDING_KIND[t.kind],
      value: t.value.toString(),
      block: f.block,
      blockTime: f.blockTime,
      tx: txBytes(t.txHash),
      source: s.FUNDING_SOURCE.rpc_archive_trace,
    })),
  );
  // A touched block with no value frame to the wallet (e.g. gas-sponsored/7702 first tx) is
  // recorded as resolved with no edges; METHODOLOGY lists it as a limitation.
  const row = { isContract: 0, fundingStatus: s.FUNDING_STATUS.resolved, firstFundedBlock: f.block, resolvedAt: now };
  await db.insert(s.wallets).values({ id: walletId, ...row }).onConflictDoUpdate({ target: s.wallets.id, set: row });
  return [...new Set(transfers.map((t) => t.origin))].filter((o) => o !== wallet.toLowerCase());
}

type Hop = { addr: Address; before: number };

// Concurrent workers often reach the same funder; share one lookup per address.
const inflight = new Map<string, Promise<Hop[]>>();

/** Resolve one address (DB cache first) and return its funders as the next hop. */
function resolveOne(ctx: FundingCtx, addr: Address, before: number, hop: number): Promise<Hop[]> {
  const key = addr.toLowerCase();
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async (): Promise<Hop[]> => {
    const walletId = await ctx.book.id(addr);
    const [c] = await ctx.db.select().from(s.wallets).where(eq(s.wallets.id, walletId));
    if (c && c.fundingStatus !== s.FUNDING_STATUS.pending && c.fundingStatus !== s.FUNDING_STATUS.error) {
      if (c.fundingStatus !== s.FUNDING_STATUS.resolved || c.firstFundedBlock === null) return [];
      const edges = await ctx.db.select({ origin: s.fundingEdges.origin }).from(s.fundingEdges).where(eq(s.fundingEdges.wallet, walletId));
      const hex = await ctx.book.hexes(edges.map((e) => e.origin));
      const block = c.firstFundedBlock;
      return edges.filter((e) => e.origin !== walletId).map((e) => ({ addr: hex.get(e.origin)! as Address, before: block }));
    }
    try {
      const f = await resolveFirstFunding(ctx.rpc, addr, before);
      const origins = await store(ctx, addr, f);
      ctx.log?.(`[funding] hop ${hop} ${addr}: ${f.status}${f.status === "resolved" ? ` @${f.block} <- ${origins.join(",") || "(none)"}` : ""}`);
      return f.status === "resolved" ? origins.map((o) => ({ addr: o, before: f.block })) : [];
    } catch (err) {
      // No error text in the DB (SPEC §7.11 rule 11): count the attempt, log to stdout.
      await ctx.db
        .insert(s.wallets)
        .values({ id: walletId, fundingStatus: s.FUNDING_STATUS.error, fundingAttempts: 1 })
        .onConflictDoUpdate({
          target: s.wallets.id,
          set: { fundingStatus: s.FUNDING_STATUS.error, fundingAttempts: sql`${s.wallets.fundingAttempts} + 1` },
        });
      ctx.log?.(`[funding] hop ${hop} ${addr}: ERROR ${(err as Error).message.slice(0, 300)}`);
      return [];
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Resolve first funding for `wallet`, then its funders' first funding, up to `maxHops`.
 * Cached: wallets already resolved/unfunded in the DB are not re-queried.
 */
export async function resolveFundingTree(ctx: FundingCtx, wallet: Address, beforeBlock: number, maxHops = 3) {
  let frontier: Hop[] = [{ addr: wallet, before: beforeBlock }];
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: Hop[] = [];
    for (const { addr, before } of frontier) next.push(...(await resolveOne(ctx, addr, before, hop)));
    frontier = next;
  }
}

/** After this many failed attempts a wallet is left as "error" and shown as unresolved. */
export const MAX_FUNDING_ATTEMPTS = 3;

/**
 * Buyers of tracked tokens with their first buy block, not yet resolved. A buy whose curve
 * `sender` is a known contract (a bot router) is attributed to the transaction signer.
 * Never-tried wallets come first, so repeat failures cannot starve new buyers.
 */
export async function pendingBuyers(ctx: Pick<FundingCtx, "db" | "book">, limit: number): Promise<Array<{ trader: Address; firstBuy: number }>> {
  const rs = await rows<{ buyer: number; first_buy: number }>(
    ctx.db,
    sql`
      with buys as (
        select case when sw.is_contract = 1 and ct.tx_from is not null then ct.tx_from else ct.trader end as buyer, ct.block
        from curve_trades ct left join wallets sw on sw.id = ct.trader
        where ct.side = ${s.SIDE.buy}
        union all
        -- Post-graduation DEX buyers: the swap signer (the Swap sender is a router).
        select ds.tx_from as buyer, ds.block from dex_swaps ds where ds.tx_from is not null
      )
      select b.buyer as buyer, min(b.block) as first_buy
      from buys b left join wallets w on w.id = b.buyer
      where (w.funding_status is null or w.funding_status in (${s.FUNDING_STATUS.pending}, ${s.FUNDING_STATUS.error}))
        and coalesce(w.funding_attempts, 0) < ${MAX_FUNDING_ATTEMPTS}
      group by b.buyer
      order by coalesce(max(w.funding_attempts), 0), min(b.block)
      limit ${limit}`,
    ["buyer", "first_buy"],
  );
  const hex = await ctx.book.hexes(rs.map((r) => Number(r.buyer)));
  return rs.map((r) => ({ trader: hex.get(Number(r.buyer))! as Address, firstBuy: Number(r.first_buy) }));
}
