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
import { baseFor } from "./screener";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Stat({ label, raw, real, note }: { label: string; raw?: string; real: string; note?: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="text-xs uppercase text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">
        {raw !== undefined ? <><span className="text-[var(--muted)] line-through decoration-1">{raw}</span>{" "}</> : null}
        {real}
      </div>
      {note ? <div className="mt-1 text-xs text-[var(--muted)]">{note}</div> : null}
    </div>
  );
}

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

export function TokenView({ address, dataset }: { address: string; dataset: Dataset }) {
  const token = api.token(address, dataset);
  if (!token) notFound();
  const base = baseFor(dataset);
  const clusters = token.clusters ?? [];
  const m = token.metrics;
  const snap = token.latestSnapshot;
  const v = verdict(token, dataset);
  const links = api.links(token.address, dataset);
  // The creator's group first, then the biggest.
  const groups = [...clusters].sort((a, b) => Number(b.members.includes(token.creator)) - Number(a.members.includes(token.creator)) || b.size - a.size);

  return (
    <div className="space-y-8">
      <div>
        {dataset === "contrast" ? (
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
            <Link href="/contrast/" className="hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"}</Link>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <TokenLogo src={links.image} symbol={token.symbol} size={56} />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">
              {token.name} <span className="text-[var(--muted)]">${token.symbol}</span>
            </h1>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {([[`https://nad.fun/tokens/${token.address}`, "nad.fun"], [links.twitter, "X"], [links.telegram, "Telegram"], [links.website, "Website"], [addrUrl(token.address), "Monadscan"]] as Array<[string | null | undefined, string]>)
                .filter((x): x is [string, string] => Boolean(x[0]))
                .map(([href, label]) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer" className="pill border border-[var(--line)] px-3 py-1 hover:border-[var(--accent)] hover:text-[var(--accent-text)]">{label} ↗</a>
                ))}
            </div>
          </div>
        </div>
        <div className="mono mt-1 flex flex-wrap gap-x-4 text-xs text-[var(--muted)]">
          <a href={addrUrl(token.address)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">token {token.address}</a>
          <a href={addrUrl(token.creator)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">creator {short(token.creator)}</a>
          <a href={txUrl(token.createTx)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">created at block {token.createBlock.toLocaleString("en-US")}</a>
          {token.graduatedPool ? <span>moved to open trading → {short(token.graduatedPool)}</span> : <span>still on nad.fun&apos;s launch curve</span>}
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--line)] p-5 sm:p-6" aria-labelledby="found">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="found" className="sr-only">What Nuno found</h2>
          <Badge level={v.level} large />
          <p className="text-sm text-[var(--muted)]">{LEVEL_HINT[v.level]}</p>
        </div>
        {v.flags.length ? (
          <ul className="mt-4 space-y-2">
            {v.flags.map((f) => (
              <li key={f.text} className="flex gap-3 text-base">
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${f.level === "red" ? "bg-[var(--flag)]" : "bg-[var(--c-accent)]"}`} aria-hidden="true" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {v.creatorGroup ? (
            <Link href={`${base}/cluster/${v.creatorGroup.id}/`} className="font-medium text-[var(--accent-text)] hover:underline">
              See the creator&apos;s wallet group →
            </Link>
          ) : null}
          {clusters.length ? (
            <a href="#groups" className="font-medium text-[var(--accent-text)] hover:underline">
              {clusters.length} wallet group{clusters.length > 1 ? "s" : ""} trade this token ↓
            </a>
          ) : null}
          <Link href="/developers/#rules" className="text-[var(--muted)] hover:underline">How labels are decided</Link>
        </div>
      </section>

      {m ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Holders" raw={String(m.rawHolders)} real={String(m.realHolders)} note="wallets holding it → real owners, once wallets of the same person are counted as one" />
          <Stat label="Owned by wallet groups" real={pct(m.clusterSupplyBps)} note="share of the token held by groups of wallets that belong to one owner" />
          <Stat label="Owned by the creator's side" real={pct(m.creatorLinkedSupplyBps)} note="held by the creator and every wallet linked to them" />
          <Stat label="Top 10 owners hold" real={pct(m.effectiveTop10Bps)} note="counting each group as one owner" />
          <Stat label="Trading volume (MON)" raw={mon(m.rawVolume)} real={mon(m.organicVolume)} note="all trading → trading by owners who kept their tokens" />
          <Stat
            label="Trading by holders"
            real={m.rawVolume === "0" ? "–" : pct(m.organicVolumeBps)}
            note="share of trading by owners who kept their tokens; quick in-and-out trading, by bots or ordinary traders, is left out"
          />
        </section>
      ) : (
        <p className="text-[var(--muted)]">{token.pruned ? "Too few buyers to analyse this token in detail." : "Numbers for this token are not ready yet."}</p>
      )}

      {dataset === "live" ? (
        <section className="rounded-lg border border-[var(--line)] p-3 text-sm">
          <h2 className="font-semibold">Use these numbers in your app</h2>
          <p className="mt-1 text-[var(--muted)]">
            JSON:{" "}
            <a className="mono break-all text-[var(--accent-text)] hover:underline" href={`${BASE}/api/tokens/${token.address}.json`}>
              /api/tokens/{token.address}.json
            </a>
            {" · "}
            Solidity: <span className="mono">NunoFeed.latest({short(token.address)})</span> ·{" "}
            <Link href="/developers/" className="text-[var(--accent-text)] hover:underline">developer guide</Link>
          </p>
          <p className="mt-1 text-[var(--muted)]">These numbers are also written to Nuno&apos;s contract on the Monad test network, so other apps and smart contracts can read them directly.</p>
          {snap ? (
            <p className="mt-1 text-[var(--muted)]">
              Last written at test-network block {snap.publishBlock.toLocaleString("en-US")} from mainnet block {snap.sourceBlock.toLocaleString("en-US")}:{" "}
              <a className="mono text-[var(--accent-text)] hover:underline" href={txUrl(snap.txHash, snap.chainId)} target="_blank" rel="noreferrer">
                {short(snap.txHash)}
              </a>
            </p>
          ) : (
            <p className="mt-1 text-[var(--muted)]">Not written yet.</p>
          )}
          {m ? (
            <p className="mt-2 break-all text-xs text-[var(--muted)]">
              Proof fingerprint <span className="mono">{m.evidenceRoot}</span>: a fingerprint of all the evidence on this page, stored with the numbers, so anyone can check nothing was changed.
            </p>
          ) : null}
        </section>
      ) : null}

      <section id="groups" className="scroll-mt-20">
        <h2 className="text-lg font-semibold">Wallet groups trading this token ({clusters.length})</h2>
        <p className="text-sm text-[var(--muted)]">
          Click a group to open it. A group is a set of wallets that very likely belong to the same person. Each group keeps the same name on every token, so you can follow one owner across launches.
        </p>
        <div className="mt-4 space-y-8">
          {groups.map((c, i) => (
            <details key={c.id} open={i === 0} className="faq rounded-lg border border-[var(--line)] p-4">
              <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  Group <span className="mono">{short(c.id)}</span>: {c.size} wallets, one owner
                  {c.members.includes(token.creator) ? <span className="ml-2 text-xs font-normal text-[var(--bad)]">includes the creator</span> : null}
                </span>
                <span className="flex items-center gap-3">
                  {c.createdTokens.length ? (
                    <span className="text-xs text-[var(--bad)]">launched {c.createdTokens.length} token{c.createdTokens.length > 1 ? "s" : ""}</span>
                  ) : null}
                  <span className="icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--panel)]" aria-hidden="true" />
                </span>
              </summary>
              <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,22rem)_1fr]">
                <ClusterGraph cluster={c} highlight={token.creator} />
                <EvidenceTable cluster={c} limit={10} base={base} />
              </div>
              <Link href={`${base}/cluster/${c.id}/`} className="mt-3 inline-block text-sm font-medium text-[var(--accent-text)] hover:underline">
                Open this group →
              </Link>
            </details>
          ))}
          {clusters.length === 0 ? <p className="text-[var(--muted)]">No groups found: every buyer and holder of this token looks like a separate person.</p> : null}
        </div>
      </section>
    </div>
  );
}
