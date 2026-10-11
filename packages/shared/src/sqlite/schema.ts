import { customType, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One SQLite schema for the backfill and the scheduled pipeline (SPEC §7.10–7.11).
 * Storage rules: addresses are integer ids into `addresses` (20-byte blobs); tx hashes are 32-byte
 * blobs; token/wei amounts are decimal TEXT (they overflow SQLite integers); only decoded fields.
 */

/** Raw bytes. Drivers return blobs as number[], ArrayBuffer or Uint8Array; normalise. */
export const bytes = customType<{ data: Uint8Array; driverData: Uint8Array | ArrayBuffer | number[] }>({
  dataType: () => "blob",
  toDriver: (v) => v,
  fromDriver: (v) => (v instanceof Uint8Array ? v : Array.isArray(v) ? Uint8Array.from(v) : new Uint8Array(v)),
});

const addr = (name: string) => integer(name);
const blockCol = (name: string) => integer(name);

export const SIDE = { buy: 0, sell: 1 } as const;
export const FUNDING_STATUS = { pending: 0, resolved: 1, unfunded: 2, error: 3 } as const;
export const FUNDING_KIND = { native_direct: 0, native_internal: 1 } as const;
export const FUNDING_SOURCE = { rpc_archive_trace: 0, nansen: 1 } as const;
export const EDGE_TYPE = {
  same_direct_funder: 0,
  common_funding_source: 1,
  creator_funded: 2,
  token_transfer: 3,
  same_block_early_buy: 4,
  same_block_sell: 5,
} as const;

/** Address dictionary: every other table stores these ids. */
export const addresses = sqliteTable("addresses", {
  id: integer("id").primaryKey(),
  addr: bytes("addr").notNull().unique(),
});

/** Resumable job cursors: last fully processed block per job. */
export const cursors = sqliteTable("cursors", {
  name: text("name").primaryKey(),
  block: blockCol("block").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const tokens = sqliteTable(
  "tokens",
  {
    id: addr("id").primaryKey(),
    creator: addr("creator").notNull(),
    curvePool: addr("curve_pool").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    createBlock: blockCol("create_block").notNull(),
    createTx: bytes("create_tx").notNull(),
    graduatedPool: addr("graduated_pool"),
    graduatedBlock: blockCol("graduated_block"),
    /** 1 once pruned to a summary (rule 5/6): event rows deleted, metrics kept. */
    pruned: integer("pruned").notNull().default(0),
  },
  (t) => [index("tokens_creator_idx").on(t.creator)],
);

/** CurveGraduate events, kept apart from `tokens` because parallel backfill chunks arrive out of order. */
export const graduations = sqliteTable("graduations", {
  token: addr("token").primaryKey(),
  pool: addr("pool").notNull(),
  block: blockCol("block").notNull(),
  tx: bytes("tx").notNull(),
});

export const curveTrades = sqliteTable(
  "curve_trades",
  {
    tx: bytes("tx").notNull(),
    logIndex: integer("log_index").notNull(),
    block: blockCol("block").notNull(),
    token: addr("token").notNull(),
    /** Curve event `sender`: the wallet, or a bot contract acting for it. */
    trader: addr("trader").notNull(),
    /** Transaction signer; the trader when `trader` is a contract. */
    txFrom: addr("tx_from"),
    side: integer("side").notNull(),
    amountIn: text("amount_in").notNull(),
    amountOut: text("amount_out").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tx, t.logIndex] }),
    index("curve_trades_token_idx").on(t.token, t.block),
    index("curve_trades_trader_idx").on(t.trader),
    index("curve_trades_tx_from_idx").on(t.txFrom),
  ],
);

export const transfers = sqliteTable(
  "transfers",
  {
    tx: bytes("tx").notNull(),
    logIndex: integer("log_index").notNull(),
    block: blockCol("block").notNull(),
    token: addr("token").notNull(),
    from: addr("from").notNull(),
    to: addr("to").notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tx, t.logIndex] }),
    index("transfers_token_idx").on(t.token, t.block),
    index("transfers_from_idx").on(t.from),
    index("transfers_to_idx").on(t.to),
  ],
);

export const dexSwaps = sqliteTable(
  "dex_swaps",
  {
    tx: bytes("tx").notNull(),
    logIndex: integer("log_index").notNull(),
    block: blockCol("block").notNull(),
    pool: addr("pool").notNull(),
    token: addr("token").notNull(),
    /** Swap `sender` is the router; the trader is the transaction signer. */
    sender: addr("sender").notNull(),
    recipient: addr("recipient").notNull(),
    txFrom: addr("tx_from"),
    amount0: text("amount0").notNull(),
    amount1: text("amount1").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tx, t.logIndex] }), index("dex_swaps_token_idx").on(t.token, t.block)],
);

