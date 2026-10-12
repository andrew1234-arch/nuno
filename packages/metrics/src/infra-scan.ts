import { readFileSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { AddressBook, RpcClient, sqliteSchema as s, toHex } from "@nuno/shared";
import { config, openLocal } from "@nuno/shared/node";
import { isExchangeLike, INFRA_MIN_BALANCE_MON, INFRA_MIN_NONCE, type InfraEntry } from "./infrastructure.js";

// Profiles every funding origin on-chain and writes exchange-like ones to infrastructure.json.
// Manual entries are kept. usage: tsx src/infra-scan.ts
async function main() {
  const { db, close } = openLocal(config.localDbPath);
  // Only the latest state is read, which every public endpoint serves: INFRA_RPC_URLS spreads the
  // ~2 calls per origin over several rate-limit buckets (comma-separated; defaults to the main RPC).
  const urls = (process.env.INFRA_RPC_URLS ?? config.mainnetRpcUrl).split(",").map((u) => u.trim()).filter(Boolean);
  const rpc = new RpcClient({ url: urls, maxConcurrency: Number(process.env.INFRA_RPC_CONCURRENCY || 6) });
  const block = Number(await rpc.call<Hex>("eth_blockNumber", []));
  const originIds = [...new Set((await db.select({ o: s.fundingEdges.origin }).from(s.fundingEdges)).map((r) => r.o))];
  const origins = [...(await new AddressBook(db).hexes(originIds)).values()].map((h) => h.toLowerCase());

  const flagged: InfraEntry[] = [];
  let done = 0;
  const check = async (a: string) => {
    const [nonceHex, balHex] = await Promise.all([
      rpc.call<Hex>("eth_getTransactionCount", [a as Address, toHex(block)]),
      rpc.call<Hex>("eth_getBalance", [a as Address, toHex(block)]),
    ]);
    const nonce = Number(nonceHex);
    const balanceMon = Math.round(Number(BigInt(balHex) / 10n ** 18n));
    if (isExchangeLike(nonce, balanceMon)) {
      const why = [nonce >= INFRA_MIN_NONCE ? `${nonce.toLocaleString("en-US")} txs sent` : "", balanceMon >= INFRA_MIN_BALANCE_MON ? `${balanceMon.toLocaleString("en-US")} MON balance` : ""]
        .filter(Boolean)
        .join(", ");
      flagged.push({ address: a, source: "heuristic", reason: `exchange-like: ${why}`, nonce, balanceMon, checkedBlock: block });
    }
  };
  // One failed origin must not lose the whole scan: collect failures and retry them once.
  let failed: string[] = [];
  const pass = async (list: string[]) => {
    const out: string[] = [];
    await Promise.all(
      list.map(async (a) => {
        try {
          await check(a);
        } catch {
          out.push(a);
        }
        if (++done % 250 === 0) console.log(`[infra] ${done} checks done (${origins.length} origins)`);
      }),
    );
    return out;
  };
  failed = await pass(origins);
  if (failed.length) {
    console.log(`[infra] retrying ${failed.length} origins that failed`);
    failed = await pass(failed);
  }

  const current = JSON.parse(readFileSync(new URL("./infrastructure.json", import.meta.url), "utf8")) as InfraEntry[];
  const manual = current.filter((e) => e.source === "manual");
  const manualSet = new Set(manual.map((e) => e.address.toLowerCase()));
  // Entries are only replaced by a fresh check: origins that failed, and earlier entries that are not funding
  // origins in this DB (e.g. outside the current window), keep their previous evidence.
  const failedSet = new Set(failed);
  const scanned = new Set(origins.filter((a) => !failedSet.has(a)));
  const kept = current.filter((e) => e.source !== "manual" && !scanned.has(e.address.toLowerCase()));
  const all = [...manual, ...kept, ...flagged.filter((e) => !manualSet.has(e.address))].sort((x, y) => x.address.localeCompare(y.address));
  if (failed.length) console.log(`[infra] ${failed.length} origins unchecked after retry (previous entries kept): ${failed.slice(0, 10).join(", ")}${failed.length > 10 ? ", …" : ""}`);
  writeFileSync(new URL("./infrastructure.json", import.meta.url), JSON.stringify(all, null, 2) + "\n");
  console.log(`[infra] scanned ${origins.length} funding origins at block ${block}: ${flagged.length} exchange-like, ${manual.length} manual`);
  for (const e of all) console.log(`  ${e.address} ${e.reason}`);
  close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
