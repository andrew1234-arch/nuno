"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { pct, short } from "@/lib/format";
import type { Row } from "@/lib/levels";
import { Badge } from "./badge";
import { TokenLogo } from "./token-logo";

// Search, filters and sort run in the browser (static export, no server). State is kept in the URL.
const SORTS: Array<[string, string, (r: Row) => number | bigint]> = [
  ["holder_gap", "Biggest holder gap", (r) => (r.rawHolders === null ? -1 : r.rawHolders - (r.realHolders ?? 0))],
  ["cluster_supply", "Most supply in clusters", (r) => r.clusterSupplyBps ?? -1],
  ["raw_volume", "Most traded", (r) => BigInt(r.rawVolume)],
  ["holders", "Most holders", (r) => r.rawHolders ?? -1],
  ["organic", "Lowest organic volume", (r) => (r.organicVolumeBps === null ? -1 : 10_000 - r.organicVolumeBps)],
  ["newest", "Newest", (r) => r.createBlock],
];
const CURVES = ["all", "V1", "V2"] as const;
type Curve = (typeof CURVES)[number];

function age(iso: string | null, now: number | null): string {
  if (!iso) return "–";
  if (now === null) return iso.slice(5, 10);
  const h = (now - Date.parse(iso)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
}

/** Thin ratio bar; the number is always shown next to it, so colour is never the only signal. */
function Bar({ value, color, title }: { value: number; color: string; title: string }) {
  return (
    <span className="ml-2 inline-block h-1.5 w-14 overflow-hidden rounded-sm bg-[var(--line)] align-middle" title={title} aria-hidden="true">
      <span className="block h-full" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </span>
  );
}

function TokenRow({ r, base, now, onOpen }: { r: Row; base: string; now: number | null; onOpen: (href: string) => void }) {
  const href = `${base}/token/${r.address}/`;
  const ratio = r.rawHolders ? (r.realHolders ?? 0) / r.rawHolders : 1;
  return (
    <tr className="group cursor-pointer border-t border-[var(--line)] hover:bg-[var(--panel)]" onClick={() => onOpen(href)}>
      <td className="sticky left-0 z-[1] bg-[var(--surface)] py-2.5 pr-3 group-hover:bg-[var(--panel)]">
        <Link href={href} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2.5 hover:text-[var(--accent-text)]">
          <TokenLogo src={r.image} symbol={r.symbol} size={28} />
          <span className="min-w-0">
            <span className="block max-w-[9rem] truncate font-medium">{r.symbol}</span>
            <span className="block max-w-[9rem] truncate text-xs text-[var(--muted)]" title={r.name}>
              {r.name} · <span className="mono">{short(r.address)}</span>
            </span>
          </span>
        </Link>
      </td>
      <td className="pr-3">
        {r.curve ? <span className="mono rounded border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">{r.curve}</span> : "–"}
      </td>
      <td className="pr-3 text-right text-[var(--muted)]" title={r.createdAt ?? undefined}>{age(r.createdAt, now)}</td>
      <td className="whitespace-nowrap pr-3 text-right">
        {r.rawHolders === null ? (
          "–"
        ) : (
          <>
            <span className="text-[var(--muted)]">{r.rawHolders}</span> <span className="text-[var(--soft)]">→</span> <span className="font-medium">{r.realHolders}</span>
            <Bar value={ratio} color="var(--organic)" title={`${r.realHolders} real owners of ${r.rawHolders} holders`} />
          </>
        )}
      </td>
      <td className="whitespace-nowrap pr-3 text-right">
        {r.clusterSupplyBps === null ? "–" : (
          <>
            {pct(r.clusterSupplyBps)}
            <Bar value={r.clusterSupplyBps / 10_000} color="var(--flag)" title={`${pct(r.clusterSupplyBps)} of supply held by clusters`} />
          </>
        )}
      </td>
      <td className="pr-3 text-right">{r.organicVolumeBps === null ? "–" : pct(r.organicVolumeBps)}</td>
      <td className="pr-3">
        <Badge level={r.level} />
      </td>
      <td className="whitespace-nowrap">
        {r.entity ? (
          <Link href={`${base}/cluster/${r.entity.id}/`} onClick={(e) => e.stopPropagation()} className="mono text-xs text-[var(--accent-text)] hover:underline" title={`Creator's entity: ${r.entity.size} wallets`}>
            #{r.entity.id.slice(2, 8)} <span className="text-[var(--muted)]">({r.entity.size})</span>
          </Link>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </td>
    </tr>
  );
}

export function SortableTable({ rows, base, limit = 50, syncUrl }: { rows: Row[]; base: string; limit?: number; syncUrl?: boolean }) {
  const router = useRouter();
  const [sort, setSort] = useState("holder_gap");
  const [curve, setCurve] = useState<Curve>("all");
  const [flagged, setFlagged] = useState(false);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [ready, setReady] = useState(!syncUrl);
  useEffect(() => {
    setNow(Date.now());
    if (!syncUrl) return;
    const p = new URLSearchParams(window.location.search);
    const s0 = p.get("sort"), c0 = p.get("curve");
    if (p.get("q")) setQ(p.get("q")!);
    if (s0 && SORTS.some(([k]) => k === s0)) setSort(s0);
    if (c0 && (CURVES as readonly string[]).includes(c0)) setCurve(c0 as Curve);
    if (p.get("flagged") === "1") setFlagged(true);
    setReady(true);
  }, [syncUrl]);
  useEffect(() => {
    if (!syncUrl || !ready) return;
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (sort !== "holder_gap") p.set("sort", sort);
    if (curve !== "all") p.set("curve", curve);
    if (flagged) p.set("flagged", "1");
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }, [q, sort, curve, flagged, syncUrl, ready]);

  const query = q.trim().toLowerCase().replace(/^\$/, "");
  const key = SORTS.find(([k]) => k === sort)![2];
  const shown = rows
    .filter((r) => !query || r.address.includes(query) || r.symbol.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
    .filter((r) => curve === "all" || r.curve === curve)
    .filter((r) => !flagged || r.level === "red" || r.level === "amber")
    .sort((a, b) => {
      const x = key(a), y = key(b);
      return x === y ? b.createBlock - a.createBlock : y > x ? 1 : -1;
    });
  const visible = all || query ? shown : shown.slice(0, limit);
  const isAddress = /^0x[0-9a-f]{40}$/.test(query);
  const chip = (on: boolean) => `rounded-md border px-3 py-1.5 ${on ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--c-accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <form
          role="search"
          className="min-w-[14rem] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (shown.length === 1) router.push(`${base}/token/${shown[0]!.address}/`);
          }}
        >
          <label htmlFor="screener-search" className="sr-only">Filter tokens by name or address</label>
          <input
            id="screener-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name, $TICKER or address"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 outline-none placeholder:text-[var(--soft)] focus:border-[var(--accent)]"
          />
        </form>
        <div role="group" aria-label="Curve" className="flex gap-1">
          {CURVES.map((c) => (
            <button key={c} onClick={() => setCurve(c)} aria-pressed={c === curve} className={chip(c === curve)}>
              {c === "all" ? "All curves" : c}
            </button>
          ))}
        </div>
        <button onClick={() => setFlagged((f) => !f)} aria-pressed={flagged} className={chip(flagged)}>
          Only flagged
        </button>
        <label className="flex items-center gap-2 text-[var(--muted)]">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-[var(--text)]">
            {SORTS.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      {isAddress && shown.length === 0 ? (
        <p className="mt-3 rounded-md bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)]">This address isn&apos;t a nad.fun token launched in this window.</p>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="text-xs text-[var(--muted)]">
            <tr className="text-left">
              <th className="sticky left-0 z-[1] bg-[var(--surface)] py-2 font-medium">Token</th>
              <th className="pr-3 font-medium">Curve</th>
              <th className="pr-3 text-right font-medium">Age</th>
              <th className="pr-3 text-right font-medium" title="Wallets holding the token → real owners, with each entity counted once">
                Holders raw → real <Link href="/methodology/#m-4-metrics-per-token" aria-label="Definition" className="text-[var(--soft)] hover:text-[var(--accent-text)]">ⓘ</Link>
              </th>
              <th className="pr-3 text-right font-medium" title="Share of supply held by clusters of linked wallets">
                Cluster supply <Link href="/methodology/#m-4-metrics-per-token" aria-label="Definition" className="text-[var(--soft)] hover:text-[var(--accent-text)]">ⓘ</Link>
              </th>
              <th className="pr-3 text-right font-medium" title="Share of volume by owners who kept their tokens">
                Organic vol. <Link href="/methodology/#m-4-metrics-per-token" aria-label="Definition" className="text-[var(--soft)] hover:text-[var(--accent-text)]">ⓘ</Link>
              </th>
              <th className="pr-3 font-medium">
                Linked wallets <Link href="/methodology/#labels" aria-label="How labels work" className="text-[var(--soft)] hover:text-[var(--accent-text)]">ⓘ</Link>
              </th>
              <th className="font-medium" title="The creator's entity, if the creator is in a cluster">Entity</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <TokenRow key={r.address} r={r} base={base} now={now} onOpen={(href) => router.push(href)} />
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="py-8 text-center text-[var(--muted)]">No tokens match these filters.</p> : null}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          Showing {visible.length} of {shown.length}
        </span>
        {visible.length < shown.length ? (
          <button onClick={() => setAll(true)} className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--text)] hover:border-[var(--accent)]">
            Show all {shown.length}
          </button>
        ) : null}
      </div>
    </>
  );
}
