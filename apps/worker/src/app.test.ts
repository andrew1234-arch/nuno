import { describe, expect, it } from "vitest";
import { createApp, sortTokens } from "./app.js";
import type { EntityDto, Repo, TokenDto, TokenMetricsDto } from "./repo.js";

// Hand-built test fixtures (not real chain data).
const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);
const W = "0x" + "1".repeat(40);

const metrics = (over: Partial<TokenMetricsDto>): TokenMetricsDto => ({
  sourceBlock: 100,
  totalSupply: "1000",
  rawHolders: 10,
  realHolders: 10,
  effectiveTop10Bps: 0,
  clusterSupplyBps: 0,
  creatorLinkedSupplyBps: 0,
  rawVolume: "0",
  organicVolume: "0",
  organicVolumeBps: 0,
  evidenceRoot: "0x" + "0".repeat(64),
  computedAt: "2026-10-08T00:00:00.000Z",
  ...over,
});

const token = (address: string, createBlock: number, m: Partial<TokenMetricsDto> | null): TokenDto => ({
  address,
  name: address.slice(2, 5),
  symbol: address.slice(2, 5).toUpperCase(),
  creator: W,
  createBlock,
  createTx: "0x01",
  graduatedPool: null,
  metrics: m && metrics(m),
});

const tokens = [
  token(A, 1, { rawHolders: 50, realHolders: 10, clusterSupplyBps: 100, rawVolume: "5000000000000000000", organicVolumeBps: 9000 }),
  token(B, 2, { rawHolders: 20, realHolders: 18, clusterSupplyBps: 7000, rawVolume: "9000000000000000000", organicVolumeBps: 1000 }),
  token(C, 3, null),
];

const entity: EntityDto = {
  id: W,
  size: 2,
  members: [W, "0x" + "2".repeat(40)],
  createdTokens: [A],
  sourceBlock: 100,
  links: [{ a: W, b: "0x" + "2".repeat(40), type: "same_direct_funder", weight: 1, evidence: [{ type: "same_direct_funder", txHash: "0xabc", block: 9 }] }],
};

function fakeRepo(): Repo & { calls: number } {
  const repo = {
    calls: 0,
    async listTokens() {
      repo.calls++;
      return tokens;
    },
    async getToken(a: string) {
      return tokens.find((t) => t.address === a) ?? null;
    },
    async latestSnapshot() {
      return null;
    },
    async entitiesForToken(a: string) {
      return a === A ? [entity] : [];
    },
    async getEntity(id: string) {
      return id === W ? entity : null;
    },
    async getWallet() {
      return null;
    },
    async evidenceJson(a: string) {
      return a === A ? JSON.stringify({ token: A, clusters: [] }) : null;
    },
  };
  return repo;
}

describe("sortTokens", () => {
  it("sorts by holder gap, putting tokens without metrics last", () => {
    expect(sortTokens(tokens, "holder_gap").map((t) => t.address)).toEqual([A, B, C]);
  });
  it("sorts by cluster supply and by wash share", () => {
    expect(sortTokens(tokens, "cluster_supply").map((t) => t.address)).toEqual([B, A, C]);
    expect(sortTokens(tokens, "wash").map((t) => t.address)).toEqual([B, A, C]);
  });
  it("sorts by newest", () => {
    expect(sortTokens(tokens, "newest").map((t) => t.address)).toEqual([C, B, A]);
  });
});

describe("API routes", () => {
  it("GET /tokens returns sorted tokens and validates sort", async () => {
    const app = createApp(fakeRepo());
    const res = await app.request("/tokens?sort=cluster_supply&limit=2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: TokenDto[]; count: number };
    expect(body.count).toBe(2);
    expect(body.tokens[0]!.address).toBe(B);
    expect((await app.request("/tokens?sort=nope")).status).toBe(400);
  });

  it("GET /tokens/:address normalises case, 404s unknown, 400s malformed", async () => {
    const app = createApp(fakeRepo());
    const ok = await app.request(`/tokens/${A.toUpperCase().replace("0X", "0x")}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as TokenDto).address).toBe(A);
    expect((await app.request(`/tokens/0x${"9".repeat(40)}`)).status).toBe(404);
    expect((await app.request("/tokens/0x123")).status).toBe(400);
  });

  it("GET /tokens/:address/clusters returns entities with evidence", async () => {
    const app = createApp(fakeRepo());
    const body = (await (await app.request(`/tokens/${A}/clusters`)).json()) as { clusters: EntityDto[] };
    expect(body.clusters[0]!.links[0]!.evidence[0]!.txHash).toBe("0xabc");
  });

  it("GET /clusters/:id and /wallets/:address", async () => {
    const app = createApp(fakeRepo());
    expect((await app.request(`/clusters/${W}`)).status).toBe(200);
    expect((await app.request(`/clusters/${A}`)).status).toBe(404);
    expect((await app.request(`/wallets/${W}`)).status).toBe(404);
  });

  it("serves the OpenAPI spec", async () => {
    const res = await createApp(fakeRepo()).request("/openapi.json");
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toEqual(["/tokens", "/tokens/{address}", "/tokens/{address}/clusters", "/tokens/{address}/evidence", "/clusters/{id}", "/wallets/{address}"]);
  });

  it("caches GET responses within the TTL", async () => {
    let t = 0;
    const repo = fakeRepo();
    const app = createApp(repo, { cacheTtlMs: 1000, now: () => t });
    expect((await app.request("/tokens")).headers.get("x-cache")).toBe("miss");
    expect((await app.request("/tokens")).headers.get("x-cache")).toBe("hit");
    expect(repo.calls).toBe(1);
    t = 1500;
    await app.request("/tokens");
    expect(repo.calls).toBe(2);
  });

  it("ignores X-Forwarded-For unless trustProxy is set (no limit bypass)", async () => {
    const app = createApp(fakeRepo(), { rateLimit: { max: 1, windowMs: 60_000 }, now: () => 0, clientIp: () => "9.9.9.9" });
    expect((await app.request("/health", { headers: { "x-forwarded-for": "1.1.1.1" } })).status).toBe(200);
    expect((await app.request("/health", { headers: { "x-forwarded-for": "2.2.2.2" } })).status).toBe(429);
  });

  it("ignores unknown query params in the cache key and bounds the cache", async () => {
    const repo = fakeRepo();
    const app = createApp(repo, { cacheMaxEntries: 2, now: () => 0 });
    for (let i = 0; i < 10; i++) await app.request(`/tokens?junk=${i}`);
    expect(repo.calls).toBe(1);
  });

  it("rate-limits per client", async () => {
    const app = createApp(fakeRepo(), { rateLimit: { max: 2, windowMs: 60_000 }, now: () => 0, trustProxy: true });
    const hdr = { headers: { "x-forwarded-for": "1.2.3.4" } };
    expect((await app.request("/health", hdr)).status).toBe(200);
    expect((await app.request("/health", hdr)).status).toBe(200);
    const limited = await app.request("/health", hdr);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await app.request("/health", { headers: { "x-forwarded-for": "5.6.7.8" } })).status).toBe(200);
  });
});
