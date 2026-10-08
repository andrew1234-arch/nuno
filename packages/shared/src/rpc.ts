/**
 * The single JSON-RPC client used for every Monad call. Adds timeout, retry with backoff,
 * typed errors, bounded concurrency and an optional cache for immutable (historical) results.
 */

export class RpcError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly code?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class RpcTimeoutError extends RpcError {
  constructor(method: string, ms: number) {
    super(`${method} timed out after ${ms}ms`, method, undefined, true);
    this.name = "RpcTimeoutError";
  }
}

/** Provider-side limit hit (block range, response size). Not retryable with the same params. */
export class RpcLimitError extends RpcError {
  constructor(message: string, method: string, code?: number) {
    super(message, method, code, false);
    this.name = "RpcLimitError";
  }
}

export interface RpcClientOptions {
  /** One URL, or several to round-robin across (retries move to the next URL). */
  url: string | string[];
  timeoutMs?: number;
  retries?: number;
  maxConcurrency?: number;
  /** Max cached entries; only calls made with `cache: true` are cached. */
  cacheSize?: number;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

const LIMIT_PATTERNS = [/range/i, /too large/i, /limited to/i, /exceed/i];
// Messages that indicate the request itself is wrong; never retry these.
const FATAL_PATTERNS = [/not found/i, /not allowed/i, /not available/i, /invalid/i];

export function classifyRpcError(method: string, code: number, message: string): RpcError {
  if (LIMIT_PATTERNS.some((p) => p.test(message))) return new RpcLimitError(message, method, code);
  if (code === -32601 || FATAL_PATTERNS.some((p) => p.test(message))) {
    return new RpcError(message, method, code, false);
  }
  return new RpcError(message, method, code, true);
}

export class RpcClient {
  readonly urls: string[];
  private rr = 0;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly maxConcurrency: number;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, unknown>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(opts: RpcClientOptions) {
    this.urls = Array.isArray(opts.url) ? opts.url : [opts.url];
    if (this.urls.length === 0) throw new Error("RpcClient needs at least one URL");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = opts.retries ?? 6;
    this.maxConcurrency = opts.maxConcurrency ?? 8;
    this.cacheSize = opts.cacheSize ?? 50_000;
  }

  async call<T>(method: string, params: unknown[], opts: { cache?: boolean } = {}): Promise<T> {
    const key = opts.cache ? `${method}:${JSON.stringify(params)}` : undefined;
    if (key && this.cache.has(key)) return this.cache.get(key) as T;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const result = await this.withSlot(() => this.send<T>(method, params));
        if (key) {
          if (this.cache.size >= this.cacheSize) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
          }
          this.cache.set(key, result);
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (err instanceof RpcError && !err.retryable) throw err;
        if (attempt < this.retries) {
          // Rate limits need a much longer pause than transient errors.
          const base = err instanceof RpcError && err.code === 429 ? 2_000 : 400;
          await sleep(Math.min(30_000, base * 2 ** attempt) + Math.random() * 300);
        }
      }
    }
    throw lastErr;
  }

  private async send<T>(method: string, params: unknown[]): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      const url = this.urls[this.rr++ % this.urls.length]!;
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (ctrl.signal.aborted) throw new RpcTimeoutError(method, this.timeoutMs);
      throw new RpcError(`network error: ${(err as Error).message}`, method, undefined, true);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new RpcError(`HTTP ${res.status}`, method, res.status, true);
    }
    let body: JsonRpcResponse<T>;
    try {
      body = (await res.json()) as JsonRpcResponse<T>;
    } catch {
      throw new RpcError(`HTTP ${res.status}: non-JSON response`, method, res.status, true);
    }
    if (body.error) throw classifyRpcError(method, body.error.code, body.error.message);
    if (!("result" in body)) throw new RpcError("response missing result", method, undefined, true);
    return body.result as T;
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
