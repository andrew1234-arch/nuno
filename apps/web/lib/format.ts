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

/** Why two wallets are linked, in plain words (evidence tables). */
export const EDGE_LABELS: Record<string, string> = {
  same_direct_funder: "Got their money from the same wallet, within a day",
  common_funding_source: "Their money traces back to the same source",
  creator_funded: "Got money from the token's creator",
  token_transfer: "Sent the token straight to each other",
  same_block_early_buy: "Bought at the same instant, right after launch",
  same_block_sell: "Sold at the same instant",
};

/** Short versions for the graph legend. */
export const EDGE_SHORT: Record<string, string> = {
  same_direct_funder: "same funder",
  common_funding_source: "same money source",
  creator_funded: "funded by creator",
  token_transfer: "sent token",
  same_block_early_buy: "bought together",
  same_block_sell: "sold together",
};

/** Reasons as sentence fragments: "They are linked because they …". */
export const EDGE_REASON: Record<string, string> = {
  same_direct_funder: "got their money from the same wallet",
  common_funding_source: "trace their money back to the same source",
  creator_funded: "were funded by a token's creator",
  token_transfer: "sent tokens to each other",
  same_block_early_buy: "bought at the same instant right after launch",
  same_block_sell: "sold at the same instant",
};

/** How much a single piece of evidence counts on its own. */
export const strength = (weight: number) => (weight >= 1 ? "strong" : weight >= 0.8 ? "medium" : "weak on its own");
