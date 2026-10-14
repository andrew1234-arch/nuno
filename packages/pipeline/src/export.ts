import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { SqlRepo, type TokenDto } from "@nuno/api";
import { INDEXER_CURSOR, WINDOW_CURSOR, getCursor } from "@nuno/indexer";
import { AddressBook, MONAD_SECONDS_PER_BLOCK, scalar, sqliteSchema as s, txHex, type SqlDb } from "@nuno/shared";
import { labelsFor } from "./nansen-checks.js";
import { Nansen } from "./nansen.js";

/**
 * Static API for GitHub Pages (directive 4). Files under `<outDir>/api/`:
 *   meta.json, tokens.json, tokens/<address>.json, clusters/<id>.json, wallets/<address>.json
 * Wallet files exist only for wallets in multi-wallet entities. Total size is capped.
 */
export const MAX_EXPORT_BYTES = 50_000_000;

/** Holder inflation (raw - real), then cluster supply: the "gap" the screener sorts by. */
export function sortByGap(tokens: TokenDto[]): TokenDto[] {
  const gap = (t: TokenDto) => (t.metrics ? t.metrics.rawHolders - t.metrics.realHolders : -1);
  const cluster = (t: TokenDto) => t.metrics?.clusterSupplyBps ?? -1;
  return [...tokens].sort((a, b) => gap(b) - gap(a) || cluster(b) - cluster(a) || b.createBlock - a.createBlock);
}

export interface ExportResult {
  files: number;
  bytes: number;
}

/** Data freshness at export time; omitted when the RPC is unreachable (the export never needs it). */
export interface Freshness {
  /** ISO time of the last indexed block. */
  sourceTime: string;
  /** ISO time of the window's first block. */
  windowStartTime: string;
  chainHead: number;
}

