import type { Address, Hex } from "viem";
import type { RpcClient } from "./rpc.js";

/** Monad mainnet nad.fun addresses, from https://nad.fun/skill.md (fetched 2026-10-08). */
export const NADFUN_MAINNET = {
  chainId: 143,
  DEX_ROUTER: "0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137",
  BONDING_CURVE_ROUTER: "0x6F6B8F1a20703309951a5127c45B49b1CD981A22",
  LENS: "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea",
  CURVE: "0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE",
  WMON: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
  V3_FACTORY: "0x6B5F564339DbAD6b780249827f2198a841FEB7F3",
  CREATOR_TREASURY: "0x42e75B4B96d7000E7Da1e0c729Cec8d2049B9731",
} as const satisfies Record<string, Address | number>;

/** Measured on mainnet 2026-10-08: 100k blocks took 30,206 s. */
export const MONAD_SECONDS_PER_BLOCK = 0.302;

export interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}

export interface RpcBlock {
  number: Hex;
  timestamp: Hex;
  transactions: Array<{ hash: Hex; from: Address; to: Address | null; value: Hex }>;
}

/** callTracer frame as returned by debug_trace* on Monad RPCs. */
export interface CallFrame {
  type: string;
  from: Address;
  to?: Address;
  value?: Hex;
  calls?: CallFrame[];
  error?: string;
}

export interface BlockTraceEntry {
  txHash: Hex;
  result: CallFrame;
}

export const hexToBigInt = (h: Hex): bigint => BigInt(h);
export const toHex = (n: number | bigint): Hex => `0x${n.toString(16)}`;

export async function getBlockNumber(rpc: RpcClient): Promise<number> {
  return Number(await rpc.call<Hex>("eth_blockNumber", []));
}

export async function getBlockTimestamp(rpc: RpcClient, block: number): Promise<number> {
  const b = await rpc.call<RpcBlock | null>("eth_getBlockByNumber", [toHex(block), false], { cache: true });
  if (!b) throw new Error(`block ${block} not found`);
  return Number(b.timestamp);
}

/** Approximate block at a timestamp, refined with a few lookups. Good to within a few blocks. */
export async function blockAtTimestamp(rpc: RpcClient, ts: number, head: number): Promise<number> {
  const headTs = await getBlockTimestamp(rpc, head);
  let guess = Math.max(0, head - Math.round((headTs - ts) / MONAD_SECONDS_PER_BLOCK));
  for (let i = 0; i < 4; i++) {
    const gTs = await getBlockTimestamp(rpc, guess);
    const delta = Math.round((ts - gTs) / MONAD_SECONDS_PER_BLOCK);
    if (Math.abs(delta) < 5) break;
    guess = Math.min(head, Math.max(0, guess + delta));
  }
  return guess;
}
