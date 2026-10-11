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
  /** Optional extra endpoints for state at recent blocks (see RecentState). */
  recent?: RecentState;
  log?: (msg: string) => void;
}

/**
 * Endpoints that keep state only for recent blocks (e.g. rpc.monad.xyz, thirdweb). State reads
 * (balance, nonce, code) at blocks >= `fromBlock` go here, so they spread over more rate-limit
 * buckets; older blocks, block bodies and traces stay on the archive RPC.
 */
export interface RecentState {
  rpc: RpcClient;
  fromBlock: number;
}

const stateRpc = (rpc: RpcClient, recent: RecentState | undefined, block: number) => (recent && block >= recent.fromBlock ? recent.rpc : rpc);

export type WalletFunding =
  | { status: "resolved"; block: number; blockTime: number; transfers: InboundTransfer[]; isContract: boolean }
  | { status: "unfunded"; isContract: boolean }
  | { status: "contract"; isContract: true };

async function isContract(rpc: RpcClient, addr: Address, block: number, recent?: RecentState): Promise<boolean> {
  return isContractCode(await stateRpc(rpc, recent, block).call<Hex>("eth_getCode", [addr, toHex(block)], { cache: true }));
}

async function balanceAt(rpc: RpcClient, addr: Address, block: number, recent?: RecentState): Promise<bigint> {
  return BigInt(await stateRpc(rpc, recent, block).call<Hex>("eth_getBalance", [addr, toHex(block)], { cache: true }));
}

/** Value transfers into `wallet` in `block`: top-level txs first, callTracer frames otherwise. */
async function inboundAt(rpc: RpcClient, wallet: Address, block: number): Promise<{ blockTime: number; transfers: InboundTransfer[] }> {
  // Block bodies and traces can be MBs: never cached (long-running processes would grow unbounded).
  const body = await rpc.call<RpcBlock>("eth_getBlockByNumber", [toHex(block), true]);
  let transfers = directTransfersFromBlock(body, wallet);
  if (transfers.length === 0) {
    const traces = await rpc.call<BlockTraceEntry[]>("debug_traceBlockByNumber", [toHex(block), { tracer: "callTracer" }]);
    transfers = extractInboundTransfers(traces, wallet);
  }
  return { blockTime: Number(body.timestamp), transfers };
}

async function touched(rpc: RpcClient, addr: Address, block: number, recent?: RecentState): Promise<boolean> {
  // Balance first; the nonce only matters when the balance is zero. Public archive RPCs are
  // rate-limited per IP, so skipping the second call on funded probes is a direct speed-up.
  const r = stateRpc(rpc, recent, block);
  if (BigInt(await r.call<Hex>("eth_getBalance", [addr, toHex(block)], { cache: true })) > 0n) return true;
  return BigInt(await r.call<Hex>("eth_getTransactionCount", [addr, toHex(block)], { cache: true })) > 0n;
}

/**
 * Find the first native-MON funding of `wallet` at or before `beforeBlock`, with evidence.
 * Source: archive state (binary search) + callTracer on the funding block.
 */
export async function resolveFirstFunding(rpc: RpcClient, wallet: Address, beforeBlock: number, recent?: RecentState): Promise<WalletFunding> {
  if (await isContract(rpc, wallet, beforeBlock, recent)) return { status: "contract", isContract: true };

  const block = await firstTrueBlock(0, beforeBlock, (b) => touched(rpc, wallet, b, recent));
  if (block === null) return { status: "unfunded", isContract: false };

  const { blockTime, transfers } = await inboundAt(rpc, wallet, block);
  return { status: "resolved", block, blockTime, transfers, isContract: false };
}

/** SPEC §7.11 rule 7: at most this many inbound funding edges are stored per wallet. */
export const MAX_EDGES_PER_WALLET = 5;

/** A later deposit is searched for only when the balance rose by at least this much (1 MON). */
export const MIN_DEPOSIT_WEI = 10n ** 18n;

export interface Deposit {
  block: number;
  blockTime: number;
  transfers: InboundTransfer[];
}

