import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bytesToHex, hexToBytes } from "viem";
import { AddressBook, nunoFeedAbi, sqliteSchema as s, type SqlDb } from "@nuno/shared";
import { shouldPublish, toSnapshot, type FeedSnapshot, type PublishPolicy, DEFAULT_PUBLISH_POLICY } from "./snapshot.js";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

export interface PublisherCtx {
  db: SqlDb;
  book: AddressBook;
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
  const cl = clients(ctx);
  const rows = await ctx.db.select().from(s.tokenMetrics);
  const hex = await ctx.book.hexes(rows.map((r) => r.token));
  const now = Math.floor(Date.now() / 1000);
  const results: PublishResult[] = [];
  for (const row of rows) {
    const token = hex.get(row.token)!;
    try {
      results.push(await publishOne(ctx, token, row, now, cl));
    } catch (err) {
      const error = (err as Error).message.split("\n")[0]!.slice(0, 300);
      ctx.log?.(`[publisher] ${token} FAILED: ${error}`);
      results.push({ token, reason: "error", error });
    }
  }
  return results;
}

type Clients = ReturnType<typeof clients>;

async function publishOne(
  ctx: PublisherCtx,
  token: Address,
  row: typeof s.tokenMetrics.$inferSelect,
  now: number,
  { account, publicClient, walletClient }: Clients,
): Promise<PublishResult> {
  const next = toSnapshot({ ...row, token, evidenceRoot: bytesToHex(row.evidenceRoot) });
  const prev = (await publicClient.readContract({ address: ctx.feed, abi: nunoFeedAbi, functionName: "latest", args: [token] })) as FeedSnapshot;
  const decision = shouldPublish(prev, next, now, ctx.policy ?? DEFAULT_PUBLISH_POLICY);
  if (!decision.publish) return { token, reason: decision.reason };

  const { request } = await publicClient.simulateContract({ account, address: ctx.feed, abi: nunoFeedAbi, functionName: "publish", args: [token, next] });
  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`publish reverted for ${token}: ${txHash}`);

  await ctx.db
    .insert(s.snapshots)
    .values({
      tx: hexToBytes(txHash),
      chainId: ctx.chainId,
      token: row.token,
      sourceBlock: row.sourceBlock,
      publishBlock: Number(receipt.blockNumber),
      evidenceRoot: row.evidenceRoot,
      gasUsed: Number(receipt.gasUsed),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      publishedAt: Date.now(),
    })
    .onConflictDoNothing();
  ctx.log?.(`[publisher] ${token} ${decision.reason}: ${txHash} (gas ${receipt.gasUsed})`);
  return { token, txHash, reason: decision.reason };
}
