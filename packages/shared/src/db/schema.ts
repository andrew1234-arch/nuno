import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Addresses and hashes are stored lowercase 0x-hex. Token amounts are numeric(78,0).
const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });
const block = (name: string) => bigint(name, { mode: "number" });

/** Resumable job cursors: last fully processed block per job. */
export const cursors = pgTable("cursors", {
  name: text("name").primaryKey(),
  block: block("block").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tokens = pgTable("tokens", {
  address: text("address").primaryKey(),
  creator: text("creator").notNull(),
  curvePool: text("curve_pool").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  tokenUri: text("token_uri").notNull(),
  createBlock: block("create_block").notNull(),
  createTx: text("create_tx").notNull(),
  graduatedPool: text("graduated_pool"),
  graduatedBlock: block("graduated_block"),
});

export const curveTrades = pgTable(
  "curve_trades",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    block: block("block").notNull(),
    token: text("token").notNull(),
    /** `sender` from the curve event: the trading wallet, or a contract (bot router) acting for it. */
    trader: text("trader").notNull(),
    /** Transaction signer. Used as the trader when `trader` is a contract. Null until resolved. */
    txFrom: text("tx_from"),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    // buy: amountIn = MON, amountOut = token. sell: amountIn = token, amountOut = MON.
    amountIn: amount("amount_in").notNull(),
    amountOut: amount("amount_out").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex] }),
    index("curve_trades_token_idx").on(t.token, t.block),
    index("curve_trades_trader_idx").on(t.trader),
  ],
);

export const dexSwaps = pgTable(
  "dex_swaps",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    block: block("block").notNull(),
    pool: text("pool").notNull(),
    token: text("token").notNull(),
    sender: text("sender").notNull(),
    recipient: text("recipient").notNull(),
    amount0: amount("amount0").notNull(),
    amount1: amount("amount1").notNull(),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] }), index("dex_swaps_token_idx").on(t.token, t.block)],
);

export const transfers = pgTable(
  "transfers",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    block: block("block").notNull(),
    token: text("token").notNull(),
    from: text("from").notNull(),
    to: text("to").notNull(),
    value: amount("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex] }),
    index("transfers_token_idx").on(t.token, t.block),
    index("transfers_from_idx").on(t.from),
    index("transfers_to_idx").on(t.to),
  ],
);

/** Per-wallet facts and funding resolution status (the funding cache). */
export const wallets = pgTable("wallets", {
  address: text("address").primaryKey(),
  isContract: boolean("is_contract"),
  fundingStatus: text("funding_status", { enum: ["pending", "resolved", "unfunded", "error"] })
    .notNull()
    .default("pending"),
  firstFundedBlock: block("first_funded_block"),
  fundingError: text("funding_error"),
  /** Failed resolution attempts; wallets at MAX_FUNDING_ATTEMPTS are no longer retried. */
  fundingAttempts: integer("funding_attempts").notNull().default(0),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/**
 * One inbound value transfer that funded `wallet`. Evidence: tx hash + block.
 * `funder` is the frame that sent value (may be a disperse contract); `origin` is the tx signer.
 */
export const fundingEdges = pgTable(
  "funding_edges",
  {
    wallet: text("wallet").notNull(),
    funder: text("funder").notNull(),
    origin: text("origin").notNull(),
    kind: text("kind", { enum: ["native_direct", "native_internal"] }).notNull(),
    value: amount("value").notNull(),
    block: block("block").notNull(),
    blockTime: bigint("block_time", { mode: "number" }).notNull(),
    txHash: text("tx_hash").notNull(),
    source: text("source", { enum: ["rpc_archive_trace", "nansen"] }).notNull(),
    confidence: real("confidence").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.wallet, t.txHash, t.funder] }),
    index("funding_edges_funder_idx").on(t.funder),
    index("funding_edges_origin_idx").on(t.origin),
  ],
);

/** Multi-wallet entities from the latest global cluster run (ids are the smallest member address). */
export const entities = pgTable("entities", {
  id: text("id").primaryKey(),
  members: text("members").array().notNull(),
  size: integer("size").notNull(),
  /** Tracked tokens whose creator is a member. */
  createdTokens: text("created_tokens").array().notNull(),
  sourceBlock: block("source_block").notNull(),
});

/** Wallet -> entity lookup for wallets in multi-wallet entities. */
export const entityMembers = pgTable(
  "entity_members",
  {
    wallet: text("wallet").primaryKey(),
    entityId: text("entity_id").notNull(),
  },
  (t) => [index("entity_members_entity_idx").on(t.entityId)],
);

/** Accepted links inside an entity, each with its evidence list (edge type, tx hash, block, token). */
export const entityLinks = pgTable(
  "entity_links",
  {
    entityId: text("entity_id").notNull(),
    a: text("a").notNull(),
    b: text("b").notNull(),
    type: text("type").notNull(),
    weight: real("weight").notNull(),
    evidence: jsonb("evidence")
      .$type<Array<{ type: string; txHash: string; block: number; token?: string; detail?: string }>>()
      .notNull(),
  },
  (t) => [index("entity_links_entity_idx").on(t.entityId)],
);

/** Latest computed metrics per token. Amounts in wei-style integers. */
export const tokenMetrics = pgTable("token_metrics", {
  token: text("token").primaryKey(),
  sourceBlock: block("source_block").notNull(),
  totalSupply: amount("total_supply").notNull(),
  rawHolders: integer("raw_holders").notNull(),
  realHolders: integer("real_holders").notNull(),
  effectiveTop10Bps: integer("effective_top10_bps").notNull(),
  clusterSupplyBps: integer("cluster_supply_bps").notNull(),
  creatorLinkedSupplyBps: integer("creator_linked_supply_bps").notNull(),
  rawVolume: amount("raw_volume").notNull(),
  organicVolume: amount("organic_volume").notNull(),
  organicVolumeBps: integer("organic_volume_bps").notNull(),
  evidenceRoot: text("evidence_root").notNull(),
  /** Canonical JSON hashed into evidenceRoot, so anyone can recompute it. */
  evidenceJson: text("evidence_json").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every NunoFeed publish tx, for evidence links and measured cost/frequency. */
export const snapshots = pgTable(
  "snapshots",
  {
    txHash: text("tx_hash").primaryKey(),
    chainId: integer("chain_id").notNull(),
    feed: text("feed").notNull(),
    token: text("token").notNull(),
    sourceBlock: block("source_block").notNull(),
    publishBlock: block("publish_block").notNull(),
    evidenceRoot: text("evidence_root").notNull(),
    gasUsed: amount("gas_used").notNull(),
    effectiveGasPrice: amount("effective_gas_price").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("snapshots_token_idx").on(t.token, t.publishBlock)],
);

/**
 * CurveGraduate events, stored independently of `tokens`: in the parallel backfill a graduation
 * can be indexed before its token's CurveCreate. `applyGraduations` copies them onto tokens.
 */
export const graduations = pgTable("graduations", {
  token: text("token").primaryKey(),
  pool: text("pool").notNull(),
  block: block("block").notNull(),
  txHash: text("tx_hash").notNull(),
});
