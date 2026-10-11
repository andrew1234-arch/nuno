import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Dataset } from "@/lib/api";
import { addrUrl, mon, pct, short, txUrl } from "@/lib/format";
import { ClusterGraph } from "../graph";
import { EvidenceTable } from "../evidence";
import { baseFor } from "./screener";

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

export const tokenParams = (d: Dataset) => api.tokens(d).map((t) => ({ address: t.address }));

export function TokenView({ address, dataset }: { address: string; dataset: Dataset }) {
  const token = api.token(address, dataset);
  if (!token) notFound();
  const base = baseFor(dataset);
  const clusters = token.clusters ?? [];
  const m = token.metrics;
  const snap = token.latestSnapshot;

  return (
    <div className="space-y-8">
      <div>
        {dataset === "contrast" ? (
          <p className="mb-2 text-xs uppercase text-[var(--bad)]">
            <Link href="/contrast/" className="hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"}</Link>
          </p>
        ) : null}
        <h1 className="text-2xl font-bold">
          {token.name} <span className="text-[var(--muted)]">${token.symbol}</span>
        </h1>
        <div className="mono mt-1 flex flex-wrap gap-x-4 text-xs text-[var(--muted)]">
          <a href={addrUrl(token.address)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">token {token.address}</a>
          <a href={addrUrl(token.creator)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">creator {short(token.creator)}</a>
          <a href={txUrl(token.createTx)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">created at block {token.createBlock.toLocaleString("en-US")}</a>
          {token.graduatedPool ? <span>moved to open trading → {short(token.graduatedPool)}</span> : <span>still on nad.fun&apos;s launch curve</span>}
        </div>
      </div>

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
          <h2 className="font-semibold">Published on-chain</h2>
          <p className="mt-1 text-[var(--muted)]">These numbers are also written to Nuno&apos;s contract on the Monad test network, so other apps and smart contracts can read them directly.</p>
          {snap ? (
            <p className="mt-1 text-[var(--muted)]">
              Last written at test-network block {snap.publishBlock.toLocaleString("en-US")} from mainnet block {snap.sourceBlock.toLocaleString("en-US")}:{" "}
              <a className="mono text-[var(--accent)] hover:underline" href={txUrl(snap.txHash, snap.chainId)} target="_blank" rel="noreferrer">
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

      <section>
        <h2 className="text-lg font-semibold">Wallet groups trading this token ({clusters.length})</h2>
        <p className="text-sm text-[var(--muted)]">
          A group is a set of wallets that very likely belong to the same person. Each group keeps the same name on every token, so you can follow one owner across launches.
        </p>
        <div className="mt-4 space-y-8">
          {clusters.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--line)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`${base}/cluster/${c.id}/`} className="font-semibold hover:text-[var(--accent)]">
                  Group <span className="mono">{short(c.id)}</span>: {c.size} wallets, one owner
                </Link>
                {c.createdTokens.length ? (
                  <span className="text-xs text-[var(--bad)]">launched {c.createdTokens.length} token{c.createdTokens.length > 1 ? "s" : ""}</span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,22rem)_1fr]">
                <ClusterGraph cluster={c} highlight={token.creator} />
                <EvidenceTable cluster={c} limit={25} base={base} />
              </div>
            </div>
          ))}
          {clusters.length === 0 ? <p className="text-[var(--muted)]">No groups found: every buyer and holder of this token looks like a separate person.</p> : null}
        </div>
      </section>
    </div>
  );
}
