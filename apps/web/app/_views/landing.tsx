import Link from "next/link";
import { api, hasDataset, type Cluster, type Token } from "@/lib/api";
import { PAYOUTS, SEEDER, SEEDER_DEPOSIT, computeFinding, type Finding } from "@/lib/finding";
import { addrUrl, mon, short, txUrl } from "@/lib/format";
import { SortableTable } from "./sortable";

const n = (v: number) => v.toLocaleString("en-US");
const monNum = (wei: string) => Number(BigInt(wei) / 10n ** 16n) / 100;

/** Data freshness badge: when the last indexed block was produced, and how far behind the chain it was at export. */
function Freshness({ meta, tokens }: { meta: NonNullable<ReturnType<typeof api.meta>>; tokens: number }) {
  // ~0.302 s per block (measured); more than 30 minutes behind is shown as stale.
  const behindMin = meta.behindBlocks === undefined ? null : Math.round((meta.behindBlocks * 0.302) / 60);
  const stale = behindMin !== null && behindMin > 30;
  const asOf = meta.sourceTime ? `${meta.sourceTime.slice(0, 16).replace("T", " ")} UTC` : `block ${n(meta.window.endBlock)}`;
  return (
    <span className="pill inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
      <span className={`h-2 w-2 rounded-full ${stale ? "bg-[var(--unknown)]" : "bg-[var(--accent)]"}`} aria-hidden="true" />
      {n(tokens)} nad.fun tokens checked · data as of {asOf}
      {behindMin !== null && behindMin > 1 ? <span className={stale ? "font-medium text-[var(--text)]" : ""}>· {behindMin < 120 ? `${behindMin} min` : `${Math.round(behindMin / 60)} h`} behind the live chain</span> : null}
    </span>
  );
}

