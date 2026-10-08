/**
 * Who a curve trade belongs to. The curve event's `sender` is the trading wallet for direct and
 * nad.fun-router trades, but a bot contract when a wallet trades through its own or a shared bot
 * contract. In that case the trade is attributed to the transaction signer.
 */
export function effectiveTrader(trader: string, txFrom: string | null, contracts: Set<string>): string {
  return contracts.has(trader) && txFrom && !contracts.has(txFrom) ? txFrom : trader;
}
