import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { addrUrl, mon, pct, short, txUrl } from "@/lib/format";
import { ClusterGraph } from "../../graph";
import { EvidenceTable } from "../../evidence";

export const dynamic = "force-dynamic";

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

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const token = await api.token(address.toLowerCase());
  if (!token) notFound();
  const clusters = (await api.tokenClusters(token.address))?.clusters ?? [];
  const m = token.metrics;
  const snap = token.latestSnapshot;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">
          {token.name} <span className="text-[var(--muted)]">${token.symbol}</span>
        </h1>
        <div className="mono mt-1 flex flex-wrap gap-x-4 text-xs text-[var(--muted)]">
          <a href={addrUrl(token.address)} target="_blank" rel="noreferrer" className="hover:text-white">token {token.address}</a>
          <a href={addrUrl(token.creator)} target="_blank" rel="noreferrer" className="hover:text-white">creator {short(token.creator)}</a>
          <a href={txUrl(token.createTx)} target="_blank" rel="noreferrer" className="hover:text-white">created at block {token.createBlock.toLocaleString("en-US")}</a>
          {token.graduatedPool ? <span>graduated → {short(token.graduatedPool)}</span> : <span>on bonding curve</span>}
        </div>
      </div>

      {m ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Holders (wallets → entities)" raw={String(m.rawHolders)} real={String(m.realHolders)} />
          <Stat label="Supply held by clusters" real={pct(m.clusterSupplyBps)} note="share of total supply" />
          <Stat label="Creator-linked supply" real={pct(m.creatorLinkedSupplyBps)} note="creator's whole entity" />
          <Stat label="Top-10 entities" real={pct(m.effectiveTop10Bps)} note="excl. curve/pool contracts" />
          <Stat label="Volume (MON)" raw={mon(m.rawVolume)} real={mon(m.organicVolume)} note="raw → organic" />
          <Stat label="Organic volume" real={m.rawVolume === "0" ? "–" : pct(m.organicVolumeBps)} />
        </section>
      ) : (
        <p className="text-[var(--muted)]">Metrics not computed yet.</p>
      )}

      <section className="rounded-lg border border-[var(--line)] p-3 text-sm">
        <h2 className="font-semibold">On-chain snapshot (NunoFeed)</h2>
        {snap ? (
          <p className="mt-1 text-[var(--muted)]">
            Published at testnet block {snap.publishBlock.toLocaleString("en-US")} from mainnet block {snap.sourceBlock.toLocaleString("en-US")}:{" "}
            <a className="mono text-[var(--accent)] hover:underline" href={txUrl(snap.txHash, snap.chainId)} target="_blank" rel="noreferrer">
              {short(snap.txHash)}
            </a>
          </p>
        ) : (
          <p className="mt-1 text-[var(--muted)]">Not published yet.</p>
        )}
        {m ? <p className="mono mt-1 break-all text-xs text-[var(--muted)]">evidenceRoot {m.evidenceRoot}</p> : null}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Entities active in this token ({clusters.length})</h2>
        <p className="text-sm text-[var(--muted)]">Entities are resolved across all tracked tokens, so one operator has one id everywhere.</p>
        <div className="mt-4 space-y-8">
          {clusters.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--line)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/cluster/${c.id}`} className="font-semibold hover:text-[var(--accent)]">
                  Entity <span className="mono">{short(c.id)}</span>: {c.size} wallets
                </Link>
                {c.createdTokens.length ? (
                  <span className="text-xs text-[var(--bad)]">created {c.createdTokens.length} tracked token{c.createdTokens.length > 1 ? "s" : ""}</span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,22rem)_1fr]">
                <ClusterGraph cluster={c} highlight={token.creator} />
                <EvidenceTable cluster={c} limit={25} />
              </div>
            </div>
          ))}
          {clusters.length === 0 ? <p className="text-[var(--muted)]">No multi-wallet entities found among this token's traders and holders.</p> : null}
        </div>
      </section>
    </div>
  );
}
