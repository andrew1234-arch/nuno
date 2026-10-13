import Link from "next/link";
import { api } from "@/lib/api";
import { testnetDeployment } from "@/lib/deployments";
import { LEVEL_HINT, LEVEL_LABEL, type Level } from "@/lib/levels";
import { dateRange } from "@/lib/finding";
import { rows } from "@/lib/verdict";
import { Badge } from "./badge";
import { Freshness } from "./landing";
import { SortableTable } from "./sortable";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Steps() {
  const steps: Array<[string, string]> = [
    ["Find the token", "Paste its address from nad.fun, or search by name or ticker. Every nad.fun launch in the window is here."],
    ["Read the verdict", "Red flags, some flags or no flags found, with the reasons in one line each: who the creator is linked to and how many real owners there are."],
    ["Check the proof", "Open the token to see each wallet group, how its wallets are linked and the public transactions behind every link."],
  ];
  return (
    <section id="how-to" className="scroll-mt-16 px-2 py-6 sm:px-4">
      <div className="card mx-auto max-w-6xl px-6 py-12 sm:px-12">
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
        <div className="mt-12 rounded-2xl bg-[var(--panel)] p-6">
          <p className="font-medium">What the verdicts mean</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["red", "amber", "clear", "none"] as Level[]).map((l) => (
              <li key={l}>
                <Badge level={l} />
                <p className="mt-2 text-sm text-[var(--muted)]">{LEVEL_HINT[l]}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-[var(--muted)]">
            A verdict is a starting point, not financial advice. The exact rules are on the{" "}
            <Link href="/developers/#rules" className="text-[var(--accent-text)] underline">developers page</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}

function Build() {
  const dep = testnetDeployment();
  const cards: Array<[string, string, string, string]> = [
    ["JSON API", "Every token's verdict inputs, wallet groups and proof as static JSON. Free, no key, updated every 15 minutes.", `${BASE}/api/tokens.json`, "Open tokens.json"],
    ["On-chain feed", `Read a token's real-owner numbers from the NunoFeed contract on Monad testnet${dep ? ` (${dep.NunoFeed.slice(0, 8)}…)` : ""}.`, "/developers/#contracts", "See the contract"],
    ["OrganicGate", "One call lets your contract refuse tokens that are mostly held by wallet groups, or whose data is stale.", "/developers/#contracts", "See the example"],
  ];
  return (
    <section className="band-plain px-4 py-16">
      <div className="mx-auto max-w-6xl">
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

export function Home() {
  const meta = api.meta("live");
  const all = rows("live");
  const counts = Object.fromEntries((["red", "amber", "clear"] as Level[]).map((l) => [l, all.filter((r) => r.level === l).length]));
  const range = meta?.window.startTime && meta.window.endTime ? dateRange(meta.window.startTime, meta.window.endTime) : null;
  return (
    <>
      <section className="relative overflow-hidden px-4 pb-6 pt-14 text-center">
        <div className="dots pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl">
          {meta ? <Freshness meta={meta} tokens={all.length} /> : null}
          <h1 className="headline mt-6 text-5xl sm:text-6xl">
            Check a nad.fun Token <span className="fade">Before You Buy</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-[var(--muted)]">
            Nuno shows how many real people own a token and flags tokens run by groups of linked wallets, with public proof for every flag.
          </p>
        </div>
      </section>
      <section id="tokens" className="scroll-mt-16 px-2 pb-6 sm:px-4">
        <div className="card mx-auto max-w-6xl px-5 py-8 sm:px-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">
              {all.length} nad.fun tokens{range ? <span className="font-normal text-[var(--muted)]"> launched {range}</span> : null}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {(["red", "amber", "clear"] as Level[]).map((l, i) => (
                <span key={l}>
                  {i ? " · " : ""}
                  <b className="font-medium text-[var(--text)]">{counts[l]}</b> {LEVEL_LABEL[l].toLowerCase()}
                </span>
              ))}
            </p>
          </div>
          <SortableTable rows={all} base="" limit={25} />
        </div>
      </section>
      <Steps />
      <Build />
    </>
  );
}
