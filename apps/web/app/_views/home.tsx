import Link from "next/link";
import { api, type Cluster } from "@/lib/api";
import { computeFinding } from "@/lib/finding";
import { SUBLINE, TAGLINE } from "@/lib/copy";
import { pct } from "@/lib/format";
import { rows } from "@/lib/verdict";
import { SortableTable } from "./sortable";

const n = (v: number) => v.toLocaleString("en-US");

/** Home: one verified headline from the export, four stat tiles, then the screener. */
export function Home() {
  const meta = api.meta("live");
  const tokens = api.tokens("live");
  const all = rows("live");
  const clusters = api.clusterIds("live").map((id) => api.cluster(id, "live")).filter((c): c is Cluster => c !== null);
  const finding = meta ? computeFinding(meta, tokens, clusters) : null;
  const inWindow = new Set(tokens.map((t) => t.address));
  const topLauncher = [...clusters].sort((a, b) => b.createdTokens.filter((t) => inWindow.has(t)).length - a.createdTokens.filter((t) => inWindow.has(t)).length)[0];
  const launches = topLauncher ? topLauncher.createdTokens.filter((t) => inWindow.has(t)).length : 0;
  const rawH = all.reduce((t, r) => t + (r.rawHolders ?? 0), 0);
  const realH = all.reduce((t, r) => t + (r.realHolders ?? 0), 0);
  const rawV = all.reduce((t, r) => t + BigInt(r.rawVolume), 0n);
  const orgV = all.reduce((t, r) => t + BigInt(r.organicVolume), 0n);
  const organicBps = rawV ? Number((orgV * 10_000n) / rawV) : 0;
  const tiles: Array<[string, React.ReactNode, string, string]> = [
    ["Tokens analysed", n(all.length), `${n(meta?.counts.prunedTokens ?? 0)} with too few buyers for full analysis`, "/methodology/#m-1-data-sources"],
    ["Holders, raw → real", <>{n(rawH)} <span className="text-[var(--soft)]">→</span> {n(realH)}</>, "summed over all tokens; each entity counted once", "/methodology/#m-4-metrics-per-token"],
    ["Organic volume share", pct(organicBps), "of all MON traded, by owners who kept their tokens", "/methodology/#m-4-metrics-per-token"],
    ["Largest entity's launches", n(launches), topLauncher ? `entity #${topLauncher.id.slice(2, 8)}, ${topLauncher.size} wallets` : "no clusters detected in this window", topLauncher ? `/cluster/${topLauncher.id}/` : "/methodology/"],
  ];
  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <section aria-labelledby="hero" className="pb-8 pt-4 sm:pt-8">
        <h1 id="hero" className="headline text-4xl sm:text-6xl">{TAGLINE}</h1>
        <p className="mt-4 max-w-3xl text-base text-[var(--muted)] sm:text-lg">{SUBLINE}</p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <a href="#screener" className="rounded-md bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--c-accent-ink)] hover:opacity-90">Explore tokens</a>
          <Link href="/developers/" className="rounded-md border border-[var(--line)] px-5 py-2.5 font-medium hover:border-[var(--accent)] hover:text-[var(--accent-text)]">Use the API</Link>
        </div>
      </section>
      <section aria-labelledby="headline">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--accent-text)]">The finding</p>
        <h2 id="headline" className="mt-2 max-w-4xl text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
          {finding ? finding.headline : "Data pending."}
        </h2>
        {finding ? (
          <p className="mt-2 text-[var(--muted)]">
            {finding.sub}{" "}
            {topLauncher ? <Link href={`/cluster/${topLauncher.id}/`} className="text-[var(--accent-text)] underline">See the evidence</Link> : null}
          </p>
        ) : null}
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] lg:grid-cols-4">
          {tiles.map(([label, value, note, href]) => (
            <Link key={label} href={href} className="block bg-[var(--surface)] p-4 hover:bg-[var(--panel)]">
              <dt className="text-xs text-[var(--muted)]">{label}</dt>
              <dd className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
              <dd className="mt-1 text-xs text-[var(--muted)]">{note}</dd>
            </Link>
          ))}
        </dl>
      </section>
      <section id="screener" aria-labelledby="screener-title" className="mt-8 scroll-mt-28">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="screener-title" className="text-lg font-semibold">Screener</h2>
          <p className="text-xs text-[var(--muted)]">Click a row for the token&apos;s clusters and evidence.</p>
        </div>
        <div className="card p-3 sm:p-4">
          <SortableTable rows={all} base="" syncUrl />
        </div>
      </section>
    </div>
  );
}
