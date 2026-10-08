export type Addr = string; // lowercase 0x-hex

export type EdgeType =
  | "same_direct_funder"
  | "common_funding_source"
  | "creator_funded"
  | "token_transfer"
  | "same_block_early_buy"
  | "same_block_sell";

export interface Evidence {
  type: EdgeType;
  txHash: string;
  block: number;
  /** Token the evidence relates to (trade/transfer/creator edges); absent for pure funding edges. */
  token?: Addr;
  /** Extra context, e.g. the shared funder address. */
  detail?: string;
}

/** A weighted link between two wallets with the evidence that produced it. */
export interface Link {
  a: Addr;
  b: Addr;
  type: EdgeType;
  weight: number;
  evidence: Evidence[];
}

export interface FundingEdge {
  wallet: Addr;
  /** Frame that sent value (may be a disperse contract). */
  funder: Addr;
  /** Tx signer; the entity that controls the funds. Used as the linking funder. */
  origin: Addr;
  block: number;
  blockTime: number;
  txHash: string;
}

export interface Trade {
  token: Addr;
  wallet: Addr;
  side: "buy" | "sell";
  block: number;
  txHash: string;
}

export interface TokenTransfer {
  token: Addr;
  from: Addr;
  to: Addr;
  block: number;
  txHash: string;
}

export interface TokenLaunch {
  token: Addr;
  creator: Addr;
  createBlock: number;
}

/**
 * Global input: every tracked token at once. Funding and transfer links naturally span tokens;
 * same-block signals are grouped per (token, block) and accumulate across tokens per wallet pair.
 */
export interface ClusterInput {
  launches: TokenLaunch[];
  /** Wallets to cluster: traders and holders of any tracked token, plus creators. */
  wallets: Addr[];
  /** Addresses known to be contracts; never cluster members. */
  contracts: Set<Addr>;
  /** Addresses labelled infrastructure (CEX, bridge, router...); never linking funders. */
  infrastructure: Set<Addr>;
  funding: FundingEdge[];
  trades: Trade[];
  transfers: TokenTransfer[];
}

export interface ClusterConfig {
  weights: Record<EdgeType, number>;
  unionThreshold: number;
  sameFunderWindowSecs: number;
  maxFundingHops: number;
  earlyBuyBlocks: number;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  weights: {
    same_direct_funder: 1.0,
    common_funding_source: 0.8,
    creator_funded: 1.0,
    token_transfer: 1.0,
    same_block_early_buy: 0.5,
    same_block_sell: 0.5,
  },
  unionThreshold: 1.0,
  sameFunderWindowSecs: 24 * 3600,
  maxFundingHops: 3,
  // Monad blocks are ~0.3s; 200 blocks is the first ~minute after creation.
  earlyBuyBlocks: 200,
};

export interface Cluster {
  id: string;
  members: Addr[];
  /** Tokens whose creator is a member of this cluster. */
  createdTokens: Addr[];
  /** Links whose accumulated pair weight crossed the threshold, with evidence. */
  links: Link[];
}

export interface ClusterResult {
  /** Wallet -> entity id. Singletons map to their own address. */
  entityOf: Map<Addr, string>;
  /** Multi-wallet clusters only. */
  clusters: Cluster[];
}
