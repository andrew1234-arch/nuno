import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Dataset } from "@/lib/api";
import { addrUrl, mon, pct, short, txUrl } from "@/lib/format";
import { ClusterGraph } from "../graph";
import { EvidenceTable } from "../evidence";
import { LEVEL_HINT, verdict } from "@/lib/verdict";
import { Badge } from "./badge";
import { TokenLogo } from "./token-logo";
import { CopyButton } from "./copy";
import { testnetDeployment } from "@/lib/deployments";
import { baseFor } from "./screener";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Page title and description for a token page (historical pages say so). */
export function tokenMetadata(address: string, dataset: Dataset): Metadata {
  const t = api.token(address, dataset);
  if (!t) return { title: "Token not found" };
  const name = `${t.name} ($${t.symbol})`;
  return dataset === "contrast"
    ? { title: `${name}, historical week`, description: `Who owned ${name} during a past week on nad.fun, with the public proof. Not updated.` }
    : { title: name, description: `Who really owns ${name} on nad.fun: real owners, wallet groups and the public proof.` };
}

export const tokenParams = (d: Dataset) => api.tokens(d).map((t) => ({ address: t.address }));

function Pair({ label, raw, real, note, href }: { label: string; raw: string | null; real: string; note: string; href: string }) {
  return (
    <div className="bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--muted)]">
        {label} <Link href={href} aria-label={`Definition of ${label}`} className="text-[var(--soft)] hover:text-[var(--accent-text)]">ⓘ</Link>
      </p>
      <p className="tabular mt-1 text-xl font-semibold tracking-tight">
        {raw !== null ? <><span className="font-normal text-[var(--muted)]">{raw}</span> <span className="text-[var(--soft)]">→</span> </> : null}
        {real}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">{note}</p>
    </div>
  );
}

const DEF = "/methodology/#m-4-metrics-per-token";

