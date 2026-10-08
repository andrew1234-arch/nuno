import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, nunoFeedAbi, schema, type Db } from "@nuno/shared";
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
  /** Set when this token's publish failed; other tokens are still attempted. */
  error?: string;
}

export interface PublisherEnv {
  rpcUrl: string;
  chainId: number;
  feed: Address;
  privateKey: Hex;
}

const DEPLOYMENTS = resolve(import.meta.dirname, "../../../deployments/monad-testnet.json");

/**
 * Publisher settings from env (single source for the CLI and the worker). Returns null, with the
 * reason, when publishing is not configured.
 */
export function publisherFromEnv(): { env: PublisherEnv } | { env: null; reason: string } {
  const privateKey = process.env.PUBLISHER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) return { env: null, reason: "PUBLISHER_PRIVATE_KEY is not set" };
  let feed = process.env.NUNO_FEED_ADDRESS as Address | undefined;
  if (!feed && existsSync(DEPLOYMENTS)) feed = (JSON.parse(readFileSync(DEPLOYMENTS, "utf8")) as { NunoFeed: Address }).NunoFeed;
  if (!feed) return { env: null, reason: "no NUNO_FEED_ADDRESS and no deployments/monad-testnet.json (run pnpm deploy:contracts)" };
  return { env: { rpcUrl: config.testnetRpcUrl, chainId: config.publishChainId, feed, privateKey } };
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
    try {
      results.push(await publishOne(ctx, row, now, { account, publicClient, walletClient }));
    } catch (err) {
      const error = (err as Error).message.split("\n")[0]!.slice(0, 300);
      ctx.log?.(`[publisher] ${row.token} FAILED: ${error}`);
      results.push({ token: row.token, reason: "error", error });
    }
  }
  return results;
}

type Clients = ReturnType<typeof clients>;

async function publishOne(
  ctx: PublisherCtx,
  row: typeof schema.tokenMetrics.$inferSelect,
  now: number,
  { account, publicClient, walletClient }: Clients,
): Promise<PublishResult> {
  {
    const next = toSnapshot(row);
    const prev = (await publicClient.readContract({
      address: ctx.feed,
      abi: nunoFeedAbi,
      functionName: "latest",
      args: [row.token as Address],
    })) as FeedSnapshot;
    const decision = shouldPublish(prev, next, now, ctx.policy ?? DEFAULT_PUBLISH_POLICY);
    if (!decision.publish) return { token: row.token, reason: decision.reason };

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
    return { token: row.token, txHash, reason: decision.reason };
  }
}
