import type { Cluster, Meta, Token } from "./api";

// The headline finding, computed from the exported data at build time so it always matches the page.
// Wording approved by the user 2026-10-12 (no "scam", no operator name). The seeding facts are fixed and
// verified on-chain (docs/PROGRESS.md): 10 creator wallets first funded by one private wallet, block
// timestamps 2026-04-07 04:21:47Z → 04:22:04Z (17 s).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 4–12, 2026" or "Sep 30–Oct 6, 2026" from two ISO times (UTC). */
export function dateRange(startIso: string, endIso: string): string {
  const a = new Date(startIso);
  const b = new Date(endIso);
  const left = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}`;
  const right = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
  return `${left}–${right}, ${b.getUTCFullYear()}`;
}

export interface Finding {
  headline: string;
  sub: string;
  /** True when the group is exactly the 10 wallets of the verified seeding burst (evidence chips apply). */
  seeded: boolean;
}

export function computeFinding(meta: Meta, tokens: Token[], clusters: Cluster[]): Finding | null {
  const payout = new Set(PAYOUTS.map((p) => p.wallet));
  const group = clusters.find((c) => c.members.some((m) => payout.has(m)));
  if (!group || tokens.length === 0) return null;
  const inWindow = new Set(tokens.map((t) => t.address));
  const launched = group.createdTokens.filter((t) => inWindow.has(t)).length;
  const seeded = group.members.length === payout.size && group.members.every((m) => payout.has(m));
  const range = meta.window.startTime && meta.window.endTime ? `from ${dateRange(meta.window.startTime, meta.window.endTime)}` : "in the last week";
  const grouped = new Set(clusters.flatMap((c) => c.members));
  const pct = Math.round((tokens.filter((t) => grouped.has(t.creator)).length / tokens.length) * 100);
  return {
    headline: seeded
      ? `One group of ${group.members.length} wallets, seeded by a single private wallet in 17 seconds, launched ${launched} of the ${tokens.length} nad.fun tokens ${range}.`
      : `One group of ${group.members.length} wallets launched ${launched} of the ${tokens.length} nad.fun tokens ${range}.`,
    sub: `Across the week, ${pct}% of launches came from wallets in a group.`,
    seeded,
  };
}

export const SEEDER = "0xb2454805656dd62b4aec8718a53f5543cc66d3b3";

/** The seeder's 300,000 MON deposit from an exchange-like hot wallet, one day before the burst. */
export const SEEDER_DEPOSIT = {
  tx: "0x87d3adbb61deeee7b6a6a069cf9807612dca17381eca8e74370f0bc6f10a54f3",
  block: 66_370_945,
  from: "0xf89d7b9c864f589bbf53a82105107622b35eaa40",
  mon: 300_000,
};

/** 14,995 MON to each creator wallet, blocks 66,478,706–66,478,748. */
export const PAYOUTS: Array<{ wallet: string; tx: string; block: number }> = [
  { wallet: "0x39f234ce10159d4c3c254a6a7b7d45e8a9486091", tx: "0x928affdb34ae3f698866c37b499829fb50f994d1ff9b8ffd0080896dc3c4a1c5", block: 66478706 },
  { wallet: "0x849cb815ce2e4ccffbd4196469795a535de79bb4", tx: "0x9dd12f035db7b9eae17d2af71531abff93d90aede26a4593137a80ab5653cb9e", block: 66478710 },
  { wallet: "0xdd1cf85f4adbf2e073ab69d17f17729ad2cf78de", tx: "0xe12ecdb9a857130b5c57b2709b736d2a533ea41bb4c146517e5bb1eab52c950e", block: 66478715 },
  { wallet: "0x0a0f293733c74abc3431410e2b036fa3e57a6f0c", tx: "0x472f4f46f2d19b9e2dd95b885992cb10a8f28235e31d973fd9859ee00130b35b", block: 66478720 },
  { wallet: "0xea6cf43b04cb087ecd8398ad241387d8949fb6a4", tx: "0xc585563eda39d79f3cc9c9c9eb07d7c1473a38674b9cf980a20c0c349719a603", block: 66478724 },
  { wallet: "0x511e84251328cf1a606a02891b8ea53f6bd1d21d", tx: "0xf7b0382285337087bedb6eb9ae673080d986bdd066aba7ffa1dc5783cfaf4eb6", block: 66478728 },
  { wallet: "0x1b3dc681cc017a4d918a3441a66f0ccce084bf8c", tx: "0x88d0162e547941c21105c3e7bda64168c6b3663ad238d0a179245986f47ea4db", block: 66478733 },
  { wallet: "0x725d3b6dec1c14bbabfb1e166efaacec25f12401", tx: "0x8db860bfd41a68114d1d1b0f07fb88139da0299cbd2666ea7ff2b9c5ab7202dd", block: 66478738 },
  { wallet: "0xe0b0111d11ba155bba6f0d355cf847f9e2874899", tx: "0x9327686e26db15427ba97f53ab4abc25644dee72156941c338cc3cf4b5472a09", block: 66478743 },
  { wallet: "0x2d5be282e510830ab483c182349b9fc493f49b7b", tx: "0xe771d39f8cda067c0cbd45ffba4ce4962e7211429f13ba2e4edb42da66558883", block: 66478748 },
];