function Hero({ tokens, meta }: { tokens: Token[]; meta: ReturnType<typeof api.meta> }) {
  return (
    <section className="relative overflow-hidden px-4 pb-10 pt-16 text-center">
      <div className="dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-3xl">
        {meta ? <Freshness meta={meta} tokens={tokens.length} /> : null}
        <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-[var(--accent-text)]">Wallet-cluster detector for nad.fun</p>
        <h1 className="headline mt-3 text-5xl sm:text-7xl">
          How Many People <span className="fade">Really</span>
          <br />
          Own <span className="fade">This Token?</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-[var(--muted)]">
          <b className="font-medium text-[var(--text)]">Nuno is a wallet-cluster detector for nad.fun tokens on Monad.</b> A wallet cluster is a group of
          wallets run by one person, often used to make a new token look more popular than it is. Nuno finds these clusters and shows how many real people
          are behind each token.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--muted)]">
          Under the hood: it reads the public Monad blockchain and publishes its results as open data that apps and smart contracts can use.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm">
          <a href="#screener" className="pill bg-[var(--accent)] px-6 py-3 font-medium text-[var(--accent-ink)] hover:opacity-90">See the tokens</a>
          <a href="#how" className="pill border border-[var(--accent)] px-6 py-3 font-medium text-[var(--accent-text)] hover:bg-[var(--panel)]">How it works</a>
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
          <p className="text-sm text-[var(--muted)]">Biggest gap between looks and reality</p>
          <p className="mt-3 text-4xl font-medium tracking-tight">
            {gap.metrics!.rawHolders} <span className="text-[var(--soft)]">→</span> {gap.metrics!.realHolders}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">holders shown → real owners</p>
          <p className="mt-4 text-sm font-medium text-[var(--accent-text)]">${gap.symbol} <span className="mono text-xs text-[var(--muted)]">{short(gap.address)}</span></p>
        </Link>
      ) : null}
      {byVol.length ? (
        <div className="card p-5 text-left shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted)]">Trading: all vs by holders</p>
            <span className="flex gap-3 text-[10px] text-[var(--muted)]">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--soft)]" />all</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--organic)]" />by holders</span>
            </span>
          </div>
          <div className="mt-4 flex h-28 items-end justify-between gap-2">
            {byVol.map((t) => {
              const raw = monNum(t.metrics!.rawVolume);
              const org = monNum(t.metrics!.organicVolume);
              return (
                <Link key={t.address} href={`/token/${t.address}/`} className="flex h-full flex-1 flex-col items-center justify-end" title={`${t.symbol}: ${mon(t.metrics!.rawVolume)} MON traded, of which ${mon(t.metrics!.organicVolume)} MON by owners who kept their tokens`}>
                  <div className="relative w-full max-w-7 overflow-hidden rounded-full bg-[var(--soft)]" style={{ height: `${Math.max(8, (raw / maxVol) * 100)}%` }}>
                    <div className="absolute bottom-0 w-full rounded-full bg-[var(--organic)]" style={{ height: `${raw ? (org / raw) * 100 : 0}%` }} />
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
          <p className="text-sm text-[var(--muted)]">Biggest group found</p>
          <p className="mt-3 text-4xl font-medium tracking-tight">{largest.size} <span className="text-lg text-[var(--muted)]">wallets, one owner</span></p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {largest.createdTokens.length ? `launched ${n(largest.createdTokens.length)} of the ${n(tokens.length)} tokens checked` : "trading across the tokens checked"}
          </p>
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

function FindingBand({ finding }: { finding: Finding }) {
  return (
    <section className="band-plain px-4 py-20">
      <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[auto_1fr]">
        <span className="select-none text-8xl font-semibold leading-none text-[var(--accent-text)]" aria-hidden="true">“</span>
        <div>
          <p className="text-3xl font-medium leading-tight tracking-tight sm:text-4xl">{finding.headline}</p>
          <p className="mt-4 text-lg text-[var(--accent-soft)]">{finding.sub}</p>
          {finding.seeded ? (
            <>
              <p className="mt-6 max-w-3xl text-sm text-[var(--accent-soft)]">
                How we know: one wallet,{" "}
                <a className="mono text-[var(--accent-ink)] hover:underline" href={addrUrl(SEEDER)} target="_blank" rel="noreferrer">{short(SEEDER)}</a>, received{" "}
                {n(SEEDER_DEPOSIT.mon)} MON (
                <a className="mono text-[var(--accent-ink)] hover:underline" href={txUrl(SEEDER_DEPOSIT.tx)} target="_blank" rel="noreferrer">proof</a>), then sent 14,995 MON to
                each of the 10 launching wallets within 17 seconds. Every payment below is public; click one to see it on the Monad explorer.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {PAYOUTS.map((p) => (
                  <a key={p.tx} href={txUrl(p.tx)} target="_blank" rel="noreferrer" className="pill mono border border-[var(--accent-soft)] px-3 py-1 text-xs hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--c-accent-ink)]" title={`to ${p.wallet}, block ${n(p.block)}`}>
                    {short(p.tx)} → {short(p.wallet)}
                  </a>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function How({ tokens }: { tokens: Token[] }) {
  const steps: Array<[string, string]> = [
    ["Watch every launch", "Nuno follows every new token on nad.fun, and every buy, sell and transfer of it, straight from the public Monad blockchain."],
    [
      "Follow the money",
      "For each buyer, it looks at where their money came from. Fresh wallets topped up by the same source at the same time, or that buy and sell at the exact same moment, are usually run by one person.",
    ],
    [
      "Count people, not wallets",
      "Wallets that belong together become one group. Holders are then recounted, so 50 wallets owned by one person count as one owner. Trading is split into trading by people who kept their tokens and quick in-and-out trading.",
    ],
  ];
  const top = tokens.filter((t) => t.metrics && t.metrics.rawHolders > 0).sort((a, b) => b.metrics!.rawHolders - a.metrics!.rawHolders).slice(0, 5);
  const max = top.length ? top[0]!.metrics!.rawHolders : 1;
  return (
    <section id="how" className="px-2 py-6 sm:px-4">
      <div className="card mx-auto max-w-6xl px-6 py-14 sm:px-12">
        <div className="grid gap-8 md:grid-cols-2">
          <h2 className="headline text-4xl sm:text-5xl">
            Count People, <span className="fade">Not Wallets</span>
          </h2>
          <div className="self-end space-y-3 text-[var(--muted)] md:text-right">
            <p>
              <b className="text-[var(--text)]">Why it matters.</b> A token that shows 200 holders and lots of trading looks like a hit, so people buy in. If 150 of
              those wallets belong to the creator, the token is far riskier than it looks. Price trackers, launchpads and trading bots all read those numbers.
            </p>
            <p>Nuno gives them honest ones, and shows its proof for every claim.</p>
          </div>
        </div>
        <div className="mt-12 grid gap-10 md:grid-cols-[1fr_1.1fr]">
          <ol className="space-y-6">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--panel)] text-sm font-medium text-[var(--accent-text)]">{i + 1}</span>
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
                <p className="font-medium">Holders shown vs real owners</p>
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
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--soft)]" style={{ width: `${(t.metrics!.rawHolders / max) * 100}%` }} />
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
    ["Tokens checked", "M2 3h12v2H2zm0 4h12v2H2zm0 4h8v2H2z", counts.tokens, "every nad.fun launch in the last week"],
    ["Wallets in groups", "M5 4a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM1 13c0-2 2-3 4-3s4 1 4 3zm6 0c0-2 2-3 4-3s4 1 4 3z", counts.walletsInEntities, `that belong to just ${n(counts.entities ?? 0)} ${counts.entities === 1 ? "owner" : "owners"}`],
    ["Trades checked", "M2 12l4-4 3 3 5-6v2l-5 6-3-3-4 4z", counts.curveTrades, "every buy and sell on nad.fun"],
    ["Money trails traced", "M3 8a5 5 0 0110 0h-2a3 3 0 00-6 0zm4 0h2v5H7z", counts.fundingEdges, "payments that show who funded whom"],
  ];
  return (
    <section className="band-plain px-4 py-16">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([label, icon, value, sub], i) => (
          <div key={label} className={i ? "lg:border-l lg:border-dashed lg:border-[var(--accent-soft)] lg:pl-8" : ""}>
            <span className="pill inline-flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--accent-ink)_14%,transparent)] px-2.5 py-1 text-xs">
              <Icon d={icon} /> {label}
            </span>
            <p className="mt-5 text-6xl font-medium tracking-tight text-[var(--accent-text)]">{value === undefined ? "–" : n(value)}</p>
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
          <div>
            <h2 className="headline text-4xl sm:text-5xl">
              Every <span className="fade">Token</span>
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
              Each row shows what a token looks like (grey) next to what Nuno found (bold). A big gap in holders means many of its &quot;holders&quot; are
              the same people. Click a token to see who is behind it and the proof.
            </p>
          </div>
          {meta ? (
            <p className="mono text-xs text-[var(--muted)]">
              {meta.window.startTime && meta.window.endTime ? `${meta.window.startTime.slice(0, 10)} → ${meta.window.endTime.slice(0, 10)} · ` : ""}
              exported {meta.generatedAt.slice(0, 16).replace("T", " ")} UTC
            </p>
          ) : null}
        </div>
        {hasDataset("contrast") ? (
          <p className="mt-2 text-sm">
            <Link href="/contrast/" className="text-[var(--accent-text)] hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"} →</Link>
          </p>
        ) : null}
        <SortableTable tokens={tokens} base="" limit={15} />
      </div>
    </section>
  );
}

const FAQ: Array<[string, string]> = [
  [
    "What problem does Nuno solve?",
    "New tokens are judged by how many people hold them and how much they are traded. Both numbers are easy to fake: one person can spread money over many wallets and trade with themselves. Nuno works out which wallets belong to the same person, so the numbers you see reflect real people.",
  ],
  [
    "How can you tell two wallets belong to the same person?",
    "By following the money and the timing. Wallets that were filled up by the same source within a short time, that send the token to each other, or that buy and sell at the exact same moment are almost always run together. One weak hint is never enough on its own: Nuno needs strong evidence, or several hints that point the same way.",
  ],
  [
    "What does \"trading by holders\" mean?",
    "It is the trading done by owners who kept their tokens. When an owner buys and later sells almost everything, or trades in and out within minutes, that trading is counted separately. This catches bots that trade with themselves to look busy, but also ordinary traders who flip a token for profit, so a low number means \"lots of in-and-out trading\", not necessarily cheating.",
  ],
  [
    "Can I check the proof myself?",
    "Yes. Every link between two wallets comes with the public transaction that shows it. Click any of them to open it on the Monad block explorer. Nothing here relies on private data.",
  ],
  [
    "Is it always right?",
    "No tool is. Some shared services, like exchanges, send money to many unrelated people; Nuno recognises busy services like these and ignores them as links, but it can still make mistakes. That is why every link shows its proof, and why the results are called likely, not certain.",
  ],
  [
    "Who is it for?",
    "Anyone deciding whether a new token is what it seems: traders, token trackers, launchpads and trading bots. Apps can download the numbers for free, and smart contracts can read them directly from the Monad network.",
  ],
];

function Faq() {
  return (
    <section id="faq" className="band scroll-mt-16 px-4 py-20">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="headline text-4xl sm:text-5xl">
          Questions, <span className="fade">Answered.</span>
        </h2>
        <p className="mt-3 text-sm text-[var(--accent-soft)]">In plain words</p>
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
  const largest = [...clusters].sort((a, b) => b.size - a.size)[0] ?? null;
  const finding = meta ? computeFinding(meta, tokens, clusters) : null;
  return (
    <>
      <Hero tokens={tokens} meta={meta} />
      <Tiles tokens={tokens} largest={largest} />
      {finding ? <FindingBand finding={finding} /> : null}
      <How tokens={tokens} />
      {meta ? <Stats counts={meta.counts} /> : null}
      <Screener tokens={tokens} meta={meta} />
      <Faq />
    </>
  );
}
