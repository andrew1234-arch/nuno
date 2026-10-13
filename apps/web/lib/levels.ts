// Verdict levels and screener rows, safe to import in browser code (no file access).

export type Level = "red" | "amber" | "clear" | "none";

export interface Flag {
  level: "red" | "amber";
  text: string;
}

export interface Verdict {
  level: Level;
  flags: Flag[];
  /** The group the creator belongs to, when there is one. */
  creatorGroup: { id: string; size: number; launched: number } | null;
}

export const LEVEL_LABEL: Record<Level, string> = {
  red: "Red flags",
  amber: "Some flags",
  clear: "No flags found",
  none: "Not enough data",
};

export const LEVEL_HINT: Record<Level, string> = {
  red: "Strong signs that a few people control this token through many wallets.",
  amber: "Some signs of linked wallets. Worth checking who they are before you buy.",
  clear: "No linked wallets found among its creator and holders. Not a guarantee.",
  none: "Too little trading to judge.",
};

/** The rules, in the order they are checked (shown on the developers page). */
export const RULES: Array<[Level, string]> = [
  ["red", "The creator belongs to a wallet group that launched 5 or more tokens in the window."],
  ["red", "At least 5 wallets hold it, and real owners are half the holder count or fewer."],
  ["red", "Wallet groups hold 20% or more of the supply, or the creator's side holds 10% or more."],
  ["amber", "The creator belongs to a wallet group."],
  ["amber", "At least 5 wallets hold it, and real owners are 85% of the holder count or fewer."],
  ["amber", "Wallet groups hold 5% or more of the supply, or the creator's side holds 3% or more."],
];

/** What the client-side screener needs per token (computed at build time). */
export interface Row {
  address: string;
  name: string;
  symbol: string;
  createBlock: number;
  rawHolders: number | null;
  realHolders: number | null;
  rawVolume: string;
  organicVolume: string;
  organicVolumeBps: number | null;
  level: Level;
  reason: string | null;
  flags: number;
}

