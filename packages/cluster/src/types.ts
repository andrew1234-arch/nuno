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
  wallet: Addr;
  side: "buy" | "sell";
  block: number;
  txHash: string;
}

export interface TokenTransfer {
  from: Addr;
  to: Addr;
  block: number;
  txHash: string;
}

export interface ClusterInput {
  token: Addr;
  creator: Addr;
  createBlock: number;
  /** Wallets to cluster: the token's traders and holders. */
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
  containsCreator: boolean;
  /** Links whose accumulated pair weight crossed the threshold, with evidence. */
  links: Link[];
}

export interface ClusterResult {
  token: Addr;
  /** Wallet -> entity id. Singletons map to their own address. */
  entityOf: Map<Addr, string>;
  /** Multi-wallet clusters only. */
  clusters: Cluster[];
}
