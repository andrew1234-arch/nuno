import Link from "next/link";
import { api, hasDataset, type Cluster, type Token } from "@/lib/api";
import { FINDING_TEXT, PAYOUTS, SEEDER, SEEDER_DEPOSIT } from "@/lib/finding";
import { addrUrl, mon, short, txUrl } from "@/lib/format";
import { SortableTable } from "./sortable";

const n = (v: number) => v.toLocaleString("en-US");
const monNum = (wei: string) => Number(BigInt(wei) / 10n ** 16n) / 100;

function Hero({ tokens, meta }: { tokens: Token[]; meta: ReturnType<typeof api.meta> }) {
  return (
    <section className="relative overflow-hidden px-4 pb-10 pt-16 text-center">
      <div className="dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-3xl">
        {meta ? (
          <span className="pill inline-flex items-center gap-2 bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
            <span className="h-2 w-2 rounded-full bg-[var(--good)]" aria-hidden="true" />
            {n(tokens.length)} nad.fun tokens · mainnet blocks {n(meta.window.startBlock)}–{n(meta.window.endBlock)}
          </span>
        ) : null}
        <h1 className="headline mt-6 text-5xl sm:text-7xl">
          See Who Really <span className="fade">Holds</span>
          <br />
          Every <span className="fade">nad.fun Launch</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[var(--muted)]">
          Wallet farms fake holders and volume. Nuno groups wallets run by the same operator into entities, from on-chain funding, transfer and trading
          evidence, and recomputes every token per entity.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm">
          <a href="#screener" className="pill bg-[var(--accent)] px-6 py-3 font-medium text-[var(--accent-ink)] hover:opacity-90">Open the screener</a>
          <Link href="/methodology/" className="pill border border-[var(--accent)] px-6 py-3 font-medium text-[var(--accent)] hover:bg-[var(--panel)]">Read the methodology</Link>
        </div>
      </div>
    </section>
  );
}