/**
 * Later deposits into `wallet` between its first funding (`firstBlock`) and `beforeBlock` (exclusive),
 * so a large top-up after a small first funding is captured (e.g. 10 MON first, 300,000 MON later).
 *
 * No public RPC serves trace_filter and native transfers emit no logs, so deposits are located from
 * archive balances: with balance(lo) < t <= balance(hi), a binary search finds a block where the
 * balance crossed t upwards, and a balance only rises through an inbound value transfer. Taking t as
 * the midpoint halves the remaining gap each step, so the search ends after a few deposits. It finds
 * deposits that raised the net balance; deposits spent before `beforeBlock` can be missed (METHODOLOGY).
 */
export async function resolveLaterDeposits(
  rpc: RpcClient,
  wallet: Address,
  firstBlock: number,
  beforeBlock: number,
  max: number,
  recent?: RecentState,
): Promise<Deposit[]> {
  const out: Deposit[] = [];
  const hi = beforeBlock - 1;
  if (max <= 0 || hi <= firstBlock) return out;
  const top = await balanceAt(rpc, wallet, hi, recent);
  let lo = firstBlock;
  for (let step = 0; step < max * 3 && out.length < max; step++) {
    const low = await balanceAt(rpc, wallet, lo, recent);
    if (top - low < MIN_DEPOSIT_WEI) break;
    const t = low + (top - low) / 2n;
    let a = lo;
    let c = hi;
    while (c - a > 1) {
      const m = Math.floor((a + c) / 2);
      if ((await balanceAt(rpc, wallet, m, recent)) >= t) c = m;
      else a = m;
    }
    const { blockTime, transfers } = await inboundAt(rpc, wallet, c);
    if (transfers.length) out.push({ block: c, blockTime, transfers });
    lo = c;
  }
  return out;
}

/** Marks a wallet whose later deposits were searched (cursors row; no schema change). */
const depositsMarker = (walletId: number) => `funding:deposits:${walletId}`;

/** Persist one wallet's funding result; returns the origin EOAs (hex) to resolve at the next hop. */
async function store(ctx: FundingCtx, wallet: Address, f: WalletFunding, deposits: Deposit[] = []): Promise<Hop[]> {
  const { db, book } = ctx;
  const walletId = await book.id(wallet);
  const now = Date.now();
  if (f.status !== "resolved") {
    const row = { isContract: f.isContract ? 1 : 0, fundingStatus: s.FUNDING_STATUS.unfunded, resolvedAt: now };
    await db.insert(s.wallets).values({ id: walletId, ...row }).onConflictDoUpdate({ target: s.wallets.id, set: row });
    return [];
  }
  const hops = await storeEdges(ctx, walletId, wallet, [{ block: f.block, blockTime: f.blockTime, transfers: f.transfers }, ...deposits]);
  // A touched block with no value frame to the wallet (e.g. gas-sponsored/7702 first tx) is
  // recorded as resolved with no edges; METHODOLOGY lists it as a limitation.
  const row = { isContract: 0, fundingStatus: s.FUNDING_STATUS.resolved, firstFundedBlock: f.block, resolvedAt: now };
  await db.insert(s.wallets).values({ id: walletId, ...row }).onConflictDoUpdate({ target: s.wallets.id, set: row });
  return hops;
}