/** Per-address facts and the funding cache (rule 7: resolved flag, not full histories). */
export const wallets = sqliteTable("wallets", {
  id: addr("id").primaryKey(),
  isContract: integer("is_contract"),
  fundingStatus: integer("funding_status").notNull().default(0),
  firstFundedBlock: blockCol("first_funded_block"),
  fundingAttempts: integer("funding_attempts").notNull().default(0),
  resolvedAt: integer("resolved_at"),
});

/** Inbound native-MON funding of a wallet (first funding, ≤3 hops), with tx evidence. */
export const fundingEdges = sqliteTable(
  "funding_edges",
  {
    wallet: addr("wallet").notNull(),
    funder: addr("funder").notNull(),
    origin: addr("origin").notNull(),
    kind: integer("kind").notNull(),
    value: text("value").notNull(),
    block: blockCol("block").notNull(),
    blockTime: integer("block_time").notNull(),
    tx: bytes("tx").notNull(),
    source: integer("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.tx, t.funder] }), index("funding_edges_origin_idx").on(t.origin)],
);

/**
 * One row per piece of link evidence between wallets a < b (by address id). Pair weights are
 * derived from these rows (see cluster/weights), so inserting is idempotent and the local full
 * run and incremental cron updates converge on the same result.
 * `token` / `detail` are 0 when not applicable (part of the primary key).
 */
export const linkEvidence = sqliteTable(
  "link_evidence",
  {
    a: addr("a").notNull(),
    b: addr("b").notNull(),
    type: integer("type").notNull(),
    tx: bytes("tx").notNull(),
    block: blockCol("block").notNull(),
    token: addr("token").notNull().default(0),
    detail: addr("detail").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.a, t.b, t.type, t.tx, t.detail] }), index("link_evidence_b_idx").on(t.b)],
);

/** Persisted union-find, flattened: wallet -> entity (entity id = address id of its smallest member). */
export const entityMembers = sqliteTable(
  "entity_members",
  {
    wallet: addr("wallet").primaryKey(),
    entity: addr("entity").notNull(),
  },
  (t) => [index("entity_members_entity_idx").on(t.entity)],
);

/** Latest computed metrics per token. */
export const tokenMetrics = sqliteTable("token_metrics", {
  token: addr("token").primaryKey(),
  sourceBlock: blockCol("source_block").notNull(),
  totalSupply: text("total_supply").notNull(),
  rawHolders: integer("raw_holders").notNull(),
  realHolders: integer("real_holders").notNull(),
  effectiveTop10Bps: integer("effective_top10_bps").notNull(),
  clusterSupplyBps: integer("cluster_supply_bps").notNull(),
  creatorLinkedSupplyBps: integer("creator_linked_supply_bps").notNull(),
  rawVolume: text("raw_volume").notNull(),
  organicVolume: text("organic_volume").notNull(),
  organicVolumeBps: integer("organic_volume_bps").notNull(),
  evidenceRoot: bytes("evidence_root").notNull(),
  computedAt: integer("computed_at").notNull(),
});

/** NunoFeed publish txs (rule 9: latest per token + one per day are kept). */
export const snapshots = sqliteTable(
  "snapshots",
  {
    tx: bytes("tx").primaryKey(),
    chainId: integer("chain_id").notNull(),
    token: addr("token").notNull(),
    sourceBlock: blockCol("source_block").notNull(),
    publishBlock: blockCol("publish_block").notNull(),
    evidenceRoot: bytes("evidence_root").notNull(),
    gasUsed: integer("gas_used").notNull(),
    effectiveGasPrice: text("effective_gas_price").notNull(),
    publishedAt: integer("published_at").notNull(),
  },
  (t) => [index("snapshots_token_idx").on(t.token, t.publishBlock)],
);

/** Nansen labels (rule 8): label + category only, no raw payloads. */
export const labels = sqliteTable("labels", {
  address: addr("address").primaryKey(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

/** Storage budget tracking, one row per pipeline run. */
export const storageStats = sqliteTable("storage_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  bytes: integer("bytes").notNull(),
  /** {"table": rowCount, ...} */
  rowCounts: text("row_counts").notNull(),
  /** Nansen credits spent during this run (from X-Nansen-Credits-Used). */
  nansenCreditsSpent: integer("nansen_credits_spent").notNull().default(0),
});

/**
 * Permanent cache of Nansen responses (free plan: credits are scarce). One row per address and
 * endpoint; a cached address is never queried again. `result` is a compact JSON summary, never
 * the raw payload.
 */
export const nansenCache = sqliteTable(
  "nansen_cache",
  {
    address: integer("address").notNull(),
    endpoint: text("endpoint").notNull(),
    result: text("result").notNull(),
    creditsUsed: integer("credits_used").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.address, t.endpoint] })],
);
