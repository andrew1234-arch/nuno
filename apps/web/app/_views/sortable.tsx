"use client";

import Link from "next/link";
import { useState } from "react";
import type { Token } from "@/lib/api";
import { mon, pct, short } from "@/lib/format";

// Sorting runs in the browser: the site is a static export, so there is no server to sort by query string.
const SORTS: Array<[string, string, (t: Token) => number | bigint]> = [
  ["holder_gap", "Holder inflation", (t) => (t.metrics ? t.metrics.rawHolders - t.metrics.realHolders : -1)],
  ["cluster_supply", "Cluster supply", (t) => t.metrics?.clusterSupplyBps ?? -1],
  ["creator_supply", "Creator-linked supply", (t) => t.metrics?.creatorLinkedSupplyBps ?? -1],
  ["wash", "Wash share", (t) => (t.metrics && t.metrics.rawVolume !== "0" ? 10_000 - t.metrics.organicVolumeBps : -1)],
  ["raw_volume", "Raw volume", (t) => (t.metrics ? BigInt(t.metrics.rawVolume) : -1n)],
  ["newest", "Newest", (t) => t.createBlock],
];

function Row({ t, base }: { t: Token; base: string }) {
  const m = t.metrics;
  return (
    <tr className="border-t border-[var(--line)] hover:bg-[var(--panel)]">
      <td className="py-2 pr-3">
        <Link href={`${base}/token/${t.address}/`} className="font-medium hover:text-[var(--accent)]">
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
        <td colSpan={6} className="text-right text-[var(--muted)]">{t.pruned ? "pruned (below MIN_BUYERS)" : "not computed yet"}</td>
      )}
    </tr>
  );
}

export function SortableTable({ tokens, base, limit }: { tokens: Token[]; base: string; limit?: number }) {
  const [sort, setSort] = useState("holder_gap");
  const [all, setAll] = useState(false);
  const key = SORTS.find(([k]) => k === sort)![2];
  const sorted = [...tokens].sort((a, b) => {
    const x = key(a), y = key(b);
    return x === y ? b.createBlock - a.createBlock : y > x ? 1 : -1;
  });
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {SORTS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSort(k)}
            className={`rounded-full border px-3.5 py-1.5 ${k === sort ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--accent)]"}`}
          >
            {label}
          </button>
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
            {(all || !limit ? sorted : sorted.slice(0, limit)).map((t) => (
              <Row key={t.address} t={t} base={base} />
            ))}
          </tbody>
        </table>
        {tokens.length === 0 ? <p className="mt-6 text-[var(--muted)]">No tokens in this dataset.</p> : null}
        {limit && !all && sorted.length > limit ? (
          <div className="mt-6 text-center">
            <button onClick={() => setAll(true)} className="pill border border-[var(--accent)] px-6 py-2.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--panel)]">
              Show all {sorted.length} tokens
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
