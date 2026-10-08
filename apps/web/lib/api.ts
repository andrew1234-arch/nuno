const API = process.env.NUNO_API_URL ?? "http://localhost:8787";

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
}

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`, { next: { revalidate: 15 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  tokens: (sort: string) => get<{ sort: string; count: number; tokens: Token[] }>(`/tokens?sort=${encodeURIComponent(sort)}&limit=500`),
  token: (address: string) => get<Token & { latestSnapshot: Snapshot | null }>(`/tokens/${address}`),
  tokenClusters: (address: string) => get<{ count: number; clusters: Cluster[] }>(`/tokens/${address}/clusters`),
  cluster: (id: string) => get<Cluster>(`/clusters/${id}`),
};
