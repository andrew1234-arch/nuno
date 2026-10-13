import { api, type Cluster, type Dataset, type Token } from "./api";
import { pct } from "./format";
import type { Flag, Level, Row, Verdict } from "./levels";

export { LEVEL_HINT, LEVEL_LABEL, RULES, type Flag, type Level, type Row, type Verdict } from "./levels";

// A token's label (what was found, not a risk rating), computed at build time from the exported numbers only. Each flag is one plain
// sentence backed by a number shown on the token page; the level is the worst flag. Thresholds are
// listed on the token page and the developers page, so users can judge them.

const groupCache = new Map<Dataset, Map<string, Cluster>>();

/** wallet -> its group, over every group in the dataset (the creator's group may not trade this token). */
function groups(d: Dataset): Map<string, Cluster> {
  let byWallet = groupCache.get(d);
  if (byWallet) return byWallet;
  byWallet = new Map();
  for (const id of api.clusterIds(d)) {
    const c = api.cluster(id, d);
    if (c) for (const m of c.members) byWallet.set(m, c);
  }
  groupCache.set(d, byWallet);
  return byWallet;
}

export function verdict(t: Token, d: Dataset = "live"): Verdict {
  const m = t.metrics;
  const g = groups(d).get(t.creator) ?? null;
  const creatorGroup = g ? { id: g.id, size: g.size, launched: g.createdTokens.length } : null;
  const flags: Flag[] = [];
  if (creatorGroup) {
    const other = creatorGroup.launched - 1;
    flags.push({
      level: creatorGroup.launched >= 5 ? "red" : "amber",
      text: `The creator is one of ${creatorGroup.size} linked wallets${other > 0 ? ` that launched ${other} other token${other > 1 ? "s" : ""}` : ""}.`,
    });
  }
  if (m) {
    if (m.rawHolders >= 5 && m.realHolders / m.rawHolders <= 0.85) {
      flags.push({
        level: m.realHolders / m.rawHolders <= 0.5 ? "red" : "amber",
        text: `${m.rawHolders} wallets hold it, but they belong to only ${m.realHolders} real owner${m.realHolders === 1 ? "" : "s"}.`,
      });
    }
    if (m.clusterSupplyBps >= 500) {
      flags.push({ level: m.clusterSupplyBps >= 2000 ? "red" : "amber", text: `Wallet groups hold ${pct(m.clusterSupplyBps)} of the supply.` });
    }
    if (m.creatorLinkedSupplyBps >= 300) {
      flags.push({ level: m.creatorLinkedSupplyBps >= 1000 ? "red" : "amber", text: `The creator and linked wallets hold ${pct(m.creatorLinkedSupplyBps)} of the supply.` });
    }
  }
  flags.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
  const level: Level = flags.some((f) => f.level === "red")
    ? "red"
    : flags.length
      ? "amber"
      : !m || (m.rawHolders === 0 && m.rawVolume === "0")
        ? "none"
        : "clear";
  return { level, flags, creatorGroup };
}

export function rows(d: Dataset = "live"): Row[] {
  return api.tokens(d).map((t) => {
    const v = verdict(t, d);
    const m = t.metrics;
    return {
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      createBlock: t.createBlock,
      rawHolders: m?.rawHolders ?? null,
      realHolders: m?.realHolders ?? null,
      rawVolume: m?.rawVolume ?? "0",
      organicVolume: m?.organicVolume ?? "0",
      organicVolumeBps: m && m.rawVolume !== "0" ? m.organicVolumeBps : null,
      level: v.level,
      reason: v.flags[0]?.text ?? null,
      flags: v.flags.length,
    };
  });
}