/** Three tiles of real numbers under the hero, like dashboard cards. */
function Tiles({ tokens, largest }: { tokens: Token[]; largest: Cluster | null }) {
  const withM = tokens.filter((t) => t.metrics);
  const gap = [...withM].sort((a, b) => b.metrics!.rawHolders - b.metrics!.realHolders - (a.metrics!.rawHolders - a.metrics!.realHolders))[0];
  const byVol = [...withM].filter((t) => t.metrics!.rawVolume !== "0").sort((a, b) => monNum(b.metrics!.rawVolume) - monNum(a.metrics!.rawVolume)).slice(0, 6);
  const maxVol = byVol.length ? monNum(byVol[0]!.metrics!.rawVolume) : 1;
  if (!gap && !byVol.length && !largest) return null;
  return (
    <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-14 md:grid-cols-3">
      {gap ? (
        <Link href={`/token/${gap.address}/`} className="card block p-5 text-left shadow-sm transition hover:-translate-y-0.5">
          <p className="text-sm text-[var(--muted)]">Largest holder gap</p>
          <p className="mt-3 text-4xl font-medium tracking-tight">
            {gap.metrics!.rawHolders} <span className="text-[var(--soft)]">→</span> {gap.metrics!.realHolders}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">holders, raw → real</p>
          <p className="mt-4 text-sm font-medium text-[var(--accent)]">${gap.symbol} <span className="mono text-xs text-[var(--muted)]">{short(gap.address)}</span></p>
        </Link>
      ) : null}
      {byVol.length ? (
        <div className="card p-5 text-left shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">Volume, raw vs organic</p>
            <span className="flex gap-3 text-[10px] text-[var(--muted)]">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--accent-soft)]" />raw</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--accent)]" />organic</span>
            </span>
          </div>
          <div className="mt-4 flex h-28 items-end justify-between gap-2">
            {byVol.map((t) => {
              const raw = monNum(t.metrics!.rawVolume);
              const org = monNum(t.metrics!.organicVolume);
              return (
                <Link key={t.address} href={`/token/${t.address}/`} className="flex h-full flex-1 flex-col items-center justify-end" title={`${t.symbol}: ${mon(t.metrics!.rawVolume)} MON raw, ${mon(t.metrics!.organicVolume)} MON organic`}>
                  <div className="relative w-full max-w-7 overflow-hidden rounded-full bg-[var(--accent-soft)]" style={{ height: `${Math.max(8, (raw / maxVol) * 100)}%` }}>
                    <div className="absolute bottom-0 w-full rounded-full bg-[var(--accent)]" style={{ height: `${raw ? (org / raw) * 100 : 0}%` }} />
                  </div>
                  <span className="mt-1 max-w-full truncate text-[10px] text-[var(--muted)]">{t.symbol}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
      {largest ? (
        <Link href={`/cluster/${largest.id}/`} className="card block p-5 text-left shadow-sm transition hover:-translate-y-0.5">
          <p className="text-sm text-[var(--muted)]">Largest entity</p>
          <p className="mt-3 text-4xl font-medium tracking-tight">{largest.size} <span className="text-lg text-[var(--muted)]">wallets</span></p>
          <p className="mt-1 text-sm text-[var(--muted)]">created {n(largest.createdTokens.length)} of {n(tokens.length)} tracked tokens</p>
          <div className="mt-4 flex -space-x-2" aria-hidden="true">
            {largest.members.slice(0, 10).map((m, i) => (
              <span key={m} className="h-6 w-6 rounded-full border-2 border-[var(--surface)]" style={{ background: `color-mix(in srgb, var(--accent) ${100 - i * 7}%, var(--surface))` }} />
            ))}
          </div>
        </Link>
      ) : null}
    </section>
  );
}

function FindingBand() {
  return (
    <section className="band-plain px-4 py-20">
      <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[auto_1fr]">
        <span className="select-none text-8xl font-semibold leading-none text-[var(--accent-soft)]" aria-hidden="true">“</span>
        <div>
          <p className="text-3xl font-medium leading-tight tracking-tight sm:text-4xl">{FINDING_TEXT}</p>
          <p className="mt-6 max-w-3xl text-sm text-[var(--accent-soft)]">
            Seeder <a className="mono text-[var(--accent-ink)] hover:underline" href={addrUrl(SEEDER)} target="_blank" rel="noreferrer">{short(SEEDER)}</a> received{" "}
            {n(SEEDER_DEPOSIT.mon)} MON in{" "}
            <a className="mono text-[var(--accent-ink)] hover:underline" href={txUrl(SEEDER_DEPOSIT.tx)} target="_blank" rel="noreferrer">{short(SEEDER_DEPOSIT.tx)}</a>, then sent 14,995 MON to each
            creator wallet:
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PAYOUTS.map((p) => (
              <a key={p.tx} href={txUrl(p.tx)} target="_blank" rel="noreferrer" className="pill mono border border-[var(--accent-soft)] px-3 py-1 text-xs hover:bg-[var(--accent-ink)] hover:text-[var(--accent)]" title={`to ${p.wallet}, block ${n(p.block)}`}>
                {short(p.tx)} → {short(p.wallet)}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function How({ tokens }: { tokens: Token[] }) {
  const steps: Array<[string, string]> = [
    ["Index", "Every nad.fun launch, curve trade, transfer and post-graduation swap, read from Monad mainnet."],
    ["Trace funding", "Who sent each buyer its MON, up to 3 hops back, from archive state and block traces."],
    ["Cluster & recompute", "Wallets linked by weighted evidence become one entity; holders, concentration and volume are recounted per entity."],
  ];
  const top = tokens.filter((t) => t.metrics && t.metrics.rawHolders > 0).sort((a, b) => b.metrics!.rawHolders - a.metrics!.rawHolders).slice(0, 5);
  const max = top.length ? top[0]!.metrics!.rawHolders : 1;
  return (
    <section id="how" className="px-2 py-6 sm:px-4">
      <div className="card mx-auto max-w-6xl px-6 py-14 sm:px-12">
        <div className="grid gap-8 md:grid-cols-2">
          <h2 className="headline text-4xl sm:text-5xl">
            Count Entities, <span className="fade">Not Wallets</span>
          </h2>
          <p className="self-end text-[var(--muted)] md:text-right">
            Raw holder counts and volume are easy to fake with a wallet farm. Every link Nuno draws between two wallets keeps the transactions that justify it.
          </p>
        </div>
        <div className="mt-12 grid gap-10 md:grid-cols-[1fr_1.1fr]">
          <ol className="space-y-6">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--panel)] text-sm font-medium text-[var(--accent)]">{i + 1}</span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          {top.length ? (
            <div className="rounded-2xl bg-[var(--panel)] p-6">
              <div className="flex items-center justify-between">
                <p className="font-medium">Holders, raw vs real</p>
                <span className="pill bg-[var(--accent)] px-3 py-1 text-xs text-[var(--accent-ink)]">top {top.length} by holders</span>
              </div>
              <div className="mt-6 space-y-4">
                {top.map((t) => (
                  <Link key={t.address} href={`/token/${t.address}/`} className="block">
                    <div className="flex justify-between text-xs text-[var(--muted)]">
                      <span>${t.symbol}</span>
                      <span className="tabular-nums">{t.metrics!.rawHolders} → <b className="text-[var(--text)]">{t.metrics!.realHolders}</b></span>
                    </div>
                    <div className="relative mt-1 h-3 rounded-full bg-[var(--line)]">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent-soft)]" style={{ width: `${(t.metrics!.rawHolders / max) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${(t.metrics!.realHolders / max) * 100}%` }} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Stats({ counts }: { counts: Record<string, number> }) {
  const items: Array<[string, string, number | undefined, string]> = [
    ["Tokens", "M2 3h12v2H2zm0 4h12v2H2zm0 4h8v2H2z", counts.tokens, "nad.fun launches in the indexed window"],
    ["Wallets in entities", "M5 4a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM1 13c0-2 2-3 4-3s4 1 4 3zm6 0c0-2 2-3 4-3s4 1 4 3z", counts.walletsInEntities, `grouped into ${n(counts.entities ?? 0)} multi-wallet ${counts.entities === 1 ? "entity" : "entities"}`],
    ["Curve trades", "M2 12l4-4 3 3 5-6v2l-5 6-3-3-4 4z", counts.curveTrades, "buys and sells, attributed to the signing wallet"],
    ["Funding links", "M3 8a5 5 0 0110 0h-2a3 3 0 00-6 0zm4 0h2v5H7z", counts.fundingEdges, "inbound MON transfers traced on archive state"],
  ];
  return (
    <section className="band-plain px-4 py-16">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([label, icon, value, sub], i) => (
          <div key={label} className={i ? "lg:border-l lg:border-dashed lg:border-[var(--accent-soft)] lg:pl-8" : ""}>
            <span className="pill inline-flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--accent-ink)_14%,transparent)] px-2.5 py-1 text-xs">
              <Icon d={icon} /> {label}
            </span>
            <p className="mt-5 text-6xl font-medium tracking-tight">{value === undefined ? "–" : n(value)}</p>
            <p className="mt-3 text-sm text-[var(--accent-soft)]">{sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Screener({ tokens, meta }: { tokens: Token[]; meta: ReturnType<typeof api.meta> }) {
  return (
    <section id="screener" className="scroll-mt-16 px-2 py-6 sm:px-4">
      <div className="card mx-auto max-w-6xl px-5 py-12 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="headline text-4xl sm:text-5xl">
            The <span className="fade">Screener</span>
          </h2>
          {meta ? (
            <p className="mono text-xs text-[var(--muted)]">
              {meta.window.startTime && meta.window.endTime ? `${meta.window.startTime.slice(0, 10)} → ${meta.window.endTime.slice(0, 10)} · ` : ""}
              exported {meta.generatedAt.slice(0, 16).replace("T", " ")} UTC
            </p>
          ) : null}
        </div>
        {hasDataset("contrast") ? (
          <p className="mt-2 text-sm">
            <Link href="/contrast/" className="text-[var(--accent)] hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"} →</Link>
          </p>
        ) : null}
        <SortableTable tokens={tokens} base="" limit={15} />
      </div>
    </section>
  );
}

const FAQ: Array<[string, string]> = [
  [
    "What is an entity?",
    "A group of wallets that are very likely controlled by the same operator. Wallets are linked by weighted evidence: the same funder within 24 hours, a shared funding source, funding by the token's creator, direct token transfers, or trading in the same block. A pair is merged once its evidence adds up to 1.0, so one weak signal never merges wallets on its own.",
  ],
  [
    "How is organic volume calculated?",
    "Volume is grouped per entity. An entity that bought and sold and ended with a near-zero net position counts as wash-like; so do round trips within ~18-minute windows. Entities that only bought or only sold are directional and always count as organic.",
  ],
  [
    "Where does the data come from?",
    "Monad mainnet only, read-only: nad.fun's curve events (both its documented V1 curve and its V2 curve), ERC-20 transfers, Uniswap V3 swaps after graduation, and funding history from archive state and block traces.",
  ],
  [
    "Can apps and contracts use these numbers?",
    "Yes. The same data is published as a static JSON API, and snapshots go to the NunoFeed contract on Monad testnet. OrganicGate is an example contract that reverts when a token's cluster-held supply is too high or the data is stale.",
  ],
  [
    "How accurate is it?",
    "There is no labelled ground truth for nad.fun. Clusters are probabilistic, and every link shows the transactions behind it so you can check it on a Monad explorer. Accuracy is only claimed for the hand-reviewed sample in the repository's validation document.",
  ],
];

function Faq() {
  return (
    <section id="faq" className="band scroll-mt-16 px-4 py-20">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="headline text-4xl sm:text-5xl">
          Questions Worth <span className="fade">Asking.</span>
        </h2>
        <p className="mt-3 text-sm text-[var(--accent-soft)]">Before trusting a holder count</p>
      </div>
      <div className="card mx-auto mt-10 max-w-3xl px-6 py-4 text-[var(--text)] sm:px-10">
        {FAQ.map(([q, a], i) => (
          <details key={q} className="faq border-b border-[var(--line)] py-5 last:border-0" open={i === 0}>
            <summary className="flex items-center justify-between gap-4 text-lg">
              {q}
              <span className="icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--panel)] text-xl" aria-hidden="true" />
            </summary>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--muted)]">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function Landing() {
  const meta = api.meta("live");
  const tokens = api.tokens("live");
  const clusters = api.clusterIds("live").map((id) => api.cluster(id, "live")).filter((c): c is Cluster => c !== null);
  const largest = clusters.sort((a, b) => b.size - a.size)[0] ?? null;
  return (
    <>
      <Hero tokens={tokens} meta={meta} />
      <Tiles tokens={tokens} largest={largest} />
      <FindingBand />
      <How tokens={tokens} />
      {meta ? <Stats counts={meta.counts} /> : null}
      <Screener tokens={tokens} meta={meta} />
      <Faq />
    </>
  );
}
