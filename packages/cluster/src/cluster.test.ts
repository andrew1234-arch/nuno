import { describe, expect, it } from "vitest";
import { clusterToken } from "./engine.js";
import { UnionFind } from "./unionfind.js";
import { DEFAULT_CLUSTER_CONFIG, type ClusterInput, type FundingEdge } from "./types.js";

// Hand-built test fixtures (not real chain data). Short fake addresses for readability.
const CREATOR = "0xc0";
const TOKEN = "0x70";
const H = 3600;

function input(over: Partial<ClusterInput>): ClusterInput {
  return {
    token: TOKEN,
    creator: CREATOR,
    createBlock: 1000,
    wallets: [],
    contracts: new Set(),
    infrastructure: new Set(),
    funding: [],
    trades: [],
    transfers: [],
    ...over,
  };
}

const fund = (wallet: string, origin: string, blockTime = 0, funder = origin): FundingEdge => ({
  wallet,
  funder,
  origin,
  block: blockTime,
  blockTime,
  txHash: `0xf-${wallet}-${origin}`,
});

const clusterOf = (r: ReturnType<typeof clusterToken>, w: string) => r.clusters.find((c) => c.members.includes(w));

describe("UnionFind", () => {
  it("merges transitively", () => {
    const uf = new UnionFind();
    uf.union("a", "b");
    uf.union("c", "d");
    uf.union("b", "c");
    uf.add("e");
    expect(uf.find("a")).toBe(uf.find("d"));
    expect(uf.find("e")).not.toBe(uf.find("a"));
    expect(uf.groups().size).toBe(2);
  });
});

describe("same_direct_funder", () => {
  it("clusters wallets funded by the same EOA within 24h", () => {
    const r = clusterToken(input({ wallets: ["0xa", "0xb", "0xc"], funding: [fund("0xa", "0xf1", 0), fund("0xb", "0xf1", 10 * H), fund("0xc", "0xf2", 0)] }));
    expect(clusterOf(r, "0xa")?.members).toEqual(["0xa", "0xb"]);
    expect(clusterOf(r, "0xc")).toBeUndefined();
    const ev = clusterOf(r, "0xa")!.links.find((l) => l.type === "same_direct_funder")!;
    expect(ev.evidence[0]).toMatchObject({ txHash: "0xf-0xa-0xf1", detail: "0xf1" });
  });

  it("uses the tx signer (origin), so disperse-contract funding still links", () => {
    const r = clusterToken(input({ wallets: ["0xa", "0xb"], funding: [fund("0xa", "0xf1", 0, "0xd15"), fund("0xb", "0xf1", 5, "0xd15")] }));
    expect(r.clusters).toHaveLength(1);
  });

  it("does not link via same funder when more than 24h apart (common source 0.8 alone is below threshold)", () => {
    const r = clusterToken(input({ wallets: ["0xa", "0xb"], funding: [fund("0xa", "0xf1", 0), fund("0xb", "0xf1", 25 * H)] }));
    expect(r.clusters).toHaveLength(0);
  });

  it("never links through infrastructure funders", () => {
    const r = clusterToken(
      input({ wallets: ["0xa", "0xb"], infrastructure: new Set(["0xcex"]), funding: [fund("0xa", "0xcex", 0), fund("0xb", "0xcex", 1)] }),
    );
    expect(r.clusters).toHaveLength(0);
  });
});

describe("common_funding_source", () => {
  it("weighs 0.8: shared 2-hop source alone does not union", () => {
    const r = clusterToken(
      input({ wallets: ["0xa", "0xb"], funding: [fund("0xa", "0xm1", 0), fund("0xb", "0xm2", 0), fund("0xm1", "0xroot", 0), fund("0xm2", "0xroot", 0)] }),
    );
    expect(r.clusters).toHaveLength(0);
  });

  it("shared source + same-block sell (0.8 + 0.5) unions", () => {
    const r = clusterToken(
      input({
        wallets: ["0xa", "0xb"],
        funding: [fund("0xa", "0xm1", 0), fund("0xb", "0xm2", 0), fund("0xm1", "0xroot", 0), fund("0xm2", "0xroot", 0)],
        trades: [
          { wallet: "0xa", side: "sell", block: 5000, txHash: "0xs1" },
          { wallet: "0xb", side: "sell", block: 5000, txHash: "0xs2" },
        ],
      }),
    );
    expect(r.clusters[0]?.members).toEqual(["0xa", "0xb"]);
    expect(new Set(r.clusters[0]!.links.map((l) => l.type))).toEqual(new Set(["common_funding_source", "same_block_sell"]));
  });

  it("stops at maxFundingHops", () => {
    // a <- m1 <- m2 <- m3 <- root ; b <- root. root is 4 hops from a.
    const funding = [fund("0xa", "0xm1"), fund("0xm1", "0xm2"), fund("0xm2", "0xm3"), fund("0xm3", "0xroot"), fund("0xb", "0xroot")];
    const trades = [
      { wallet: "0xa", side: "sell" as const, block: 5000, txHash: "0xs1" },
      { wallet: "0xb", side: "sell" as const, block: 5000, txHash: "0xs2" },
    ];
    expect(clusterToken(input({ wallets: ["0xa", "0xb"], funding, trades })).clusters).toHaveLength(0);
    const cfg = { ...DEFAULT_CLUSTER_CONFIG, maxFundingHops: 4 };
    expect(clusterToken(input({ wallets: ["0xa", "0xb"], funding, trades }), cfg).clusters).toHaveLength(1);
  });
});

