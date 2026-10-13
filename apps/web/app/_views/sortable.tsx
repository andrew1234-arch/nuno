"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { mon, pct, short } from "@/lib/format";
import { LEVEL_LABEL, type Level, type Row } from "@/lib/levels";
import { Badge } from "./badge";
import { TokenLogo } from "./token-logo";

// Search, filter and sort run in the browser: the site is a static export with no server.
const SORTS: Array<[string, string, (r: Row) => number | bigint]> = [
  ["risk", "Most links found", (r) => ({ red: 3, amber: 2, none: 1, clear: 0 })[r.level] * 100 + r.flags],
  ["raw_volume", "Most traded", (r) => BigInt(r.rawVolume)],
  ["holders", "Most holders", (r) => r.rawHolders ?? -1],
  ["holder_gap", "Biggest holder gap", (r) => (r.rawHolders === null ? -1 : r.rawHolders - (r.realHolders ?? 0))],
  ["newest", "Newest", (r) => r.createBlock],
];

const FILTERS: Array<Level | "all"> = ["all", "red", "amber", "clear"];

function TokenRow({ r, base }: { r: Row; base: string }) {
  const href = `${base}/token/${r.address}/`;
  return (
    <tr className="border-t border-[var(--line)] hover:bg-[var(--panel)]">
      <td className="py-3 pr-3">
        <Link href={href} className="flex items-center gap-3 hover:text-[var(--accent-text)]">
          <TokenLogo src={r.image} symbol={r.symbol} size={36} />
          <span className="min-w-0">
            <span className="block font-medium">{r.symbol}</span>
            <span className="block max-w-[12rem] truncate text-xs text-[var(--muted)]" title={r.name}>
              {r.name} · <span className="mono">{short(r.address)}</span>
            </span>
          </span>
        </Link>
      </td>
      <td className="py-3 pr-3">
        <Link href={href} className="block">
          <Badge level={r.level} />
          {r.reason ? <p className="mt-1 max-w-sm text-xs text-[var(--muted)]">{r.reason}{r.flags > 1 ? ` (+${r.flags - 1} more)` : ""}</p> : null}
        </Link>
      </td>
      <td className="pr-3 text-right tabular-nums">
        {r.rawHolders === null ? "–" : r.rawHolders === r.realHolders ? r.rawHolders : <>{r.rawHolders} <span className="text-[var(--muted)]">→</span> <b>{r.realHolders}</b></>}
      </td>
      <td className="hidden pr-3 text-right tabular-nums sm:table-cell">{mon(r.rawVolume)}</td>
      <td className="hidden text-right tabular-nums sm:table-cell">{r.organicVolumeBps === null ? "–" : pct(r.organicVolumeBps)}</td>
    </tr>
  );
}

export function SortableTable({ rows, base, limit, syncUrl }: { rows: Row[]; base: string; limit?: number; syncUrl?: boolean }) {
  const router = useRouter();
  const [sort, setSort] = useState("raw_volume");
  const [filter, setFilter] = useState<Level | "all">("all");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  // Static export: no server-side query params, so read them once in the browser and keep the URL in step.
  const [ready, setReady] = useState(!syncUrl);
  useEffect(() => {
    if (!syncUrl) return;
    const p = new URLSearchParams(window.location.search);
    const s0 = p.get("sort"), f0 = p.get("filter");
    if (p.get("q")) setQ(p.get("q")!);
    if (s0 && SORTS.some(([k]) => k === s0)) setSort(s0);
    if (f0 && (FILTERS as string[]).includes(f0)) setFilter(f0 as Level | "all");
    setReady(true);
  }, [syncUrl]);
  useEffect(() => {
    if (!syncUrl || !ready) return;
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (sort !== "raw_volume") p.set("sort", sort);
    if (filter !== "all") p.set("filter", filter);
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [q, sort, filter, syncUrl, ready]);
  const query = q.trim().toLowerCase();
  const key = SORTS.find(([k]) => k === sort)![2];
  const matches = rows.filter(
    (r) => !query || r.address.includes(query) || r.symbol.toLowerCase().includes(query.replace(/^\$/, "")) || r.name.toLowerCase().includes(query),
  );
  const shown = matches
    .filter((r) => filter === "all" || r.level === filter)
    .sort((a, b) => {
      const x = key(a), y = key(b);
      return x === y ? b.createBlock - a.createBlock : y > x ? 1 : -1;
    });
  const count = (l: Level | "all") => (l === "all" ? matches.length : matches.filter((r) => r.level === l).length);
  const isAddress = /^0x[0-9a-f]{40}$/.test(query);
  const visible = all || !limit || query ? shown : shown.slice(0, limit);

  return (
    <>
      <form
        className="mt-6"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (shown.length === 1) router.push(`${base}/token/${shown[0]!.address}/`);
        }}
      >
        <label htmlFor="token-search" className="sr-only">Search tokens</label>
        <input
          id="token-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Paste a token address, or search by name or $TICKER"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 text-base shadow-sm outline-none placeholder:text-[var(--soft)] focus:border-[var(--accent)]"
        />
      </form>
      {isAddress && matches.length === 0 ? (
        <p className="mt-3 rounded-xl bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
          This address isn&apos;t a nad.fun token launched in the window Nuno checks (see the dates above). Check that it is a nad.fun token, or try again
          after the next update.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by what was found">
          {FILTERS.map((l) => (
            <button
              key={l}
              onClick={() => setFilter(l)}
              aria-pressed={l === filter}
              className={`rounded-full border px-3.5 py-1.5 ${l === filter ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--accent-text)]"}`}
            >
              {l === "all" ? "All" : LEVEL_LABEL[l]} <span className="tabular-nums opacity-70">{count(l)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[var(--muted)]">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[var(--text)]">
            {SORTS.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="py-2 text-left">Token</th>
              <th className="text-left">Linked wallets</th>
              <th className="pr-3 text-right" title="Wallets holding the token → real owners, once one person's wallets count as one">Holders → real</th>
              <th className="hidden pr-3 text-right sm:table-cell" title="All buys and sells, in MON">Traded (MON)</th>
              <th className="hidden text-right sm:table-cell" title="Share of trading done by owners who kept their tokens. Quick in-and-out trading, by bots or ordinary traders, is left out.">By holders</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <TokenRow key={r.address} r={r} base={base} />
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="mt-6 text-center text-[var(--muted)]">No tokens match.</p> : null}
        {visible.length < shown.length ? (
          <div className="mt-6 text-center">
            <button onClick={() => setAll(true)} className="pill border border-[var(--accent)] px-6 py-2.5 text-sm font-medium text-[var(--accent-text)] hover:bg-[var(--panel)]">
              Show all {shown.length} tokens
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
