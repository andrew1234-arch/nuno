const MAINNET_EXPLORER = process.env.NEXT_PUBLIC_MAINNET_EXPLORER ?? "https://monadscan.com";
const TESTNET_EXPLORER = process.env.NEXT_PUBLIC_TESTNET_EXPLORER ?? "https://testnet.monadscan.com";

export const explorer = (chainId = 143) => (chainId === 10143 ? TESTNET_EXPLORER : MAINNET_EXPLORER);
export const txUrl = (hash: string, chainId = 143) => `${explorer(chainId)}/tx/${hash}`;
export const addrUrl = (addr: string, chainId = 143) => `${explorer(chainId)}/address/${addr}`;

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** wei-style decimal string -> MON with up to 2 decimals. */
export function mon(wei: string): string {
  const v = BigInt(wei);
  const whole = v / 10n ** 18n;
  const frac = Number((v % 10n ** 18n) / 10n ** 16n);
  return `${whole.toLocaleString("en-US")}${frac ? "." + String(frac).padStart(2, "0") : ""}`;
}

export const EDGE_LABELS: Record<string, string> = {
  same_direct_funder: "Same funder ≤24h",
  common_funding_source: "Common funding source ≤3 hops",
  creator_funded: "Funded by token creator",
  token_transfer: "Token transfer",
  same_block_early_buy: "Same-block early buy",
  same_block_sell: "Same-block sell",
};
