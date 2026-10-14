import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Build-time data access: the site is a static export, so pages read the JSON written by
// `pnpm export:static` (site/api/...). The same files are published as the public static API.
const DATA_DIR = resolve(process.cwd(), process.env.NUNO_DATA_DIR ?? "../../site/api");

/** "live" is the rolling window (default view); "contrast" is a fixed historical week. */
export type Dataset = "live" | "contrast";

export interface Metrics {
  sourceBlock: number;
  totalSupply: string;
  rawHolders: number;
  realHolders: number;
  effectiveTop10Bps: number;
  clusterSupplyBps: number;
  creatorLinkedSupplyBps: number;
  rawVolume: string;
  organicVolume: string;
  organicVolumeBps: number;
  evidenceRoot: string;
  computedAt: string;
}

export interface Token {
  address: string;
  name: string;
  symbol: string;
  creator: string;
  createBlock: number;
  createTx: string;
  graduatedPool: string | null;
  metrics: Metrics | null;
  pruned?: boolean;
}

export interface Snapshot {
  txHash: string;
  chainId: number;
  feed: string;
  sourceBlock: number;
  publishBlock: number;
  gasUsed: string;
  effectiveGasPrice: string;
  publishedAt: string;
}

export interface Evidence {
  type: string;
  txHash: string;
  block: number;
  token?: string;
  detail?: string;
}

export interface Cluster {
  id: string;
  size: number;
  members: string[];
  createdTokens: string[];
  sourceBlock: number;
  links: Array<{ a: string; b: string; type: string; weight: number; evidence: Evidence[] }>;
  labels?: Record<string, { label: string; category: string }>;
}

export interface FundingEdge {
  wallet: string;
  funder: string;
  origin: string | null;
  kind: string;
  value: string;
  block: number;
  blockTime: number;
  txHash: string;
  source: string;
}

export interface Wallet {
  address: string;
  isContract: boolean;
  entityId: string | null;
  fundingStatus: string;
  fundedBy: FundingEdge[];
  funded: FundingEdge[];
  trades: Array<{ token: string; buys: number; sells: number }>;
}

export interface Meta {
  sourceBlock: number;
  /** Time of the last indexed block and how far the chain head was ahead at export (absent offline). */
  sourceTime?: string;
  chainHead?: number;
  behindBlocks?: number;
  generatedAt: string;
  window: { startBlock: number; endBlock: number; days: number; coveredDays: number; startTime?: string; endTime?: string };
  counts: Record<string, number>;
  label?: string;
}

// Pages are rendered at build time and many read the same files (metadata + view + static params): parse each once.
const cache = new Map<string, unknown>();

function read<T>(dataset: Dataset, rel: string): T | null {
  const path = join(DATA_DIR, dataset === "contrast" ? "contrast" : "", rel);
  if (!cache.has(path)) cache.set(path, existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  return cache.get(path) as T | null;
}

export interface TokenLinks {
  image?: string | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  nsfw?: boolean;
  curve?: "V1" | "V2" | null;
  createdAt?: string;
}

export interface NansenCheck {
  address: string;
  entityId: string | null;
  nansenFirstFunder: { address: string; label: string | null; tx: string } | null;
  nunoFirstFunder: { address: string; tx: string; block: number } | null;
  match: boolean;
  fetchedAt: string;
}

export const hasDataset = (dataset: Dataset) => read<Meta>(dataset, "meta.json") !== null;

export const api = {
  meta: (d: Dataset = "live") => read<Meta>(d, "meta.json"),
  tokens: (d: Dataset = "live") => read<{ count: number; tokens: Token[] }>(d, "tokens.json")?.tokens ?? [],
  token: (address: string, d: Dataset = "live") =>
    read<Token & { latestSnapshot: Snapshot | null; clusters: Cluster[] }>(d, `tokens/${address.toLowerCase()}.json`),
  cluster: (id: string, d: Dataset = "live") => read<Cluster>(d, `clusters/${id.toLowerCase()}.json`),
  wallet: (address: string, d: Dataset = "live") => read<Wallet>(d, `wallets/${address.toLowerCase()}.json`),
  /** Logos and links from each token's nad.fun metadata (scripts/fetch-logos.mjs); empty when not fetched. */
  links: (address: string, d: Dataset = "live"): TokenLinks => read<Record<string, TokenLinks>>(d, "logos.json")?.[address.toLowerCase()] ?? {},
  /** Nansen related-wallets cross-checks (empty when the export has none). */
  nansen: (d: Dataset = "live") => read<{ endpoint: string; checked: number; matches: number; checks: NansenCheck[] }>(d, "nansen.json"),
  clusterIds: (d: Dataset = "live") => {
    const ids = new Set<string>();
    for (const t of api.tokens(d)) for (const c of api.token(t.address, d)?.clusters ?? []) ids.add(c.id);
    return [...ids];
  },
};

/** Static export needs at least one param per dynamic route; this placeholder renders the 404 page. */
export const PLACEHOLDER = "none";
