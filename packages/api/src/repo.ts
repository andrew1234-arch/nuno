import { desc, eq, or, sql } from "drizzle-orm";
import { bytesToHex } from "viem";
import { DEFAULT_CLUSTER_CONFIG, type Cluster } from "@nuno/cluster";
import { clustersFor, evidenceJsonFor } from "@nuno/metrics/store";
import { AddressBook, rows, sqliteSchema as s, txHex, type SqlDb } from "@nuno/shared";

// API read model over SQLite (address ids resolved back to hex via the address dictionary).

export interface TokenMetricsDto {
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

export interface TokenDto {
  address: string;
  name: string;
  symbol: string;
  creator: string;
  createBlock: number;
  createTx: string;
  graduatedPool: string | null;
  metrics: TokenMetricsDto | null;
}

export interface EvidenceDto {
  type: string;
  txHash: string;
  block: number;
  token?: string;
  detail?: string;
}

export interface EntityDto {
  id: string;
  size: number;
  members: string[];
  createdTokens: string[];
  sourceBlock: number;
  links: Array<{ a: string; b: string; type: string; weight: number; evidence: EvidenceDto[] }>;
}

export interface SnapshotDto {
  txHash: string;
  chainId: number;
  sourceBlock: number;
  publishBlock: number;
  evidenceRoot: string;
  gasUsed: string;
  effectiveGasPrice: string;
  publishedAt: string;
}

export interface FundingEdgeDto {
  wallet: string;
  funder: string;
  origin: string;
  kind: string;
  value: string;
  block: number;
  blockTime: number;
  txHash: string;
  source: string;
}

export interface WalletDto {
  address: string;
  isContract: boolean | null;
  entityId: string | null;
  fundingStatus: string | null;
  fundedBy: FundingEdgeDto[];
  funded: FundingEdgeDto[];
  trades: Array<{ token: string; buys: number; sells: number }>;
}

/** Read model used by the API. The Postgres implementation is below; tests use an in-memory fake. */
export interface Repo {
  listTokens(): Promise<TokenDto[]>;
  getToken(address: string): Promise<TokenDto | null>;
  latestSnapshot(token: string): Promise<SnapshotDto | null>;
  entitiesForToken(token: string): Promise<EntityDto[]>;
  getEntity(id: string): Promise<EntityDto | null>;
  getWallet(address: string): Promise<WalletDto | null>;
  /** Canonical evidence JSON whose keccak256 is the token's evidenceRoot. */
  evidenceJson(token: string): Promise<string | null>;
}

type MetricsRow = typeof s.tokenMetrics.$inferSelect;
type TokenRow = typeof s.tokens.$inferSelect;
const KIND = ["native_direct", "native_internal"];
const SOURCE = ["rpc_archive_trace", "nansen"];
const STATUS = ["pending", "resolved", "unfunded", "error"];

export class SqlRepo implements Repo {
  constructor(
    private readonly db: SqlDb,
    private readonly book: AddressBook = new AddressBook(db),
  ) {}

  private metricsDto(m: MetricsRow | null): TokenMetricsDto | null {
    return (
      m && {
        sourceBlock: m.sourceBlock,
        totalSupply: m.totalSupply,
        rawHolders: m.rawHolders,
        realHolders: m.realHolders,
        effectiveTop10Bps: m.effectiveTop10Bps,
        clusterSupplyBps: m.clusterSupplyBps,
        creatorLinkedSupplyBps: m.creatorLinkedSupplyBps,
        rawVolume: m.rawVolume,
        organicVolume: m.organicVolume,
        organicVolumeBps: m.organicVolumeBps,
        evidenceRoot: bytesToHex(m.evidenceRoot),
        computedAt: new Date(m.computedAt).toISOString(),
      }
    );
  }

  private async tokenDtos(rs: Array<{ tokens: TokenRow; token_metrics: MetricsRow | null }>): Promise<TokenDto[]> {
    const hex = await this.book.hexes(rs.flatMap((r) => [r.tokens.id, r.tokens.creator, ...(r.tokens.graduatedPool ? [r.tokens.graduatedPool] : [])]));
    return rs.map(({ tokens: t, token_metrics: m }) => ({
      address: hex.get(t.id)!.toLowerCase(),
      name: t.name,
      symbol: t.symbol,
      creator: hex.get(t.creator)!.toLowerCase(),
      createBlock: t.createBlock,
      createTx: txHex(t.createTx),
      graduatedPool: t.graduatedPool ? hex.get(t.graduatedPool)!.toLowerCase() : null,
      metrics: this.metricsDto(m),
    }));
  }

  async listTokens(): Promise<TokenDto[]> {
    const rs = await this.db.select().from(s.tokens).leftJoin(s.tokenMetrics, eq(s.tokenMetrics.token, s.tokens.id));
    return this.tokenDtos(rs);
  }

  async getToken(address: string): Promise<TokenDto | null> {
    const id = await this.book.find(address);
    if (id === undefined) return null;
    const rs = await this.db.select().from(s.tokens).leftJoin(s.tokenMetrics, eq(s.tokenMetrics.token, s.tokens.id)).where(eq(s.tokens.id, id));
    return rs.length ? (await this.tokenDtos(rs))[0]! : null;
  }

