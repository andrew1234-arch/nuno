import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { nunoFeedAbi, nunoFeedBytecode, organicGateAbi, organicGateBytecode } from "@nuno/shared";
import { toSnapshot } from "./snapshot.js";

// Integration test against a local anvil chain (Foundry). Skipped when anvil is not installed.
const ANVIL = [join(homedir(), ".foundry/bin/anvil"), "anvil"].find((bin) => spawnSync(bin, ["--version"]).status === 0);
const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's well-known default account #0 (public test key, holds no real funds).
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

describe.skipIf(!ANVIL)("NunoFeed on anvil", () => {
  let anvil: ChildProcess;
  const chain = defineChain({
    id: 31337,
    name: "anvil",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const account = privateKeyToAccount(PK);
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ chain, account, transport: http(RPC) });

  beforeAll(async () => {
    anvil = spawn(ANVIL!, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        await pub.getBlockNumber();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("anvil did not start");
  });

  afterAll(() => {
    anvil?.kill();
  });

  it("publishes a snapshot built by toSnapshot and OrganicGate reads it", async () => {
    const deployHash = await wallet.deployContract({ abi: nunoFeedAbi, bytecode: nunoFeedBytecode, args: [account.address] });
    const feed = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress as Address;
    const gateHash = await wallet.deployContract({ abi: organicGateAbi, bytecode: organicGateBytecode, args: [feed] });
    const gate = (await pub.waitForTransactionReceipt({ hash: gateHash })).contractAddress as Address;

    const token = "0x00000000000000000000000000000000000000aa" as Address;
    const snap = toSnapshot({
      token,
      sourceBlock: 111_700_000,
      rawHolders: 120,
      realHolders: 40,
      effectiveTop10Bps: 6500,
      clusterSupplyBps: 4200,
      creatorLinkedSupplyBps: 1200,
      organicVolumeBps: 3100,
      evidenceRoot: `0x${"ab".repeat(32)}`,
    });
    const hash = await wallet.writeContract({ address: feed, abi: nunoFeedAbi, functionName: "publish", args: [token, snap] });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const onChain = await pub.readContract({ address: feed, abi: nunoFeedAbi, functionName: "latest", args: [token] });
    expect(onChain).toMatchObject({ ...snap, publishedAt: expect.any(BigInt) });
    expect(onChain.publishedAt).toBeGreaterThan(0n);

    expect(await pub.readContract({ address: gate, abi: organicGateAbi, functionName: "isOrganic", args: [token, 5000, 3600n] })).toBe(true);
    expect(await pub.readContract({ address: gate, abi: organicGateAbi, functionName: "isOrganic", args: [token, 3000, 3600n] })).toBe(false);
  });
});
