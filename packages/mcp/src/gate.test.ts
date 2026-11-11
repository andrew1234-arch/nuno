import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, counterpartyVerdict, dataAgeSeconds, tokenVerdict, type EntityFile, type MetaFile, type TokenFile } from "./gate.js";
import { createSource, normalizeAddress } from "./source.js";

const now = new Date("2026-11-11T12:00:00Z");
const fresh: MetaFile = { generatedAt: "2026-11-11T11:55:00Z", sourceTime: "2026-11-11T11:50:00Z" };
const token = (m: Partial<NonNullable<TokenFile["metrics"]>> = {}): TokenFile => ({
  address: "0x" + "a".repeat(40),
  metrics: { rawHolders: 120, realHolders: 40, clusterSupplyBps: 500, creatorLinkedSupplyBps: 200, organicVolumeBps: 6000, evidenceRoot: "0xroot", ...m },
  clusters: [{ id: "0x1", size: 3, links: [{ type: "same_direct_funder", evidence: [{ txHash: "0xaa" }, { txHash: "0xaa" }, { txHash: "0xbb" }] }] }],
});

describe("tokenVerdict", () => {
  it("allows a token inside every limit and returns the evidence root", () => {
    const v = tokenVerdict(token(), fresh, now);
    expect(v).toMatchObject({ allow: true, reasons: [], evidenceRoot: "0xroot" });
    expect(v.evidenceTxs).toEqual(["0xaa", "0xbb"]);
  });

  it("denies with every failed limit listed", () => {
    const v = tokenVerdict(token({ clusterSupplyBps: 6200, creatorLinkedSupplyBps: 4100, realHolders: 2 }), fresh, now);
    expect(v.allow).toBe(false);
    expect(v.reasons.map((r) => r.code)).toEqual(["too_clustered", "creator_linked", "few_real_holders"]);
  });

  it("treats the limit itself as allowed", () => {
    expect(tokenVerdict(token({ clusterSupplyBps: DEFAULT_POLICY.maxClusterSupplyBps }), fresh, now).allow).toBe(true);
  });

  it("denies stale data, measured from the last indexed block rather than the export time", () => {
    const meta: MetaFile = { generatedAt: "2026-11-11T11:59:00Z", sourceTime: "2026-11-11T09:00:00Z" };
    expect(dataAgeSeconds(meta, now)).toBe(3 * 3600);
    expect(tokenVerdict(token(), meta, now).reasons).toEqual([{ code: "stale", ageSeconds: 10_800, maxAgeSeconds: 3600 }]);
  });

  it("denies when the token, its metrics or the meta file are missing", () => {
    expect(tokenVerdict(null, fresh, now).reasons[0]?.code).toBe("no_data");
    expect(tokenVerdict(token(), null, now).allow).toBe(false);
    expect(tokenVerdict({ ...token(), metrics: null }, fresh, now).allow).toBe(false);
    expect(tokenVerdict({ ...token(), pruned: true }, fresh, now).allow).toBe(false);
    expect(tokenVerdict(token(), { generatedAt: "not a date" }, now).allow).toBe(false);
  });
});

describe("counterpartyVerdict", () => {
  const entity: EntityFile = { id: "0x1", size: 10, createdTokens: ["0xt1", "0xt2"], links: [{ type: "same_direct_funder", evidence: [{ txHash: "0xcc" }] }] };

  it("flags a wallet in a multi-wallet entity with its evidence", () => {
    const v = counterpartyVerdict({ address: "0xw", entityId: "0x1" }, entity);
    expect(v).toMatchObject({ allow: false, known: true, evidenceTxs: ["0xcc"] });
    expect(v.reasons).toEqual([{ code: "multi_wallet_entity", entityId: "0x1", wallets: 10, tokensLaunched: 2 }]);
  });

  it("reports an unseen wallet as allowed but not known", () => {
    expect(counterpartyVerdict(null, null)).toMatchObject({ allow: true, known: false });
    expect(counterpartyVerdict({ address: "0xw", entityId: null }, null)).toMatchObject({ allow: true, known: false });
  });
});

describe("source", () => {
  it("rejects anything that is not a plain address", () => {
    expect(normalizeAddress(" 0x" + "AB".repeat(20) + " ")).toBe("0x" + "ab".repeat(20));
    expect(() => normalizeAddress("../../etc/passwd")).toThrow();
    expect(() => normalizeAddress("0x123")).toThrow();
  });

  it("reads a local export directory and returns null for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nuno-mcp-"));
    await mkdir(join(dir, "tokens"));
    await writeFile(join(dir, "tokens", "x.json"), JSON.stringify({ address: "x" }));
    const src = createSource(dir);
    expect(await src.get("tokens/x.json")).toEqual({ address: "x" });
    expect(await src.get("tokens/missing.json")).toBeNull();
  });

  it("maps 404 to null and other HTTP errors to a throw", async () => {
    const stub = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    expect(await createSource("https://example.test/api", stub(404)).get("a.json")).toBeNull();
    await expect(createSource("https://example.test/api", stub(500)).get("a.json")).rejects.toThrow("500");
  });
});
