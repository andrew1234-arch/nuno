import { writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { RpcClient, config, createDb, schema, toHex } from "@nuno/shared";
import { isExchangeLike, loadInfrastructure, INFRA_MIN_BALANCE_MON, INFRA_MIN_NONCE, type InfraEntry } from "./infrastructure.js";

// Profiles every funding origin on-chain and writes exchange-like ones to infrastructure.json.
// Manual entries are kept. usage: tsx src/infra-scan.ts
async function main() {
  const { db, sql } = createDb();
  const rpc = new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6 });
  const block = Number(await rpc.call<Hex>("eth_blockNumber", []));
  const origins = [...new Set((await db.select({ o: schema.fundingEdges.origin }).from(schema.fundingEdges)).map((r) => r.o))];

  const flagged: InfraEntry[] = [];
  await Promise.all(
    origins.map(async (a) => {
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
    }),
  );

  const manual = loadInfrastructure().filter((e) => e.source === "manual");
  const manualSet = new Set(manual.map((e) => e.address.toLowerCase()));
  const all = [...manual, ...flagged.filter((e) => !manualSet.has(e.address))].sort((x, y) => x.address.localeCompare(y.address));
  writeFileSync(new URL("./infrastructure.json", import.meta.url), JSON.stringify(all, null, 2) + "\n");
  console.log(`[infra] scanned ${origins.length} funding origins at block ${block}: ${flagged.length} exchange-like, ${manual.length} manual`);
  for (const e of all) console.log(`  ${e.address} ${e.reason}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