/** Insert up to `cap` edges (first funding first); returns their origins as next hops. */
async function storeEdges(ctx: FundingCtx, walletId: number, wallet: Address, groups: Deposit[], cap = MAX_EDGES_PER_WALLET): Promise<Hop[]> {
  const edges = groups.flatMap((g) => g.transfers.map((t) => ({ ...t, block: g.block, blockTime: g.blockTime }))).slice(0, Math.max(0, cap));
  if (!edges.length) return [];
  const ids = await ctx.book.ids(edges.flatMap((t) => [t.funder, t.origin]));
  await insertIgnore(
    ctx.db,
    s.fundingEdges,
    edges.map((t) => ({
      wallet: walletId,
      funder: ids.get(t.funder)!,
      origin: ids.get(t.origin)!,
      kind: s.FUNDING_KIND[t.kind],
      value: t.value.toString(),
      block: t.block,
      blockTime: t.blockTime,
      tx: txBytes(t.txHash),
      source: s.FUNDING_SOURCE.rpc_archive_trace,
    })),
  );
  const self = wallet.toLowerCase();
  return edges.filter((t) => t.origin !== self).map((t) => ({ addr: t.origin, before: t.block }));
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
      // Wallets resolved before later deposits were searched get that search once.
      const [marked] = await ctx.db.select().from(s.cursors).where(eq(s.cursors.name, depositsMarker(walletId)));
      if (!marked) await addLaterDeposits(ctx, walletId, addr, c.firstFundedBlock, before, hop);
      const edges = await ctx.db
        .select({ origin: s.fundingEdges.origin, block: s.fundingEdges.block })
        .from(s.fundingEdges)
        .where(eq(s.fundingEdges.wallet, walletId));
      const hex = await ctx.book.hexes(edges.map((e) => e.origin));
      return edges.filter((e) => e.origin !== walletId).map((e) => ({ addr: hex.get(e.origin)! as Address, before: e.block }));
    }
    try {
      const f = await resolveFirstFunding(ctx.rpc, addr, before, ctx.recent);
      const deposits =
        f.status === "resolved" ? await resolveLaterDeposits(ctx.rpc, addr, f.block, before, MAX_EDGES_PER_WALLET - Math.min(f.transfers.length, MAX_EDGES_PER_WALLET), ctx.recent) : [];
      const hops = await store(ctx, addr, f, deposits);
      if (f.status === "resolved") await markDeposits(ctx, walletId, before);
      ctx.log?.(`[funding] hop ${hop} ${addr}: ${f.status}${f.status === "resolved" ? ` @${f.block}${deposits.length ? ` +${deposits.length} later` : ""} <- ${[...new Set(hops.map((h) => h.addr))].join(",") || "(none)"}` : ""}`);
      return hops;
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

async function markDeposits(ctx: FundingCtx, walletId: number, before: number) {
  const row = { name: depositsMarker(walletId), block: before, updatedAt: Date.now() };
  await ctx.db.insert(s.cursors).values(row).onConflictDoUpdate({ target: s.cursors.name, set: { block: row.block, updatedAt: row.updatedAt } });
}

async function addLaterDeposits(ctx: FundingCtx, walletId: number, addr: Address, firstBlock: number, before: number, hop: number) {
  const [row] = await ctx.db.select({ n: sql<number>`count(*)` }).from(s.fundingEdges).where(eq(s.fundingEdges.wallet, walletId));
  const room = MAX_EDGES_PER_WALLET - Number(row?.n ?? 0);
  const deposits = await resolveLaterDeposits(ctx.rpc, addr, firstBlock, before, room, ctx.recent);
  await storeEdges(ctx, walletId, addr, deposits, room);
  await markDeposits(ctx, walletId, before);
  if (deposits.length) ctx.log?.(`[funding] hop ${hop} ${addr}: +${deposits.length} later deposit(s) @${deposits.map((d) => d.block).join(",")}`);
}

/**
 * Resolve funding for `wallet` (first funding + later deposits, ≤5 edges), then its funders', up to `maxHops`.
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
export async function pendingBuyers(
  ctx: Pick<FundingCtx, "db" | "book">,
  limit: number,
  opts: { all?: boolean } = {},
): Promise<Array<{ trader: Address; firstBuy: number }>> {
  // `all`: every buyer, resolved ones too (their cached path runs the one-time later-deposit search).
  const pending = opts.all
    ? sql`1 = 1`
    : sql`(w.funding_status is null or w.funding_status in (${s.FUNDING_STATUS.pending}, ${s.FUNDING_STATUS.error}))
        and coalesce(w.funding_attempts, 0) < ${MAX_FUNDING_ATTEMPTS}`;
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
      where ${pending}
      group by b.buyer
      order by coalesce(max(w.funding_attempts), 0), min(b.block)
      limit ${limit}`,
    ["buyer", "first_buy"],
  );
  const hex = await ctx.book.hexes(rs.map((r) => Number(r.buyer)));
  return rs.map((r) => ({ trader: hex.get(Number(r.buyer))! as Address, firstBuy: Number(r.first_buy) }));
}