export function TokenView({ address, dataset }: { address: string; dataset: Dataset }) {
  const token = api.token(address, dataset);
  if (!token) notFound();
  const base = baseFor(dataset);
  const clusters = token.clusters ?? [];
  const m = token.metrics;
  const snap = token.latestSnapshot;
  const v = verdict(token, dataset);
  const links = api.links(token.address, dataset);
  // The creator's cluster first, then the biggest.
  const groups = [...clusters].sort((a, b) => Number(b.members.includes(token.creator)) - Number(a.members.includes(token.creator)) || b.size - a.size);
  const created = links.createdAt ? `${links.createdAt.slice(0, 16).replace("T", " ")} UTC` : `block ${token.createBlock.toLocaleString("en-US")}`;
  const dep = testnetDeployment();
  const clusterBps = m?.clusterSupplyBps ?? 0;

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {dataset === "contrast" ? (
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
          <Link href="/contrast/" className="hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"}</Link>
        </p>
      ) : null}

      {/* 4a. Header */}
      <header className="flex flex-wrap items-start gap-4">
        <TokenLogo src={links.image} symbol={token.symbol} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{token.name}</h1>
            <span className="text-lg text-[var(--muted)]">${token.symbol}</span>
            {links.curve ? <span className="mono rounded border border-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--muted)]">curve {links.curve}</span> : null}
            <span className="rounded border border-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--muted)]">{token.graduatedPool ? "graduated to DEX" : "on bonding curve"}</span>
            <Badge level={v.level} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
            <span className="flex items-center gap-1.5">
              <span className="mono text-[var(--text)]">{token.address}</span>
              <CopyButton text={token.address} />
              <a href={addrUrl(token.address)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">Monadscan ↗</a>
            </span>
            <span>
              created <a href={txUrl(token.createTx)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">{created}</a>
            </span>
            <span>
              creator <a href={addrUrl(token.creator)} target="_blank" rel="noreferrer" className="mono hover:text-[var(--accent-text)]">{short(token.creator)}</a>
              {v.creatorGroup ? (
                <> · <Link href={`${base}/cluster/${v.creatorGroup.id}/`} className="mono text-[var(--accent-text)] hover:underline">entity #{v.creatorGroup.id.slice(2, 8)}</Link> ({v.creatorGroup.size} wallets)</>
              ) : <> · not in a cluster</>}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {([[`https://nad.fun/tokens/${token.address}`, "nad.fun"], [links.twitter, "X"], [links.telegram, "Telegram"], [links.website, "Website"]] as Array<[string | null | undefined, string]>)
              .filter((x): x is [string, string] => Boolean(x[0]))
              .map(([href, label]) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="rounded-md border border-[var(--line)] px-2.5 py-1 hover:border-[var(--accent)] hover:text-[var(--accent-text)]">{label} ↗</a>
              ))}
          </div>
        </div>
      </header>

      {/* What was found */}
      {v.flags.length ? (
        <ul className="space-y-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
          {v.flags.map((f) => (
            <li key={f.text} className="flex gap-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.level === "red" ? "bg-[var(--flag)]" : "bg-[var(--c-accent)]"}`} aria-hidden="true" />
              <span>{f.text}</span>
            </li>
          ))}
          <li className="pt-1 text-xs text-[var(--muted)]">
            {LEVEL_HINT[v.level]} <Link href="/methodology/#labels" className="text-[var(--accent-text)] underline">How labels are decided</Link>
          </li>
        </ul>
      ) : null}

      {/* 4b. Raw vs real */}
      {m ? (
        <section aria-label="Raw vs real">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] lg:grid-cols-4">
            <Pair label="Holders" raw={String(m.rawHolders)} real={String(m.realHolders)} note="wallets → real owners (entities counted once)" href={DEF} />
            <Pair label="Volume (MON)" raw={mon(m.rawVolume)} real={mon(m.organicVolume)} note={`all → organic (${m.rawVolume === "0" ? "–" : pct(m.organicVolumeBps)} organic)`} href={DEF} />
            <Pair label="Top-10 concentration" raw={null} real={pct(m.effectiveTop10Bps)} note="top 10 owners, entities counted once (adjusted only)" href={DEF} />
            <Pair label="Creator-linked supply" raw={null} real={pct(m.creatorLinkedSupplyBps)} note="creator and every wallet linked to them" href={DEF} />
          </div>
          {/* 4c. Supply composition */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs text-[var(--muted)]">
              <span>Supply composition</span>
              <span className="tabular">clusters {pct(clusterBps)} · everyone else, incl. curve and pool {pct(10_000 - clusterBps)}</span>
            </div>
            <div className="mt-1.5 flex h-3 overflow-hidden rounded-sm bg-[var(--line)]" role="img" aria-label={`Clusters hold ${pct(clusterBps)} of supply`}>
              <span className="h-full" style={{ width: `${clusterBps / 100}%`, minWidth: clusterBps ? 2 : 0, background: "var(--flag)" }} title={`Clusters: ${pct(clusterBps)}`} />
              <span className="h-full flex-1" style={{ background: "var(--unknown)", opacity: 0.45 }} title={`Everyone else: ${pct(10_000 - clusterBps)}`} />
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">Per-cluster shares and the curve&apos;s own balance are not exported yet, so the bar shows clusters against everyone else.</p>
          </div>
        </section>
      ) : (
        <p className="rounded-md border border-[var(--line)] p-4 text-[var(--muted)]">{token.pruned ? "Too few buyers to analyse this token in detail." : "Data pending."}</p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 4d + 4e. Clusters: graph and evidence */}
        <section id="groups" className="min-w-0 scroll-mt-28">
          <h2 className="text-lg font-semibold">Clusters trading this token ({clusters.length})</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Each cluster is a set of wallets linked by on-chain evidence. Entity IDs stay the same across tokens.</p>
          <div className="mt-4 space-y-4">
            {groups.map((c, i) => (
              <details key={c.id} open={i === 0} className="faq rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    Entity <span className="mono">#{c.id.slice(2, 8)}</span> · {c.size} wallets
                    {c.members.includes(token.creator) ? <span className="ml-2 text-xs font-normal text-[var(--flag)]">includes the creator</span> : null}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-[var(--muted)]">
                    {c.createdTokens.length ? `launched ${c.createdTokens.length} token${c.createdTokens.length > 1 ? "s" : ""}` : null}
                    <span className="icon flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--panel)]" aria-hidden="true" />
                  </span>
                </summary>
                <div className="mt-4">
                  <ClusterGraph cluster={c} highlight={token.creator} />
                </div>
                <h3 className="mt-5 text-sm font-medium">Evidence</h3>
                <div className="mt-2">
                  <EvidenceTable cluster={c} limit={10} base={base} />
                </div>
                <Link href={`${base}/cluster/${c.id}/`} className="mt-3 inline-block text-sm text-[var(--accent-text)] hover:underline">
                  Open entity #{c.id.slice(2, 8)} →
                </Link>
              </details>
            ))}
            {clusters.length === 0 ? <p className="rounded-md border border-[var(--line)] p-4 text-[var(--muted)]">No clusters detected among this token&apos;s buyers and holders.</p> : null}
          </div>
        </section>

        <aside className="space-y-4">
          {/* 4f. On-chain snapshot */}
          {dataset === "live" ? (
            <section className="rounded-md border border-[var(--accent)] bg-[var(--surface)] p-4 text-sm" aria-labelledby="snap">
              <h2 id="snap" className="font-semibold">On-chain snapshot</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Published to NunoFeed on Monad testnet{dep ? <> (<a className="mono hover:text-[var(--accent-text)]" href={addrUrl(dep.NunoFeed, dep.chainId)} target="_blank" rel="noreferrer">{short(dep.NunoFeed)}</a>)</> : null}.
              </p>
              {snap ? (
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Publish tx</dt><dd><a className="mono text-[var(--accent-text)] hover:underline" href={txUrl(snap.txHash, snap.chainId)} target="_blank" rel="noreferrer">{short(snap.txHash)}</a></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Published</dt><dd className="tabular">{snap.publishedAt.slice(0, 16).replace("T", " ")} UTC</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Mainnet block</dt><dd className="mono">{snap.sourceBlock.toLocaleString("en-US")}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Gas used</dt><dd className="mono">{Number(snap.gasUsed).toLocaleString("en-US")}</dd></div>
                </dl>
              ) : (
                <p className="mt-3 text-xs text-[var(--muted)]">Not published yet: snapshots are written when a token&apos;s numbers change.</p>
              )}
              {m ? (
                <div className="mt-3 text-xs">
                  <p className="text-[var(--muted)]">evidenceRoot</p>
                  <p className="mono mt-0.5 break-all">{m.evidenceRoot}</p>
                </div>
              ) : null}
            </section>
          ) : null}
          <section className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
            <h2 className="font-semibold">Use this data</h2>
            <p className="mt-2 text-xs text-[var(--muted)]">JSON</p>
            <a className="mono block break-all text-xs text-[var(--accent-text)] hover:underline" href={`${BASE}/api/tokens/${token.address}.json`}>/api/tokens/{token.address}.json</a>
            <p className="mt-2 text-xs text-[var(--muted)]">Solidity</p>
            <p className="mono text-xs">NunoFeed.latest({short(token.address)})</p>
            <Link href="/developers/" className="mt-2 inline-block text-xs text-[var(--accent-text)] hover:underline">API reference →</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
