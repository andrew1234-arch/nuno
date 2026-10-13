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
  red: "Many linked wallets",
  amber: "Some linked wallets",
  clear: "No linked wallets found",
  none: "Not enough data",
};

export const LEVEL_HINT: Record<Level, string> = {
  red: "Its creator or holders are linked to many other wallets. See who, and the proof.",
  amber: "Some of its creator's or holders' wallets are linked. See who, and the proof.",
  clear: "No links found between its creator and holders and other wallets. Not a guarantee.",
  none: "Too little trading to say.",
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