describe("creator_funded", () => {
  it("links wallets funded by the creator within 3 hops to the creator", () => {
    const r = clusterToken(input({ wallets: ["0xa", "0xz"], funding: [fund("0xa", "0xm1"), fund("0xm1", CREATOR)] }));
    const c = clusterOf(r, "0xa")!;
    expect(c.members).toEqual(["0xa", CREATOR].sort());
    expect(c.containsCreator).toBe(true);
    expect(clusterOf(r, "0xz")).toBeUndefined();
  });
});

describe("token_transfer", () => {
  it("links two holders that transferred the token", () => {
    const r = clusterToken(input({ wallets: ["0xa", "0xb"], transfers: [{ from: "0xa", to: "0xb", block: 9, txHash: "0xt" }] }));
    expect(r.clusters[0]?.links[0]?.evidence[0]).toEqual({ type: "token_transfer", txHash: "0xt", block: 9 });
  });

  it("ignores transfers involving contracts (pool, router)", () => {
    const r = clusterToken(
      input({ wallets: ["0xa", "0xpool"], contracts: new Set(["0xpool"]), transfers: [{ from: "0xpool", to: "0xa", block: 9, txHash: "0xt" }] }),
    );
    expect(r.clusters).toHaveLength(0);
  });
});

describe("same_block_early_buy", () => {
  const buys = (block: number) => [
    { wallet: "0xa", side: "buy" as const, block, txHash: "0xb1" },
    { wallet: "0xb", side: "buy" as const, block, txHash: "0xb2" },
  ];

  it("weighs 0.5: same-block early buy alone does not union", () => {
    expect(clusterToken(input({ wallets: ["0xa", "0xb"], trades: buys(1001) })).clusters).toHaveLength(0);
  });

  it("early buy + same-block sell (0.5 + 0.5) unions", () => {
    const trades = [
      ...buys(1001),
      { wallet: "0xa", side: "sell" as const, block: 3000, txHash: "0xs1" },
      { wallet: "0xb", side: "sell" as const, block: 3000, txHash: "0xs2" },
    ];
    expect(clusterToken(input({ wallets: ["0xa", "0xb"], trades })).clusters).toHaveLength(1);
  });

  it("does not count buys after the early window", () => {
    const trades = [
      ...buys(1000 + DEFAULT_CLUSTER_CONFIG.earlyBuyBlocks + 1),
      { wallet: "0xa", side: "sell" as const, block: 3000, txHash: "0xs1" },
      { wallet: "0xb", side: "sell" as const, block: 3000, txHash: "0xs2" },
    ];
    expect(clusterToken(input({ wallets: ["0xa", "0xb"], trades })).clusters).toHaveLength(0);
  });
});

describe("engine invariants", () => {
  it("never makes contracts cluster members", () => {
    const r = clusterToken(
      input({ wallets: ["0xa", "0xk"], contracts: new Set(["0xk"]), funding: [fund("0xa", "0xf1"), fund("0xk", "0xf1")] }),
    );
    expect(r.clusters).toHaveLength(0);
    expect(r.entityOf.has("0xk")).toBe(false);
  });

  it("maps every non-contract wallet to an entity and is deterministic", () => {
    const inp = input({ wallets: ["0xb", "0xa", "0xc"], funding: [fund("0xa", "0xf1"), fund("0xb", "0xf1")] });
    const r1 = clusterToken(inp);
    const r2 = clusterToken(inp);
    expect(r1.entityOf.get("0xa")).toBe("0xa");
    expect(r1.entityOf.get("0xb")).toBe("0xa");
    expect(r1.entityOf.get("0xc")).toBe("0xc");
    expect(r1.clusters).toEqual(r2.clusters);
  });

  it("chains large same-funder groups into one cluster", () => {
    const wallets = Array.from({ length: 150 }, (_, i) => `0xw${i.toString().padStart(3, "0")}`);
    const r = clusterToken(input({ wallets, funding: wallets.map((w, i) => fund(w, "0xbot", i)) }));
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.members).toHaveLength(150);
  });
});
