// Pre-spend risk gate: turns Nuno's published numbers into an allow/deny decision an agent
// wallet can enforce. Pure functions over the static API's JSON; no network, no clock.

export interface GatePolicy {
  /** Deny when clusters hold more than this share of supply (basis points). */
  maxClusterSupplyBps: number;
  /** Deny when the creator and linked wallets hold more than this share (basis points). */
  maxCreatorLinkedSupplyBps: number;
  /** Deny when fewer real owners than this remain after entities are counted once. */
  minRealHolders: number;
  /** Deny when Nuno's data is older than this many seconds. */
  maxAgeSeconds: number;
}

export const DEFAULT_POLICY: GatePolicy = {
  maxClusterSupplyBps: 3000,
  maxCreatorLinkedSupplyBps: 3000,
  minRealHolders: 5,
  maxAgeSeconds: 3600,
};

export interface TokenFile {
  address: string;
  symbol?: string;
  creator?: string;
  pruned?: boolean;
  metrics: {
    rawHolders: number;
    realHolders: number;
    clusterSupplyBps: number;
    creatorLinkedSupplyBps: number;
    organicVolumeBps: number;
    evidenceRoot: string;
  } | null;
  clusters?: Array<{ id: string; size: number; links: Array<{ type: string; evidence: Array<{ txHash: string }> }> }>;
}

export interface MetaFile {
  generatedAt: string;
  sourceTime?: string;
}

export interface WalletFile {
  address: string;
  entityId: string | null;
}

export interface EntityFile {
  id: string;
  size: number;
  createdTokens: string[];
  links: Array<{ type: string; evidence: Array<{ txHash: string }> }>;
}

export type Reason =
  | { code: "no_data"; detail: string }
  | { code: "stale"; ageSeconds: number; maxAgeSeconds: number }
  | { code: "too_clustered"; clusterSupplyBps: number; max: number }
  | { code: "creator_linked"; creatorLinkedSupplyBps: number; max: number }
  | { code: "few_real_holders"; realHolders: number; rawHolders: number; min: number }
  | { code: "multi_wallet_entity"; entityId: string; wallets: number; tokensLaunched: number };

export interface Verdict {
  allow: boolean;
  reasons: Reason[];
  /** Transactions a human or another agent can open on an explorer to check the links. */
  evidenceTxs: string[];
  evidenceRoot?: string;
}

/** Age of the data: time of the last indexed block when known, else the export time. */
export function dataAgeSeconds(meta: MetaFile, now: Date): number {
  const at = Date.parse(meta.sourceTime ?? meta.generatedAt);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now.getTime() - at) / 1000)) : Number.POSITIVE_INFINITY;
}

function sampleTxs(links: Array<{ evidence: Array<{ txHash: string }> }>, limit = 5): string[] {
  return [...new Set(links.flatMap((l) => l.evidence.map((e) => e.txHash)))].slice(0, limit);
}

/** Missing or stale data denies: an agent must not read "unknown" as "safe". */
export function tokenVerdict(token: TokenFile | null, meta: MetaFile | null, now: Date, policy: GatePolicy = DEFAULT_POLICY): Verdict {
  if (!token || !meta) return { allow: false, reasons: [{ code: "no_data", detail: "token is not in Nuno's window" }], evidenceTxs: [] };
  const m = token.metrics;
  if (!m || token.pruned) return { allow: false, reasons: [{ code: "no_data", detail: "no current metrics for this token" }], evidenceTxs: [] };

  const reasons: Reason[] = [];
  const age = dataAgeSeconds(meta, now);
  if (age > policy.maxAgeSeconds) reasons.push({ code: "stale", ageSeconds: age, maxAgeSeconds: policy.maxAgeSeconds });
  if (m.clusterSupplyBps > policy.maxClusterSupplyBps) reasons.push({ code: "too_clustered", clusterSupplyBps: m.clusterSupplyBps, max: policy.maxClusterSupplyBps });
  if (m.creatorLinkedSupplyBps > policy.maxCreatorLinkedSupplyBps) reasons.push({ code: "creator_linked", creatorLinkedSupplyBps: m.creatorLinkedSupplyBps, max: policy.maxCreatorLinkedSupplyBps });
  if (m.realHolders < policy.minRealHolders) reasons.push({ code: "few_real_holders", realHolders: m.realHolders, rawHolders: m.rawHolders, min: policy.minRealHolders });

  return {
    allow: reasons.length === 0,
    reasons,
    evidenceTxs: sampleTxs((token.clusters ?? []).flatMap((c) => c.links)),
    evidenceRoot: m.evidenceRoot,
  };
}

/**
 * Counterparty check. A wallet with no file is simply not in a multi-wallet entity in the
 * window; that is "nothing found", so it is allowed, and the caller is told it is unverified.
 */
export function counterpartyVerdict(wallet: WalletFile | null, entity: EntityFile | null): Verdict & { known: boolean } {
  if (!wallet || !wallet.entityId || !entity) return { allow: true, known: false, reasons: [], evidenceTxs: [] };
  return {
    allow: false,
    known: true,
    reasons: [{ code: "multi_wallet_entity", entityId: entity.id, wallets: entity.size, tokensLaunched: entity.createdTokens.length }],
    evidenceTxs: sampleTxs(entity.links),
  };
}