export async function exportStatic(
  db: SqlDb,
  outDir: string,
  opts: { dbSizeBytes: number; backfillDays: number; label?: string; freshness?: (sourceBlock: number, windowStart: number) => Promise<Freshness | null> },
): Promise<ExportResult> {
  const book = new AddressBook(db);
  const repo = new SqlRepo(db, book);
  const nansen = new Nansen(db, book, {}); // cache reads only: no key, never calls the API
  const apiDir = join(outDir, "api");
  rmSync(apiDir, { recursive: true, force: true });
  let files = 0;
  let bytes = 0;
  const write = (rel: string, data: unknown) => {
    const body = JSON.stringify(data);
    bytes += Buffer.byteLength(body);
    if (bytes > MAX_EXPORT_BYTES) throw new Error(`static export exceeds ${MAX_EXPORT_BYTES} bytes (at ${rel})`);
    const path = join(apiDir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
    files++;
  };

  const tokens = sortByGap(await repo.listTokens());
  const pruned = new Set((await db.select({ id: s.tokens.id }).from(s.tokens).where(eq(s.tokens.pruned, 1))).map((r) => r.id));
  const prunedHex = new Set([...(await book.hexes([...pruned])).values()].map((h) => h.toLowerCase()));

  const entityIds = (await db.selectDistinct({ e: s.entityMembers.entity }).from(s.entityMembers)).map((r) => r.e);
  const sourceBlock = (await getCursor(db, INDEXER_CURSOR)) ?? 0;
  const windowStart = (await getCursor(db, WINDOW_CURSOR)) ?? sourceBlock;
  const fresh = opts.freshness ? await opts.freshness(sourceBlock, windowStart) : null;
  write("meta.json", {
    ...(opts.label ? { label: opts.label } : {}),
    sourceBlock,
    ...(fresh ? { sourceTime: fresh.sourceTime, chainHead: fresh.chainHead, behindBlocks: Math.max(0, fresh.chainHead - sourceBlock) } : {}),
    generatedAt: new Date().toISOString(),
    dbSizeBytes: opts.dbSizeBytes,
    window: {
      startBlock: windowStart,
      endBlock: sourceBlock,
      ...(fresh ? { startTime: fresh.windowStartTime, endTime: fresh.sourceTime } : {}),
      days: opts.backfillDays,
      coveredDays: Number((((sourceBlock - windowStart) * MONAD_SECONDS_PER_BLOCK) / 86_400).toFixed(2)),
    },
    counts: {
      tokens: tokens.length,
      tokensWithMetrics: tokens.filter((t) => t.metrics).length,
      prunedTokens: pruned.size,
      entities: entityIds.length,
      walletsInEntities: await scalar(db, sql`select count(*) from entity_members`),
      curveTrades: await scalar(db, sql`select count(*) from curve_trades`),
      fundingEdges: await scalar(db, sql`select count(*) from funding_edges`),
    },
    refreshIntervalMinutes: 20,
  });
  write("tokens.json", { sort: "holder_gap", count: tokens.length, tokens: tokens.map((t) => ({ ...t, pruned: prunedHex.has(t.address) })) });

  for (const t of tokens) {
    const clusters = await repo.entitiesForToken(t.address);
    write(`tokens/${t.address}.json`, {
      ...t,
      pruned: prunedHex.has(t.address),
      latestSnapshot: await repo.latestSnapshot(t.address),
      clusters,
      // keccak256 of this exact string is the token's evidenceRoot (also on NunoFeed once published).
      evidenceCanonical: prunedHex.has(t.address) ? null : await repo.evidenceJson(t.address),
    });
  }

  const memberWallets = new Set<string>();
  for (const id of entityIds) {
    const idHex = (await book.hex(id))!.toLowerCase();
    const e = await repo.getEntity(idHex);
    if (!e) continue;
    e.members.forEach((m) => memberWallets.add(m));
    // Labels (from Nansen checks) for members and for the funders that appear in the evidence.
    const linked = [...new Set([...e.members, ...e.links.flatMap((l) => l.evidence.map((x) => x.detail).filter((d): d is string => !!d))])];
    const ids = await book.ids(linked);
    const labels = await labelsFor(db, [...ids.values()]);
    const byAddr: Record<string, { label: string; category: string }> = {};
    for (const [addr, id2] of ids) {
      const l = labels.get(id2);
      if (l) byAddr[addr] = l;
    }
    write(`clusters/${idHex}.json`, {
      ...e,
      nansenRelated: await nansen.cached(idHex), // cached related-wallets (display only), or null
      labels: byAddr,
    });
  }
  for (const w of memberWallets) {
    const dto = await repo.getWallet(w);
    if (dto) write(`wallets/${w}.json`, dto);
  }
  // Nansen cross-checks: for each address Nansen was asked about (related-wallets, cached), its
  // "First Funder" next to Nuno's own first funding edge. `match` = same funder and same tx.
  const nansenRows = await db.select().from(s.nansenCache).where(eq(s.nansenCache.endpoint, "related-wallets"));
  const checks = [];
  for (const r of nansenRows) {
    const address = (await book.hex(r.address))?.toLowerCase();
    if (!address) continue;
    const rel = JSON.parse(r.result) as Array<{ address: string; label: string; relation: string; tx: string }>;
    const ff = rel.find((x) => x.relation === "First Funder") ?? null;
    const ours = (await db.select().from(s.fundingEdges).where(eq(s.fundingEdges.wallet, r.address)).orderBy(s.fundingEdges.block).limit(1))[0];
    const ourFunder = ours ? (await book.hex(ours.funder))?.toLowerCase() ?? null : null;
    const ourTx = ours ? txHex(ours.tx).toLowerCase() : null;
    const ent = (await db.select({ e: s.entityMembers.entity }).from(s.entityMembers).where(eq(s.entityMembers.wallet, r.address)))[0];
    checks.push({
      address,
      entityId: ent ? (await book.hex(ent.e))?.toLowerCase() ?? null : null,
      nansenFirstFunder: ff ? { address: ff.address.toLowerCase(), label: ff.label || null, tx: ff.tx.toLowerCase() } : null,
      nunoFirstFunder: ourFunder && ourTx ? { address: ourFunder, tx: ourTx, block: ours!.block } : null,
      match: Boolean(ff && ourFunder === ff.address.toLowerCase() && ourTx === ff.tx.toLowerCase()),
      fetchedAt: new Date(r.fetchedAt).toISOString(),
    });
  }
  write("nansen.json", { endpoint: "POST https://api.nansen.ai/api/v1/profiler/address/related-wallets", checked: checks.length, matches: checks.filter((c) => c.match).length, checks });

  return { files, bytes };
}
