/**
 * Who a curve trade belongs to. The curve event's `sender` is the trading wallet for direct and
 * nad.fun-router trades, but a bot contract when a wallet trades through its own or a shared bot
 * contract. In that case the trade is attributed to the transaction signer.
 */
export function effectiveTrader(trader: string, txFrom: string | null, contracts: Set<string>): string {
  return contracts.has(trader) && txFrom && !contracts.has(txFrom) ? txFrom : trader;
}

export interface SwapLike {
  /** Signed pool deltas (positive = pool received), as in the Uniswap V3 Swap event. */
  amount0: bigint;
  amount1: bigint;
}

/**
 * A Uniswap V3 swap on a token/WMON pool as a buy or sell of the token with its MON leg.
 * Uniswap orders the pair by address (token0 < token1), so no RPC call is needed.
 * Returns null for swaps that move no token (should not occur) or no MON.
 */
export function swapAsTrade(swap: SwapLike, token: string, wmon: string): { side: "buy" | "sell"; mon: bigint; tokens: bigint } | null {
  const tokenIs0 = token.toLowerCase() < wmon.toLowerCase();
  const tokenDelta = tokenIs0 ? swap.amount0 : swap.amount1;
  const monDelta = tokenIs0 ? swap.amount1 : swap.amount0;
  if (tokenDelta === 0n || monDelta === 0n) return null;
  // Pool sent tokens (negative) and received MON: the trader bought.
  if (tokenDelta < 0n) return { side: "buy", mon: monDelta > 0n ? monDelta : -monDelta, tokens: -tokenDelta };
  return { side: "sell", mon: monDelta < 0n ? -monDelta : monDelta, tokens: tokenDelta };
}
