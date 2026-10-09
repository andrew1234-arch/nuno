import { and, eq } from "drizzle-orm";
import { AddressBook, sqliteSchema as s, type SqlDb } from "@nuno/shared";

/**
 * Nansen client for the FREE plan (100 trial credits, then a daily top-up to 10).
 * Verified against docs.nansen.ai on 2026-10-09:
 *  - POST https://api.nansen.ai/api/v1/profiler/address/related-wallets, header `apikey`,
 *    body { wallet_address, chain: "monad", pagination: { page, per_page } } -> 1 credit.
 *    Rows: { address, address_label?, relation, transaction_hash, block_timestamp, order, chain }.
 *  - /profiler/address/labels costs 100 credits per non-empty result and needs a 100-credit
 *    balance: unusable on the free plan after the trial, so labels are read from related-wallets
 *    rows instead (a funded wallet's related list contains its funder with `address_label`).
 *  - Headers: X-Nansen-Credits-Used (0 on errors/empty), X-Nansen-Credits-Remaining.
 * Every response is cached permanently in `nansen_cache`; a cached address is never re-queried.
 * Never called from the web app: only the tick and backfill pipelines use it.
 */
export const NANSEN_BASE = "https://api.nansen.ai";
export const RELATED_WALLETS = "related-wallets";

export interface RelatedWallet {
  address: string;
  label: string | null;
  relation: string;
  tx: string;
}

export interface NansenOptions {
  apiKey?: string;
  /** Stop calling when known remaining credits would drop below this. */
  reserve?: number;
  /** Hard cap on paid calls per run. */
  maxCalls?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export class Nansen {
  /** Credits remaining as last reported by Nansen (null until the first response). */
  remaining: number | null = null;
  /** Credits actually charged during this run. */
  spent = 0;
  calls = 0;
  private stopped: string | null = null;
  private readonly reserve: number;
  private readonly maxCalls: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly db: SqlDb,
    private readonly book: AddressBook,
    private readonly opts: NansenOptions = {},
  ) {
    this.reserve = opts.reserve ?? 3;
    this.maxCalls = opts.maxCalls ?? 5;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    if (!opts.apiKey) this.stopped = "no NANSEN_API_KEY";
  }

  /** Why paid calls are disabled for the rest of this run, or null. */
  get disabled(): string | null {
    return this.stopped;
  }

  /** Cached result, or null when not cached. Never spends credits. */
  async cached(address: string): Promise<RelatedWallet[] | null> {
    const id = await this.book.id(address);
    const [row] = await this.db.select().from(s.nansenCache).where(and(eq(s.nansenCache.address, id), eq(s.nansenCache.endpoint, RELATED_WALLETS)));
    return row ? (JSON.parse(row.result) as RelatedWallet[]) : null;
  }

  /** Related wallets on Monad: cache first, then at most one paid call if the budget allows. */
  async relatedWallets(address: string): Promise<RelatedWallet[] | null> {
    const hit = await this.cached(address);
    if (hit) return hit;
    if (this.stopped) return null;
    if (this.calls >= this.maxCalls) {
      this.stopped = `per-run cap of ${this.maxCalls} calls reached`;
      return null;
    }
    // Related wallets costs 1 credit; keep `reserve` credits untouched.
    if (this.remaining !== null && this.remaining - 1 < this.reserve) {
      this.stopped = `credits remaining ${this.remaining} at reserve ${this.reserve}`;
      return null;
    }
    this.calls++;
    const res = await this.post(`/api/v1/profiler/address/${RELATED_WALLETS}`, {
      wallet_address: address.toLowerCase(),
      chain: "monad",
      pagination: { page: 1, per_page: 100 },
    });
    if (!res) return null;
    const rows = ((res.body as { data?: unknown[] }).data ?? []).map((r) => {
      const x = r as { address: string; address_label?: string | null; relation: string; transaction_hash: string };
      return { address: x.address.toLowerCase(), label: x.address_label ?? null, relation: x.relation, tx: x.transaction_hash };
    });
    await this.db
      .insert(s.nansenCache)
      .values({ address: await this.book.id(address), endpoint: RELATED_WALLETS, result: JSON.stringify(rows), creditsUsed: res.used, fetchedAt: Date.now() })
      .onConflictDoNothing();
    return rows;
  }

  private async post(path: string, body: unknown): Promise<{ body: unknown; used: number } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      let res: Response;
      try {
        res = await this.fetchImpl(`${NANSEN_BASE}${path}`, {
          method: "POST",
          headers: { apikey: this.opts.apiKey!, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (err) {
        this.opts.log?.(`[nansen] network error: ${(err as Error).message}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
      const used = Number(res.headers.get("x-nansen-credits-used") ?? 0) || 0;
      const remaining = res.headers.get("x-nansen-credits-remaining");
      this.spent += used;
      if (remaining !== null && remaining !== "") this.remaining = Number(remaining);
      if (res.status === 429 && attempt === 0) {
        const wait = Math.min(30, Number(res.headers.get("retry-after") ?? 2) || 2);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (res.status === 403) {
        this.stopped = "forbidden / insufficient credits (403)";
        return null;
      }
      if (!res.ok) {
        // Never log the key or the request; the status and Nansen's error code are enough.
        let code = "";
        try {
          code = ((await res.json()) as { code?: string }).code ?? "";
        } catch {
          /* non-JSON error body */
        }
        this.opts.log?.(`[nansen] ${path} -> HTTP ${res.status} ${code}`);
        return null;
      }
      return { body: await res.json(), used };
    }
    return null;
  }
}

/** Labels that mark an address as infrastructure (it must never link wallets). Case-insensitive. */
const INFRA_LABEL = /exchange|\bcex\b|binance|coinbase|okx|bybit|kraken|kucoin|gate\.io|bitget|mexc|htx|huobi|crypto\.com|bridge|router|aggregator|hot wallet|deposit|faucet/i;

export function isInfraLabel(label: string | null | undefined): boolean {
  return !!label && INFRA_LABEL.test(label);
}
