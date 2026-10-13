import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Dataset, type Token, type Wallet } from "@/lib/api";
import { EDGE_REASON, addrUrl, short, txUrl } from "@/lib/format";
import { ClusterGraph } from "../graph";
import { EvidenceTable } from "../evidence";
import { baseFor } from "./screener";

/** Page title and description for a wallet-group page (historical pages say so). */
export function clusterMetadata(id: string, dataset: Dataset): Metadata {
  const c = api.cluster(id, dataset);
  if (!c) return { title: "Group not found" };
  const name = `Entity #${c.id.slice(2, 8)}`;
  return dataset === "contrast"
    ? { title: `${name}, historical week`, description: `${c.size} wallets that very likely belonged to one owner during a past week, with the public proof.` }
    : { title: name, description: `${c.size} wallets that very likely belong to one owner, with the public proof.` };
}

export const clusterParams = (d: Dataset) => api.clusterIds(d).map((id) => ({ id }));

const MON = 10n ** 18n;
const monStr = (wei: bigint) => (wei >= MON * 1000n ? `${(Number(wei / MON) / 1000).toFixed(1)}k` : (Number(wei / 10n ** 16n) / 100).toLocaleString("en-US"));
const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ");

export function ClusterView({ id, dataset }: { id: string; dataset: Dataset }) {
  const c = api.cluster(id, dataset);
  if (!c) notFound();
  const base = baseFor(dataset);
  const types = [...new Set(c.links.map((l) => l.type))];
  const label = `#${c.id.slice(2, 8)}`;
  const wallets = c.members.map((m) => api.wallet(m, dataset)).filter((w): w is Wallet => w !== null);
  const funding = wallets.flatMap((w) => w.fundedBy.filter((f) => f.wallet === w.address));
  const totalIn = funding.reduce((t, f) => t + BigInt(f.value), 0n);
  const tokenSet = new Map<string, Token>(api.tokens(dataset).map((t) => [t.address, t]));
  const touched = new Set<string>([...c.createdTokens, ...wallets.flatMap((w) => w.trades.map((t) => t.token))].filter((t) => tokenSet.has(t)));
  const creators = new Set(c.createdTokens.map((t) => tokenSet.get(t)?.creator).filter(Boolean));
  const evidenceCount = (m: string) => c.links.filter((l) => l.a === m || l.b === m).reduce((t, l) => t + l.evidence.length, 0);
  const evBlocks = c.links.flatMap((l) => l.evidence.map((e) => e.block));
  const times = funding.map((f) => f.blockTime).filter((t) => t > 0);
  const launchTimes = c.createdTokens.map((t) => api.links(t, dataset).createdAt).filter((t): t is string => Boolean(t)).map((t) => Date.parse(t) / 1000);
  const allTimes = [...times, ...launchTimes];
  const first = allTimes.length ? Math.min(...allTimes) : null;
  const last = allTimes.length ? Math.max(...allTimes) : null;
  // Funding trail: origin → direct funder → members, one row per funder.
  const byFunder = new Map<string, { origin: string | null; wallets: Set<string>; value: bigint; first: number; last: number; tx: string }>();
  for (const f of funding) {
    const r = byFunder.get(f.funder) ?? { origin: f.origin, wallets: new Set<string>(), value: 0n, first: f.blockTime, last: f.blockTime, tx: f.txHash };
    r.wallets.add(f.wallet);
    r.value += BigInt(f.value);
    r.first = Math.min(r.first, f.blockTime);
    r.last = Math.max(r.last, f.blockTime);
    byFunder.set(f.funder, r);
  }
  const trail = [...byFunder].sort((a, b) => b[1].wallets.size - a[1].wallets.size);
  const tiles: Array<[string, string, string]> = [
    ["Member wallets", c.size.toLocaleString("en-US"), `linked by ${c.links.length.toLocaleString("en-US")} evidence links`],
    ["Tokens launched / touched", `${c.createdTokens.length} / ${touched.size}`, "launched by members / bought, sold or launched"],
    ["Funding received", `${monStr(totalIn)} MON`, `${funding.length} first-funding payments into members`],
    ["First / last seen", first ? `${day(first).slice(5, 10)} → ${day(last!).slice(5, 10)}` : evBlocks.length ? `block ${Math.min(...evBlocks).toLocaleString("en-US")}` : "–", first ? `${day(first)} → ${day(last!)} UTC` : "funding times not resolved"],
  ];
  // Timeline strip positions.
  const span = first !== null && last !== null && last > first ? last - first : 1;
  const x = (t: number) => `${((t - (first ?? t)) / span) * 100}%`;

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {dataset === "contrast" ? (
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
          <Link href="/contrast/" className="hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"}</Link>
        </p>
      ) : null}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Entity <span className="mono">{label}</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          {c.size} wallets treated as one actor. Linked because they {types.map((t) => EDGE_REASON[t] ?? t).join(", ")}. Checked up to Monad block{" "}
          <span className="mono">{c.sourceBlock.toLocaleString("en-US")}</span>. <Link href="/methodology/#m-3-entity-resolution-clustering" className="text-[var(--accent-text)] underline">How entities are formed</Link>
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] lg:grid-cols-4">
        {tiles.map(([k, v, note]) => (
          <div key={k} className="bg-[var(--surface)] p-4">
            <dt className="text-xs text-[var(--muted)]">{k}</dt>
            <dd className="tabular mt-1 text-xl font-semibold tracking-tight">{v}</dd>
            <dd className="mt-1 text-xs text-[var(--muted)]">{note}</dd>
          </div>
        ))}
      </dl>

      {first !== null && last !== null ? (
        <section aria-labelledby="tl">
          <h2 id="tl" className="text-sm font-medium">Timeline</h2>
          <div className="relative mt-3 h-10 rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <div className="absolute inset-x-3 top-1/2 h-px bg-[var(--line)]" />
            <div className="absolute inset-x-3 inset-y-0">
              {times.map((t, i) => (
                <span key={`f${i}`} className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--unknown)]" style={{ left: x(t) }} title={`funding ${day(t)} UTC`} />
              ))}
              {launchTimes.map((t, i) => (
                <span key={`l${i}`} className="absolute top-1 h-8 w-0.5 -translate-x-1/2 bg-[var(--flag)]" style={{ left: x(t) }} title={`launch ${day(t)} UTC`} />
              ))}
            </div>
          </div>
          <p className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-[var(--muted)]">
            <span>{day(first)} UTC</span>
            <span className="flex gap-3">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--unknown)]" /> funding ({times.length})</span>
              <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-[var(--flag)]" /> launch ({launchTimes.length})</span>
            </span>
            <span>{day(last)} UTC</span>
          </p>
        </section>
      ) : null}

      <section aria-labelledby="trail">
        <h2 id="trail" className="text-sm font-medium">Funding trail</h2>
        <p className="text-xs text-[var(--muted)]">Where members&apos; first funding came from: source → direct funder → member wallets.</p>
        {trail.length ? (
          <div className="mt-3 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-xs text-[var(--muted)]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Source</th><th />
                  <th className="px-3 font-medium">Direct funder</th><th />
                  <th className="px-3 text-right font-medium">Members funded</th>
                  <th className="px-3 text-right font-medium">MON</th>
                  <th className="px-3 font-medium">When (UTC)</th>
                  <th className="px-3 font-medium">Example tx</th>
                </tr>
              </thead>
              <tbody>
                {trail.slice(0, 25).map(([funder, r]) => (
                  <tr key={funder} className="border-t border-[var(--line)]">
                    <td className="mono px-3 py-2 text-xs">{r.origin && r.origin !== funder ? <a href={addrUrl(r.origin)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">{short(r.origin)}</a> : <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="text-[var(--soft)]">→</td>
                    <td className="mono px-3 text-xs">
                      <a href={addrUrl(funder)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">{short(funder)}</a>
                      {c.members.includes(funder) ? <span className="ml-1 text-[var(--flag)]">(member)</span> : null}
                    </td>
                    <td className="text-[var(--soft)]">→</td>
                    <td className="px-3 text-right">{r.wallets.size}</td>
                    <td className="px-3 text-right">{monStr(r.value)}</td>
                    <td className="px-3 text-xs text-[var(--muted)]">{r.first ? (r.first === r.last ? day(r.first) : `${day(r.first)} → ${day(r.last).slice(11)}`) : "–"}</td>
                    <td className="mono px-3 text-xs"><a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] hover:underline">{short(r.tx)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trail.length > 25 ? <p className="px-3 py-2 text-xs text-[var(--muted)]">{trail.length - 25} more funders not shown.</p> : null}
          </div>
        ) : (
          <p className="mt-2 rounded-md border border-[var(--line)] p-3 text-sm text-[var(--muted)]">No resolved funding for these wallets yet.</p>
        )}
      </section>

      <section aria-labelledby="graph">
        <h2 id="graph" className="text-sm font-medium">Graph</h2>
        <div className="mt-3"><ClusterGraph cluster={c} /></div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="members">
          <h2 id="members" className="text-sm font-medium">Member wallets ({c.size})</h2>
          <div className="mt-3 max-h-[28rem] overflow-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--surface)] text-xs text-[var(--muted)]">
                <tr className="text-left"><th className="px-3 py-2 font-medium">Address</th><th className="px-3 font-medium">Role</th><th className="px-3 text-right font-medium">Tokens</th><th className="px-3 text-right font-medium">Evidence</th></tr>
              </thead>
              <tbody>
                {c.members.map((m) => {
                  const w = wallets.find((x) => x.address === m);
                  const role = creators.has(m) ? "creator" : w?.trades.some((t) => t.buys > 0) ? "buyer" : "linked";
                  return (
                    <tr key={m} className="border-t border-[var(--line)]">
                      <td className="mono px-3 py-1.5 text-xs"><a href={addrUrl(m)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">{short(m)}</a>{c.labels?.[m] ? <span className="ml-1 text-[var(--muted)]">({c.labels[m]!.label})</span> : null}</td>
                      <td className={`px-3 text-xs ${role === "creator" ? "text-[var(--flag)]" : "text-[var(--muted)]"}`}>{role}</td>
                      <td className="px-3 text-right">{w?.trades.length ?? 0}</td>
                      <td className="px-3 text-right">{evidenceCount(m)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section aria-labelledby="tokens">
          <h2 id="tokens" className="text-sm font-medium">Tokens ({touched.size})</h2>
          <div className="mt-3 max-h-[28rem] overflow-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--surface)] text-xs text-[var(--muted)]">
                <tr className="text-left"><th className="px-3 py-2 font-medium">Token</th><th className="px-3 font-medium">Relation</th><th className="px-3 text-right font-medium">Holders raw → real</th></tr>
              </thead>
              <tbody>
                {[...touched].map((t) => tokenSet.get(t)!).sort((a, b) => Number(c.createdTokens.includes(b.address)) - Number(c.createdTokens.includes(a.address))).map((t) => (
                  <tr key={t.address} className="border-t border-[var(--line)]">
                    <td className="px-3 py-1.5"><Link href={`${base}/token/${t.address}/`} className="font-medium hover:text-[var(--accent-text)]">{t.symbol}</Link> <span className="mono text-xs text-[var(--muted)]">{short(t.address)}</span></td>
                    <td className="px-3 text-xs text-[var(--muted)]">{c.createdTokens.includes(t.address) ? "launched" : "traded"}</td>
                    <td className="px-3 text-right">{t.metrics ? `${t.metrics.rawHolders} → ${t.metrics.realHolders}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {touched.size === 0 ? <p className="p-3 text-sm text-[var(--muted)]">No tokens in this window.</p> : null}
          </div>
        </section>
      </div>

      <section aria-labelledby="ev">
        <h2 id="ev" className="text-sm font-medium">Evidence</h2>
        <p className="text-xs text-[var(--muted)]">Every line is one piece of proof; each transaction opens on Monadscan.</p>
        <div className="mt-3"><EvidenceTable cluster={c} limit={2000} base={base} /></div>
      </section>
    </div>
  );
}
