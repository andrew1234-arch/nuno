import type { Address, Hex } from "viem";
import type { BlockTraceEntry, CallFrame, RpcBlock } from "@nuno/shared";

export interface InboundTransfer {
  txHash: Hex;
  /** Address whose frame sent the value (EOA for a plain send, contract for disperse/internal sends). */
  funder: Address;
  /** Signer of the transaction (tx.from). */
  origin: Address;
  value: bigint;
  kind: "native_direct" | "native_internal";
}

const VALUE_FRAME_TYPES = new Set(["CALL", "CREATE", "CREATE2", "SELFDESTRUCT"]);

/**
 * Find every successful native-value frame that credits `wallet` in a block's callTracer output.
 * Frames under a reverted frame are ignored (their value moves are rolled back).
 */
export function extractInboundTransfers(traces: BlockTraceEntry[], wallet: Address): InboundTransfer[] {
  const target = wallet.toLowerCase();
  const out: InboundTransfer[] = [];
  for (const { txHash, result } of traces) {
    const origin = result.from.toLowerCase() as Address;
    const walk = (f: CallFrame, depth: number) => {
      if (f.error) return;
      const value = f.value ? BigInt(f.value) : 0n;
      if (value > 0n && f.to?.toLowerCase() === target && VALUE_FRAME_TYPES.has(f.type.toUpperCase())) {
        out.push({
          txHash: txHash.toLowerCase() as Hex,
          funder: f.from.toLowerCase() as Address,
          origin,
          value,
          kind: depth === 0 ? "native_direct" : "native_internal",
        });
      }
      for (const c of f.calls ?? []) walk(c, depth + 1);
    };
    walk(result, 0);
  }
  return out;
}

/** Cheap pre-check: top-level value transfers to `wallet` visible in the block body. */
export function directTransfersFromBlock(block: RpcBlock, wallet: Address): InboundTransfer[] {
  const target = wallet.toLowerCase();
  return block.transactions
    .filter((tx) => tx.to?.toLowerCase() === target && BigInt(tx.value) > 0n)
    .map((tx) => ({
      txHash: tx.hash.toLowerCase() as Hex,
      funder: tx.from.toLowerCase() as Address,
      origin: tx.from.toLowerCase() as Address,
      value: BigInt(tx.value),
      kind: "native_direct" as const,
    }));
}
