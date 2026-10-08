import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { nunoFeedAbi, schema, type Db } from "@nuno/shared";
import { shouldPublish, toSnapshot, type FeedSnapshot, type PublishPolicy, DEFAULT_PUBLISH_POLICY } from "./snapshot.js";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

export interface PublisherCtx {
  db: Db;
  rpcUrl: string;
  chainId: number;
  feed: Address;
  privateKey: Hex;
  policy?: PublishPolicy;
  log?: (msg: string) => void;
}

export interface PublishResult {
  token: string;
  txHash?: Hex;
  reason: string;
}

function clients(ctx: Pick<PublisherCtx, "rpcUrl" | "chainId" | "privateKey">) {
  const chain = defineChain({ ...monadTestnet, id: ctx.chainId, rpcUrls: { default: { http: [ctx.rpcUrl] } } });
  const account = privateKeyToAccount(ctx.privateKey);
  return {
    account,
    publicClient: createPublicClient({ chain, transport: http(ctx.rpcUrl) }),
    walletClient: createWalletClient({ chain, account, transport: http(ctx.rpcUrl) }),
  };
}

/** Publish every token whose stored metrics differ meaningfully from its on-chain snapshot. */
export async function publishAll(ctx: PublisherCtx): Promise<PublishResult[]> {
  const { account, publicClient, walletClient } = clients(ctx);
  const rows = await ctx.db.select().from(schema.tokenMetrics);
  const now = Math.floor(Date.now() / 1000);
  const results: PublishResult[] = [];

  for (const row of rows) {
    const next = toSnapshot(row);
    const prev = (await publicClient.readContract({
      address: ctx.feed,
      abi: nunoFeedAbi,
      functionName: "latest",
      args: [row.token as Address],
    })) as FeedSnapshot;
    const decision = shouldPublish(prev, next, now, ctx.policy ?? DEFAULT_PUBLISH_POLICY);
    if (!decision.publish) {
      results.push({ token: row.token, reason: decision.reason });
      continue;
    }

    const { request } = await publicClient.simulateContract({
      account,
      address: ctx.feed,
      abi: nunoFeedAbi,
      functionName: "publish",
      args: [row.token as Address, next],
    });
    const txHash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`publish reverted for ${row.token}: ${txHash}`);

    await ctx.db
      .insert(schema.snapshots)
      .values({
        txHash,
        chainId: ctx.chainId,
        feed: ctx.feed.toLowerCase(),
        token: row.token,
        sourceBlock: row.sourceBlock,
        publishBlock: Number(receipt.blockNumber),
        evidenceRoot: row.evidenceRoot,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      })
      .onConflictDoNothing();
    ctx.log?.(`[publisher] ${row.token} ${decision.reason}: ${txHash} (gas ${receipt.gasUsed})`);
    results.push({ token: row.token, txHash, reason: decision.reason });
  }
  return results;
}
