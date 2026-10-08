import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { openApiSpec } from "./openapi.js";
import type { Repo, TokenDto } from "./repo.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const SORTS = {
  /** Wallet-count inflation: raw holders minus real (entity) holders, largest first. */
  holder_gap: (t: TokenDto) => (t.metrics ? t.metrics.rawHolders - t.metrics.realHolders : -1),
  cluster_supply: (t: TokenDto) => t.metrics?.clusterSupplyBps ?? -1,
  creator_supply: (t: TokenDto) => t.metrics?.creatorLinkedSupplyBps ?? -1,
  /** Least organic volume first (only tokens with volume). */
  wash: (t: TokenDto) => (t.metrics && t.metrics.rawVolume !== "0" ? 10_000 - t.metrics.organicVolumeBps : -1),
  raw_volume: (t: TokenDto) => (t.metrics ? Number(BigInt(t.metrics.rawVolume) / 10n ** 15n) : -1),
  newest: (t: TokenDto) => t.createBlock,
} as const satisfies Record<string, (t: TokenDto) => number>;

export type SortKey = keyof typeof SORTS;

export function sortTokens(tokens: TokenDto[], sort: SortKey): TokenDto[] {
  const key = SORTS[sort];
  return [...tokens].sort((a, b) => key(b) - key(a) || a.address.localeCompare(b.address));
}

export interface AppOptions {
  /** Response cache TTL in ms (0 disables). */
  cacheTtlMs?: number;
  /** Max cached responses; oldest evicted first. */
  cacheMaxEntries?: number;
  /** Requests per window per client IP. */
  rateLimit?: { max: number; windowMs: number };
  /**
   * How to identify the client. Defaults to the socket address supplied by the server adapter.
   * X-Forwarded-For is only honoured when `trustProxy` is set (behind a known reverse proxy);
   * otherwise any client could pick a fresh IP per request and bypass the limit.
   */
  clientIp?: (c: Context) => string | undefined;
  trustProxy?: boolean;
  now?: () => number;
}

/** Map with a size cap that evicts its oldest entries (insertion order). */
function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Fixed-window in-memory limiter keyed by client IP, with bounded memory. */
function rateLimiter(max: number, windowMs: number, now: () => number, ip: (c: Context) => string): MiddlewareHandler {
  const hits = new Map<string, { start: number; n: number }>();
  return async (c, next) => {
    const key = ip(c);
    const t = now();
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) boundedSet(hits, key, { start: t, n: 1 }, 50_000);
    else if (++h.n > max) {
      c.header("retry-after", String(Math.ceil((h.start + windowMs - t) / 1000)));
      return c.json({ error: "rate limited" }, 429);
    }
    await next();
  };
}

/** Cache key from the path plus only the query parameters the API understands. */
function cacheKey(c: Context): string {
  const sort = c.req.query("sort");
  const limit = c.req.query("limit");
  return `${c.req.path}?sort=${sort ?? ""}&limit=${limit ?? ""}`;
}

export function createApp(repo: Repo, opts: AppOptions = {}) {
  const now = opts.now ?? Date.now;
  const ttl = opts.cacheTtlMs ?? 15_000;
  const maxEntries = opts.cacheMaxEntries ?? 1_000;
  const cache = new Map<string, { at: number; body: unknown; status: number }>();

  /** Cache successful GET JSON bodies for `ttl` ms. */
  const cached = async (c: Context, compute: () => Promise<{ body: unknown; status?: number }>) => {
    const key = cacheKey(c);
    const hit = cache.get(key);
    if (ttl > 0 && hit && now() - hit.at < ttl) {
      c.header("x-cache", "hit");
      return c.json(hit.body as object, hit.status as 200);
    }
    const { body, status = 200 } = await compute();
    if (ttl > 0 && status === 200) boundedSet(cache, key, { at: now(), body, status }, maxEntries);
    c.header("x-cache", "miss");
    return c.json(body as object, status as 200);
  };

  const clientIp = (c: Context): string => {
    if (opts.trustProxy) {
      const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
      if (fwd) return fwd;
    }
    return opts.clientIp?.(c) ?? "unknown";
  };

  const app = new Hono();
  app.use("*", cors());
  const rl = opts.rateLimit ?? { max: 120, windowMs: 60_000 };
  app.use("*", rateLimiter(rl.max, rl.windowMs, now, clientIp));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/openapi.json", (c) => c.json(openApiSpec));

  app.get("/tokens", (c) => {
    const sort = (c.req.query("sort") ?? "holder_gap") as SortKey;
    if (!(sort in SORTS)) return c.json({ error: `sort must be one of ${Object.keys(SORTS).join(", ")}` }, 400);
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 100) || 100));
    return cached(c, async () => {
      const tokens = sortTokens(await repo.listTokens(), sort).slice(0, limit);
      return { body: { sort, count: tokens.length, tokens } };
    });
  });

  app.get("/tokens/:address", (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!ADDRESS.test(address)) return c.json({ error: "invalid address" }, 400);
    return cached(c, async () => {
      const token = await repo.getToken(address);
      if (!token) return { body: { error: "token not tracked" }, status: 404 };
      return { body: { ...token, latestSnapshot: await repo.latestSnapshot(address) } };
    });
  });

  app.get("/tokens/:address/clusters", (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!ADDRESS.test(address)) return c.json({ error: "invalid address" }, 400);
    return cached(c, async () => {
      if (!(await repo.getToken(address))) return { body: { error: "token not tracked" }, status: 404 };
      const clusters = await repo.entitiesForToken(address);
      return { body: { token: address, count: clusters.length, clusters } };
    });
  });

  app.get("/clusters/:id", (c) => {
    const id = c.req.param("id").toLowerCase();
    if (!ADDRESS.test(id)) return c.json({ error: "invalid cluster id" }, 400);
    return cached(c, async () => {
      const e = await repo.getEntity(id);
      return e ? { body: e } : { body: { error: "cluster not found" }, status: 404 };
    });
  });

  app.get("/wallets/:address", (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!ADDRESS.test(address)) return c.json({ error: "invalid address" }, 400);
    return cached(c, async () => {
      const w = await repo.getWallet(address);
      return w ? { body: w } : { body: { error: "wallet not seen" }, status: 404 };
    });
  });

  return app;
}
