import { decodeEventLog, type Address, type Hex } from "viem";
import { curveEventsAbi, erc20TransferAbi, uniswapV3SwapAbi, type RpcLog } from "@nuno/shared";

export type CurveRecord =
  | {
      kind: "create";
      token: Address;
      creator: Address;
      pool: Address;
      name: string;
      symbol: string;
      tokenUri: string;
    }
  | { kind: "trade"; side: "buy" | "sell"; token: Address; trader: Address; amountIn: bigint; amountOut: bigint }
  | { kind: "graduate"; token: Address; pool: Address }
  | { kind: "ignored" };

export interface LogMeta {
  txHash: Hex;
  logIndex: number;
  block: number;
}

export const logMeta = (l: RpcLog): LogMeta => ({
  txHash: l.transactionHash.toLowerCase() as Hex,
  logIndex: Number(l.logIndex),
  block: Number(l.blockNumber),
});

const lc = (a: Address): Address => a.toLowerCase() as Address;

export function decodeCurveLog(l: RpcLog): CurveRecord {
  let ev;
  try {
    ev = decodeEventLog({ abi: curveEventsAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
  } catch {
    return { kind: "ignored" };
  }
  switch (ev.eventName) {
    case "CurveCreate":
      return {
        kind: "create",
        token: lc(ev.args.token),
        creator: lc(ev.args.creator),
        pool: lc(ev.args.pool),
        name: ev.args.name,
        symbol: ev.args.symbol,
        tokenUri: ev.args.tokenURI,
      };
    case "CurveBuy":
    case "CurveSell":
      return {
        kind: "trade",
        side: ev.eventName === "CurveBuy" ? "buy" : "sell",
        token: lc(ev.args.token),
        trader: lc(ev.args.sender),
        amountIn: ev.args.amountIn,
        amountOut: ev.args.amountOut,
      };
    case "CurveGraduate":
      return { kind: "graduate", token: lc(ev.args.token), pool: lc(ev.args.pool) };
    default:
      return { kind: "ignored" };
  }
}

export function decodeTransferLog(l: RpcLog): { token: Address; from: Address; to: Address; value: bigint } | null {
  try {
    const ev = decodeEventLog({ abi: erc20TransferAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    return { token: lc(l.address), from: lc(ev.args.from), to: lc(ev.args.to), value: ev.args.value };
  } catch {
    return null;
  }
}

export function decodeSwapLog(
  l: RpcLog,
): { pool: Address; sender: Address; recipient: Address; amount0: bigint; amount1: bigint } | null {
  try {
    const ev = decodeEventLog({ abi: uniswapV3SwapAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    return {
      pool: lc(l.address),
      sender: lc(ev.args.sender),
      recipient: lc(ev.args.recipient),
      amount0: ev.args.amount0,
      amount1: ev.args.amount1,
    };
  } catch {
    return null;
  }
}
