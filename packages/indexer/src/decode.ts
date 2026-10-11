import { decodeAbiParameters, decodeEventLog, type Address, type Hex } from "viem";
import { TOPICS, curveEventsAbi, curveV2CreateDataTypes, curveV2EventsAbi, erc20TransferAbi, uniswapV2SwapAbi, uniswapV3SwapAbi, type RpcLog } from "@nuno/shared";

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

const topicAddress = (t: Hex | undefined): Address | null => (t && t.length === 66 ? (`0x${t.slice(26)}` as Address) : null);

/** nad.fun V2 curve: create (layout-decoded, no public signature), buy, sell, graduate. */
function decodeCurveV2Log(l: RpcLog): CurveRecord {
  const t0 = l.topics[0]?.toLowerCase();
  if (t0 === TOPICS.V2Create) {
    const [creator, token, pool] = [topicAddress(l.topics[1]), topicAddress(l.topics[2]), topicAddress(l.topics[3])];
    if (!creator || !token || !pool) return { kind: "ignored" };
    try {
      const [, name, symbol, tokenUri] = decodeAbiParameters(curveV2CreateDataTypes, l.data);
      return { kind: "create", token: lc(token), creator: lc(creator), pool: lc(pool), name, symbol, tokenUri };
    } catch {
      return { kind: "ignored" };
    }
  }
  try {
    const ev = decodeEventLog({ abi: curveV2EventsAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    if (ev.eventName === "Graduate") return { kind: "graduate", token: lc(ev.args.token), pool: lc(ev.args.pool) };
    return {
      kind: "trade",
      side: ev.eventName === "Buy" ? "buy" : "sell",
      token: lc(ev.args.token),
      trader: lc(ev.args.sender),
      amountIn: ev.args.amountIn,
      amountOut: ev.args.amountOut,
    };
  } catch {
    return { kind: "ignored" };
  }
}

export function decodeCurveLog(l: RpcLog): CurveRecord {
  const t0 = l.topics[0]?.toLowerCase();
  if (t0 === TOPICS.V2Create || t0 === TOPICS.V2Buy || t0 === TOPICS.V2Sell || t0 === TOPICS.V2Graduate) return decodeCurveV2Log(l);
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

/**
 * Swap on a graduated pool, normalized to signed pool deltas (positive = pool received), the Uniswap
 * V3 convention. V1 tokens graduate to Uniswap V3 pools; V2-curve tokens to Uniswap V2-style pairs,
 * whose Swap reports in/out amounts: amount0 = amount0In − amount0Out.
 */
export function decodeSwapLog(
  l: RpcLog,
): { pool: Address; sender: Address; recipient: Address; amount0: bigint; amount1: bigint } | null {
  const topics = l.topics as [Hex, ...Hex[]];
  try {
    const ev = decodeEventLog({ abi: uniswapV3SwapAbi, data: l.data, topics });
    return { pool: lc(l.address), sender: lc(ev.args.sender), recipient: lc(ev.args.recipient), amount0: ev.args.amount0, amount1: ev.args.amount1 };
  } catch {
    // not a V3 swap
  }
  try {
    const ev = decodeEventLog({ abi: uniswapV2SwapAbi, data: l.data, topics });
    return {
      pool: lc(l.address),
      sender: lc(ev.args.sender),
      recipient: lc(ev.args.to),
      amount0: ev.args.amount0In - ev.args.amount0Out,
      amount1: ev.args.amount1In - ev.args.amount1Out,
    };
  } catch {
    return null;
  }
}
