import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { schema, type Db } from "@nuno/shared";

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
  feed: string;
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
}

type MetricsRow = typeof schema.tokenMetrics.$inferSelect;
type TokenRow = typeof schema.tokens.$inferSelect;

const metricsDto = (m: MetricsRow | null): TokenMetricsDto | null =>
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
    evidenceRoot: m.evidenceRoot,
    computedAt: m.computedAt.toISOString(),
  };

const tokenDto = (t: TokenRow, m: MetricsRow | null): TokenDto => ({
  address: t.address,
  name: t.name,
  symbol: t.symbol,
  creator: t.creator,
  createBlock: t.createBlock,
  createTx: t.createTx,
  graduatedPool: t.graduatedPool,
  metrics: metricsDto(m),
});

export class PgRepo implements Repo {
  constructor(private readonly db: Db) {}

  async listTokens(): Promise<TokenDto[]> {
    const rows = await this.db
      .select()
      .from(schema.tokens)
      .leftJoin(schema.tokenMetrics, eq(schema.tokenMetrics.token, schema.tokens.address));
    return rows.map((r) => tokenDto(r.tokens, r.token_metrics));
  }

  async getToken(address: string): Promise<TokenDto | null> {
    const [r] = await this.db
      .select()
      .from(schema.tokens)
      .leftJoin(schema.tokenMetrics, eq(schema.tokenMetrics.token, schema.tokens.address))
      .where(eq(schema.tokens.address, address));
    return r ? tokenDto(r.tokens, r.token_metrics) : null;
  }

  async latestSnapshot(token: string): Promise<SnapshotDto | null> {
    const [s] = await this.db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.token, token))
      .orderBy(desc(schema.snapshots.publishBlock))
      .limit(1);
    return s ? { ...s, publishedAt: s.publishedAt.toISOString() } : null;
  }

  async entitiesForToken(token: string): Promise<EntityDto[]> {
    const rows = await this.db.execute<{ entity_id: string }>(sql`
      select distinct em.entity_id from entity_members em
      where em.wallet in (
        -- Same attribution as the metrics pipeline: a bot-contract trade belongs to its signer.
        select case when sw.is_contract and ct.tx_from is not null then ct.tx_from else ct.trader end
          from curve_trades ct left join wallets sw on sw.address = ct.trader
          where ct.token = ${token}
        union select "from" from transfers where token = ${token}
        union select "to" from transfers where token = ${token}
        union select creator from tokens where address = ${token}
      )`);
    const ids = [...rows].map((r) => r.entity_id);
    return this.entities(ids);
  }

  async getEntity(id: string): Promise<EntityDto | null> {
    const [e] = await this.entities([id]);
    return e ?? null;
  }

  private async entities(ids: string[]): Promise<EntityDto[]> {
    if (!ids.length) return [];
    const es = await this.db.select().from(schema.entities).where(inArray(schema.entities.id, ids));
    const links = await this.db.select().from(schema.entityLinks).where(inArray(schema.entityLinks.entityId, ids));
    return es
      .map((e) => ({
        id: e.id,
        size: e.size,
        members: e.members,
        createdTokens: e.createdTokens,
        sourceBlock: e.sourceBlock,
        links: links.filter((l) => l.entityId === e.id).map(({ a, b, type, weight, evidence }) => ({ a, b, type, weight, evidence })),
      }))
      .sort((x, y) => y.size - x.size);
  }

  async getWallet(address: string): Promise<WalletDto | null> {
    const [w] = await this.db.select().from(schema.wallets).where(eq(schema.wallets.address, address));
    const [m] = await this.db.select().from(schema.entityMembers).where(eq(schema.entityMembers.wallet, address));
    const edges = await this.db
      .select()
      .from(schema.fundingEdges)
      .where(or(eq(schema.fundingEdges.wallet, address), eq(schema.fundingEdges.origin, address)));
    // Trades sent directly, plus trades routed through a bot contract that this wallet signed.
    const trades = [
      ...(await this.db.execute<{ token: string; buys: number; sells: number }>(sql`
        select ct.token,
               count(*) filter (where ct.side = 'buy')::int as buys,
               count(*) filter (where ct.side = 'sell')::int as sells
        from curve_trades ct left join wallets sw on sw.address = ct.trader
        where ct.trader = ${address} or (sw.is_contract and ct.tx_from = ${address})
        group by ct.token`)),
    ].map((r) => ({ token: r.token, buys: r.buys, sells: r.sells }));
    if (!w && !m && !edges.length && !trades.length) return null;
    return {
      address,
      isContract: w?.isContract ?? null,
      entityId: m?.entityId ?? null,
      fundingStatus: w?.fundingStatus ?? null,
      fundedBy: edges.filter((e) => e.wallet === address),
      funded: edges.filter((e) => e.origin === address && e.wallet !== address),
      trades,
    };
  }
}