  async latestSnapshot(token: string): Promise<SnapshotDto | null> {
    const id = await this.book.find(token);
    if (id === undefined) return null;
    const [snap] = await this.db.select().from(s.snapshots).where(eq(s.snapshots.token, id)).orderBy(desc(s.snapshots.publishBlock)).limit(1);
    return snap
      ? {
          txHash: txHex(snap.tx),
          chainId: snap.chainId,
          sourceBlock: snap.sourceBlock,
          publishBlock: snap.publishBlock,
          evidenceRoot: bytesToHex(snap.evidenceRoot),
          gasUsed: String(snap.gasUsed),
          effectiveGasPrice: snap.effectiveGasPrice,
          publishedAt: new Date(snap.publishedAt).toISOString(),
        }
      : null;
  }

  private async sourceBlock(): Promise<number> {
    const [c] = await this.db.select().from(s.cursors).where(eq(s.cursors.name, "indexer"));
    return c?.block ?? 0;
  }

  private async entityDtos(clusters: Cluster[]): Promise<EntityDto[]> {
    const block = await this.sourceBlock();
    return clusters
      .map((c) => ({ id: c.id, size: c.members.length, members: c.members, createdTokens: c.createdTokens, sourceBlock: block, links: c.links.map(({ a, b, type, weight, evidence }) => ({ a, b, type, weight, evidence })) }))
      .sort((x, y) => y.size - x.size);
  }

  async entitiesForToken(token: string): Promise<EntityDto[]> {
    const id = await this.book.find(token);
    if (id === undefined) return [];
    // Same attribution as the metrics pipeline: a bot-contract trade belongs to its signer.
    const rs = await rows<{ entity: number }>(
      this.db,
      sql`select distinct em.entity as entity from entity_members em where em.wallet in (
            select case when sw.is_contract = 1 and ct.tx_from is not null then ct.tx_from else ct.trader end
              from curve_trades ct left join wallets sw on sw.id = ct.trader where ct.token = ${id}
            union select "from" from transfers where token = ${id}
            union select "to" from transfers where token = ${id}
            union select creator from tokens where id = ${id})`,
      ["entity"],
    );
    return this.entityDtos(await clustersFor({ db: this.db, book: this.book }, rs.map((r) => Number(r.entity)), DEFAULT_CLUSTER_CONFIG));
  }

  async getEntity(idHex: string): Promise<EntityDto | null> {
    const id = await this.book.find(idHex);
    if (id === undefined) return null;
    const [m] = await this.db.select().from(s.entityMembers).where(eq(s.entityMembers.entity, id)).limit(1);
    if (!m) return null;
    const [e] = await this.entityDtos(await clustersFor({ db: this.db, book: this.book }, [id], DEFAULT_CLUSTER_CONFIG));
    return e ?? null;
  }

  async getWallet(address: string): Promise<WalletDto | null> {
    const id = await this.book.find(address);
    if (id === undefined) return null;
    const [w] = await this.db.select().from(s.wallets).where(eq(s.wallets.id, id));
    const [m] = await this.db.select().from(s.entityMembers).where(eq(s.entityMembers.wallet, id));
    const edges = await this.db.select().from(s.fundingEdges).where(or(eq(s.fundingEdges.wallet, id), eq(s.fundingEdges.origin, id)));
    // Trades sent directly, plus trades routed through a bot contract that this wallet signed.
    const trades = await rows<{ token: number; buys: number; sells: number }>(
      this.db,
      sql`select ct.token as token, sum(case when ct.side = 0 then 1 else 0 end) as buys, sum(case when ct.side = 1 then 1 else 0 end) as sells
          from curve_trades ct left join wallets sw on sw.id = ct.trader
          where ct.trader = ${id} or (sw.is_contract = 1 and ct.tx_from = ${id})
          group by ct.token`,
      ["token", "buys", "sells"],
    );
    if (!w && !m && !edges.length && !trades.length) return null;
    const hex = await this.book.hexes([...edges.flatMap((e) => [e.wallet, e.funder, e.origin]), ...trades.map((t) => Number(t.token)), ...(m ? [m.entity] : [])]);
    const h = (x: number) => hex.get(x)!.toLowerCase();
    const dto = (e: (typeof edges)[number]): FundingEdgeDto => ({
      wallet: h(e.wallet),
      funder: h(e.funder),
      origin: h(e.origin),
      kind: KIND[e.kind]!,
      value: e.value,
      block: e.block,
      blockTime: e.blockTime,
      txHash: txHex(e.tx),
      source: SOURCE[e.source]!,
    });
    return {
      address: address.toLowerCase(),
      isContract: w?.isContract == null ? null : w.isContract === 1,
      entityId: m ? h(m.entity) : null,
      fundingStatus: w ? STATUS[w.fundingStatus]! : null,
      fundedBy: edges.filter((e) => e.wallet === id).map(dto),
      funded: edges.filter((e) => e.origin === id && e.wallet !== id).map(dto),
      trades: trades.map((t) => ({ token: h(Number(t.token)), buys: Number(t.buys), sells: Number(t.sells) })),
    };
  }

  async evidenceJson(token: string): Promise<string | null> {
    const id = await this.book.find(token);
    if (id === undefined) return null;
    return evidenceJsonFor({ db: this.db, book: this.book }, id);
  }
}


