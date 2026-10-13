import Link from "next/link";
import { api, type Cluster } from "@/lib/api";
import { computeFinding } from "@/lib/finding";
import { SUBLINE, TAGLINE } from "@/lib/copy";
import { testnetDeployment } from "@/lib/deployments";
import { pct, short } from "@/lib/format";
import { rows } from "@/lib/verdict";
import { SortableTable } from "./sortable";

const n = (v: number) => v.toLocaleString("en-US");

const STEPS: Array<[string, string]> = [
  ["Index", "Every nad.fun launch, trade and transfer on Monad mainnet (V1 and V2 curves)."],
  ["Link", "Wallets are grouped into entities by shared funding, same-block buys, transfers and coordinated sells, with every link backed by a transaction."],
  ["Publish", "Real holder counts and organic volume, served as an open API and written on-chain to NunoFeed on Monad."],
];

/** Home: one verified headline from the export, four stat tiles, then the screener. */
export function Home() {
  const meta = api.meta("live");
  const dep = testnetDeployment();
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
      <section aria-labelledby="how" className="mt-10">
        <h2 id="how" className="text-lg font-semibold">How it works</h2>
        <ol className="mt-3 grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="bg-[var(--surface)] p-4">
              <p className="flex items-center gap-2 font-medium">
                <span className="mono flex h-6 w-6 items-center justify-center rounded bg-[var(--panel)] text-xs text-[var(--accent-text)]">{i + 1}</span>
                {title}
              </p>
              <p className="mt-1.5 text-sm text-[var(--muted)]">{body}</p>
            </li>
          ))}
        </ol>
        <Link href="/methodology/" className="mt-2 inline-block text-sm text-[var(--accent-text)] hover:underline">Read the methodology →</Link>
      </section>

      <section aria-labelledby="for" className="mt-10">
        <h2 id="for" className="text-lg font-semibold">Built for</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="font-medium">Traders and researchers</p>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              Check any token&apos;s real holders, concentration and organic volume, with proof for every link. {n(all.length)} nad.fun tokens and{" "}
              {n(meta?.counts.entities ?? 0)} entities in the current window.
            </p>
            <div className="mt-auto pt-4">
              <a href="#screener" className="inline-block rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--c-accent-ink)] hover:opacity-90">Explore tokens</a>
            </div>
          </div>
          <div className="flex min-w-0 flex-col rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="font-medium">Apps and contracts</p>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              Read cluster-adjusted metrics from the static API, or on-chain from NunoFeed{dep ? <> on Monad testnet (<span className="mono">{short(dep.NunoFeed)}</span>)</> : null}. OrganicGate shows a contract using it.
            </p>
            {dep ? (
              <pre className="mono mt-3 overflow-x-auto rounded-md bg-[var(--panel)] p-3 text-[11px] leading-relaxed">{`const s = await client.readContract({
  address: "${dep.NunoFeed}", // NunoFeed
  abi, functionName: "latest", args: [token],
});
// s.rawHolders, s.realHolders, s.clusterSupplyBps, s.evidenceRoot`}</pre>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-2 pt-4 text-sm">
              <Link href="/developers/" className="rounded-md border border-[var(--line)] px-4 py-2 font-medium hover:border-[var(--accent)] hover:text-[var(--accent-text)]">Use the API</Link>
              <Link href="/contracts/" className="rounded-md border border-[var(--line)] px-4 py-2 font-medium hover:border-[var(--accent)] hover:text-[var(--accent-text)]">View contracts</Link>
            </div>
          </div>
        </div>
      </section>

      <section id="screener" aria-labelledby="screener-title" className="mt-10 scroll-mt-28">
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
