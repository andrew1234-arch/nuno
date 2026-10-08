import {
  bigint,
  boolean,
  index,
  integer,
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
    trader: text("trader").notNull(),
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
