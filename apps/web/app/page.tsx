import Link from "next/link";
import { api, type Token } from "@/lib/api";
import { mon, pct, short } from "@/lib/format";

export const dynamic = "force-dynamic";

const SORTS: Array<[string, string]> = [
  ["holder_gap", "Holder inflation"],
  ["cluster_supply", "Cluster supply"],
  ["creator_supply", "Creator-linked supply"],
  ["wash", "Wash share"],
  ["raw_volume", "Raw volume"],
  ["newest", "Newest"],
];

function Row({ t }: { t: Token }) {
  const m = t.metrics;
  return (
    <tr className="border-t border-[var(--line)] hover:bg-[var(--panel)]">
      <td className="py-2 pr-3">
        <Link href={`/token/${t.address}`} className="font-medium hover:text-[var(--accent)]">
          {t.symbol}
        </Link>
        <div className="mono text-xs text-[var(--muted)]">{short(t.address)}</div>
      </td>
      {m ? (
        <>
          <td className="pr-3 text-right tabular-nums">
            {m.rawHolders} <span className="text-[var(--muted)]">→</span> <b>{m.realHolders}</b>
          </td>
          <td className="pr-3 text-right tabular-nums">{pct(m.clusterSupplyBps)}</td>
          <td className="pr-3 text-right tabular-nums">{pct(m.creatorLinkedSupplyBps)}</td>
          <td className="pr-3 text-right tabular-nums">{pct(m.effectiveTop10Bps)}</td>
          <td className="pr-3 text-right tabular-nums">
            {mon(m.rawVolume)} <span className="text-[var(--muted)]">→</span> <b>{mon(m.organicVolume)}</b>
          </td>
          <td className={`text-right tabular-nums ${m.rawVolume !== "0" && m.organicVolumeBps < 5000 ? "text-[var(--bad)]" : ""}`}>
            {m.rawVolume === "0" ? "–" : pct(m.organicVolumeBps)}
          </td>
        </>
      ) : (
        <td colSpan={6} className="text-right text-[var(--muted)]">not computed yet</td>
      )}
    </tr>
  );
}

export default async function Screener({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort = "holder_gap" } = await searchParams;
  const data = await api.tokens(sort);
  const tokens = data?.tokens ?? [];
  const block = tokens.find((t) => t.metrics)?.metrics?.sourceBlock;
  return (
    <div>
      <h1 className="text-2xl font-bold">The real numbers behind every nad.fun launch</h1>
      <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
        Raw holder counts and volume are easy to fake with wallet farms. Nuno groups wallets controlled by the same operator into entities, using
        on-chain funding, transfer and trading evidence, and recomputes each token per entity.{" "}
        {block ? <span className="mono">Mainnet block {block.toLocaleString("en-US")}.</span> : null}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {SORTS.map(([k, label]) => (
          <Link
            key={k}
            href={`/?sort=${k}`}
            className={`rounded-full border px-3 py-1 ${k === sort ? "border-[var(--accent)] text-white" : "border-[var(--line)] text-[var(--muted)] hover:text-white"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="py-2 text-left">Token</th>
              <th className="pr-3 text-right">Holders raw → real</th>
              <th className="pr-3 text-right">Cluster supply</th>
              <th className="pr-3 text-right">Creator-linked</th>
              <th className="pr-3 text-right">Top-10 entities</th>
              <th className="pr-3 text-right">Volume MON raw → organic</th>
              <th className="text-right">Organic</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <Row key={t.address} t={t} />
            ))}
          </tbody>
        </table>
        {tokens.length === 0 ? <p className="mt-6 text-[var(--muted)]">No tokens indexed yet.</p> : null}
      </div>
    </div>
  );
}
