import Link from "next/link";
import { api } from "@/lib/api";
import { testnetDeployment } from "@/lib/deployments";
import { LEVEL_HINT, type Level, type Row } from "@/lib/levels";
import { dateRange } from "@/lib/finding";
import { rows } from "@/lib/verdict";
import { mon } from "@/lib/format";
import { Search } from "./search";
import { TokenLogo } from "./token-logo";
import { Badge } from "./badge";
import { Freshness } from "./landing";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Steps() {
  const steps: Array<[string, string]> = [
    ["Find the token", "Paste its address from nad.fun into the search box, or type its name or ticker. Every nad.fun launch in the window is here."],
    ["See what was found", "Each token is labelled by how many linked wallets Nuno found, with the facts in one line each: who the creator is linked to and how many real owners there are."],
    ["Check the proof", "Open the token to see each wallet group, how its wallets are linked and the public transactions behind every link."],
  ];
  return (
    <section id="how-to" className="scroll-mt-20 px-4 pt-14 sm:px-6 lg:px-8">
      <div className="card w-full px-6 py-12 sm:px-12">
        <h2 className="headline text-4xl sm:text-5xl">
          How to <span className="fade">Use It</span>
        </h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {steps.map(([title, body], i) => (
            <li key={title}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-semibold text-[var(--accent-ink)]">{i + 1}</span>
              <p className="mt-4 text-lg font-medium">{title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 rounded-md bg-[var(--panel)] p-6">
          <p className="font-medium">What the labels mean</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["red", "amber", "clear", "none"] as Level[]).map((l) => (
              <li key={l}>
                <Badge level={l} />
                <p className="mt-2 text-sm text-[var(--muted)]">{LEVEL_HINT[l]}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-[var(--muted)]">
            Labels describe links found in public transactions, not whether a token is good or bad, and are not financial advice. Grouping was checked
            by hand on a small sample only (see the proof on every token). The exact rules are on the{" "}
            <Link href="/docs/#labels" className="text-[var(--accent-text)] underline">docs</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}

function Build() {
  const dep = testnetDeployment();
  const cards: Array<[string, string, string, string]> = [
    ["JSON API", "Every token's numbers, wallet groups and proof as static JSON. Free, no key, updated every 15 minutes.", `${BASE}/api/tokens.json`, "Open tokens.json"],
    ["On-chain feed", `Read a token's real-owner numbers from the NunoFeed contract on Monad testnet${dep ? ` (${dep.NunoFeed.slice(0, 8)}…)` : ""}.`, "/developers/#contracts", "See the contract"],
    ["OrganicGate", "One call lets your contract refuse tokens that are mostly held by wallet groups, or whose data is stale.", "/developers/#contracts", "See the example"],
  ];
  return (
    <section className="band-plain mt-14 px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full">
        <h2 className="headline text-4xl text-[var(--accent-ink)] sm:text-5xl">
          Build <span className="text-[var(--accent-soft)]">on Nuno</span>
        </h2>
        <p className="mt-3 max-w-2xl text-[var(--accent-soft)]">Bots, launchpads, trackers and smart contracts can use the same numbers you see here.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {cards.map(([title, body, href, cta]) => (
            <a key={title} href={href.startsWith("/developers") ? `${BASE}${href}` : href} className="card block p-6 transition hover:-translate-y-0.5">
              <p className="text-lg font-medium">{title}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{body}</p>
              <p className="mt-4 text-sm font-medium text-[var(--accent-text)]">{cta} →</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

const n = (v: number) => v.toLocaleString("en-US");

/** A ranked top-5 card that links to the full, sorted list. */
function Top({ title, list, value, sort, filter }: { title: string; list: Row[]; value: (r: Row) => React.ReactNode; sort: string; filter?: string }) {
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <Link href={`/tokens/?sort=${sort}${filter ? `&filter=${filter}` : ""}`} className="text-sm text-[var(--accent-text)] hover:underline">
          View all →
        </Link>
      </div>
      <ol className="mt-3 flex-1 divide-y divide-[var(--line)]">
        {list.map((r, i) => (
          <li key={r.address}>
            <Link href={`/token/${r.address}/`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--panel)]">
              <span className="w-4 text-sm tabular-nums text-[var(--soft)]">{i + 1}</span>
              <TokenLogo src={r.image} symbol={r.symbol} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.symbol}</span>
                <span className="block truncate text-xs text-[var(--muted)]">{r.name}</span>
              </span>
              <span className="text-right text-sm tabular-nums">{value(r)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Home() {
  const meta = api.meta("live");
  const all = rows("live");
  const range = meta?.window.startTime && meta.window.endTime ? dateRange(meta.window.startTime, meta.window.endTime) : null;
  const by = (f: (r: Row) => number | bigint) => [...all].sort((a, b) => { const x = f(a), y = f(b); return x === y ? b.createBlock - a.createBlock : y > x ? 1 : -1; }).slice(0, 5);
  const traded = by((r) => BigInt(r.rawVolume));
  const newest = by((r) => r.createBlock);
  const gap = by((r) => (r.rawHolders === null ? -1 : r.rawHolders - (r.realHolders ?? 0)));
  const holders = by((r) => r.rawHolders ?? -1);
  const linked = all.filter((r) => r.level === "red").length;
  const rawH = all.reduce((t, r) => t + (r.rawHolders ?? 0), 0);
  const realH = all.reduce((t, r) => t + (r.realHolders ?? 0), 0);
  const stats: Array<[string, string]> = [
    [n(all.length), `nad.fun tokens checked${range ? `, ${range}` : ""}`],
    [`${n(rawH)} → ${n(realH)}`, "holders shown → real owners, all tokens"],
    [n(meta?.counts.walletsInEntities ?? 0), `wallets in ${n(meta?.counts.entities ?? 0)} linked groups`],
    [n(linked), "tokens with many linked wallets"],
  ];
  const badge = (r: Row) => <Badge level={r.level} />;
  return (
    <>
      <section className="relative px-4 pb-12 pt-16 text-center sm:pt-20">
                <div className="relative mx-auto max-w-3xl">
          {meta ? <Freshness meta={meta} tokens={all.length} /> : null}
          <h1 className="headline mt-6 text-5xl sm:text-6xl">
            Check a nad.fun Token <span className="fade">Before You Buy</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-[var(--muted)]">
            See how many real people own a token and which of its wallets are linked to each other, with public proof for every link.
          </p>
          <div className="mx-auto mt-8 max-w-2xl">
            <Search items={all.map((r) => [r.address, r.symbol, r.name, r.level, r.image])} size="lg" />
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]">
            or <Link href="/tokens/" className="text-[var(--accent-text)] hover:underline">browse all {n(all.length)} tokens</Link>
          </p>
        </div>
      </section>

      <section className="w-full px-4 sm:px-6 lg:px-8">
        <dl className="card grid grid-cols-2 divide-[var(--line)] lg:grid-cols-4 lg:divide-x">
          {stats.map(([v, label]) => (
            <div key={label} className="p-5">
              <dt className="sr-only">{label}</dt>
              <dd className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{v}</dd>
              <dd className="mt-1 text-sm text-[var(--muted)]">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10 w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">Top tokens right now</h2>
          <Link href="/tokens/" className="pill border border-[var(--line)] px-4 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent-text)]">All tokens →</Link>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Top title="Most traded" list={traded} sort="raw_volume" value={(r) => <>{mon(r.rawVolume).split(".")[0]} <span className="text-xs text-[var(--muted)]">MON</span></>} />
          <Top title="Most holders" list={holders} sort="holders" value={(r) => (r.rawHolders === r.realHolders ? `${r.rawHolders}` : <>{r.rawHolders} → <b>{r.realHolders}</b></>)} />
          <Top title="Biggest holder gap" list={gap} sort="holder_gap" value={(r) => <>{r.rawHolders} → <b>{r.realHolders}</b></>} />
          <Top title="Newest launches" list={newest} sort="newest" value={badge} />
        </div>
      </section>

      <Steps />
      <Build />
    </>
  );
}
