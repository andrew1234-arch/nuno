import { describe, expect, it, vi } from "vitest";
import { AddressBook, sqliteSchema as s } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { Nansen, isInfraLabel } from "./nansen.js";

// Hand-built test fixtures (not real Nansen data); the request/response shapes follow docs.nansen.ai.
const W = "0x00000000000000000000000000000000000000e1";
const HUB = "0x00000000000000000000000000000000000000f1";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));
}
const ok = (remaining: number) =>
  respond(200, { pagination: { page: 1, per_page: 100, is_last_page: true }, data: [{ address: HUB, address_label: "Binance: Hot Wallet", relation: "First Funder", transaction_hash: "0xabc", block_timestamp: "2026-01-01", order: 1, chain: "monad" }] }, { "x-nansen-credits-used": "1", "x-nansen-credits-remaining": String(remaining) });

describe("Nansen client (free plan)", () => {
  it("sends the documented request and parses rows, credits and cache", async () => {
    const { db, close } = openLocal(":memory:");
    const fetchImpl = vi.fn(() => ok(42));
    const n = new Nansen(db, new AddressBook(db), { apiKey: "k", fetchImpl });
    const rows = await n.relatedWallets(W);
    expect(rows).toEqual([{ address: HUB, label: "Binance: Hot Wallet", relation: "First Funder", tx: "0xabc" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.nansen.ai/api/v1/profiler/address/related-wallets");
    expect((init.headers as Record<string, string>).apikey).toBe("k");
    expect(JSON.parse(init.body as string)).toEqual({ wallet_address: W, chain: "monad", pagination: { page: 1, per_page: 100 } });
    expect(n.spent).toBe(1);
    expect(n.remaining).toBe(42);
    // Cached permanently: a second lookup costs nothing and makes no request.
    expect(await n.relatedWallets(W)).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await db.select().from(s.nansenCache)).length).toBe(1);
    close();
  });

  it("stops at the credit reserve and at the per-run cap", async () => {
    const { db, close } = openLocal(":memory:");
    const fetchImpl = vi.fn(() => ok(3));
    const n = new Nansen(db, new AddressBook(db), { apiKey: "k", fetchImpl, reserve: 3 });
    await n.relatedWallets(W); // remaining now 3
    expect(await n.relatedWallets(HUB)).toBeNull();
    expect(n.disabled).toMatch(/reserve/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const m = new Nansen(db, new AddressBook(db), { apiKey: "k", fetchImpl: vi.fn(() => ok(50)), maxCalls: 1 });
    await m.relatedWallets("0x00000000000000000000000000000000000000a1");
    expect(await m.relatedWallets("0x00000000000000000000000000000000000000a2")).toBeNull();
    expect(m.disabled).toMatch(/cap/);
    close();
  });

  it("runs without a key (pipeline falls back to the manual list) and stops on 403", async () => {
    const { db, close } = openLocal(":memory:");
    const none = new Nansen(db, new AddressBook(db), {});
    expect(await none.relatedWallets(W)).toBeNull();
    expect(none.disabled).toMatch(/no NANSEN_API_KEY/);

    const fetchImpl = vi.fn(() => respond(403, { code: "insufficient_credits" }, { "x-nansen-credits-used": "0", "x-nansen-credits-remaining": "0" }));
    const n = new Nansen(db, new AddressBook(db), { apiKey: "k", fetchImpl });
    expect(await n.relatedWallets(W)).toBeNull();
    expect(n.disabled).toMatch(/403/);
    expect(n.spent).toBe(0);
    close();
  });

  it("classifies infrastructure labels", () => {
    expect(isInfraLabel("Binance: Hot Wallet 20")).toBe(true);
    expect(isInfraLabel("Wormhole Bridge")).toBe(true);
    expect(isInfraLabel("Smart Trader")).toBe(false);
    expect(isInfraLabel(null)).toBe(false);
  });
});
