import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Dataset } from "@/lib/api";
import { EDGE_REASON, addrUrl, short } from "@/lib/format";
import { ClusterGraph } from "../graph";
import { EvidenceTable } from "../evidence";
import { baseFor } from "./screener";

/** Page title and description for a wallet-group page (historical pages say so). */
export function clusterMetadata(id: string, dataset: Dataset): Metadata {
  const c = api.cluster(id, dataset);
  if (!c) return { title: "Group not found" };
  const name = `Wallet group ${short(c.id)}`;
  return dataset === "contrast"
    ? { title: `${name}, historical week`, description: `${c.size} wallets that very likely belonged to one owner during a past week, with the public proof.` }
    : { title: name, description: `${c.size} wallets that very likely belong to one owner, with the public proof.` };
}

export const clusterParams = (d: Dataset) => api.clusterIds(d).map((id) => ({ id }));

export function ClusterView({ id, dataset }: { id: string; dataset: Dataset }) {
  const c = api.cluster(id, dataset);
  if (!c) notFound();
  const base = baseFor(dataset);
  const types = [...new Set(c.links.map((l) => l.type))];
  return (
    <div className="space-y-6">
      <div>
        {dataset === "contrast" ? (
          <p className="mb-2 text-xs uppercase text-[var(--bad)]">
            <Link href="/contrast/" className="hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"}</Link>
          </p>
        ) : null}
        <h1 className="text-2xl font-bold">
          Group <span className="mono">{short(c.id)}</span>
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {c.size} wallets that very likely belong to one owner. They are linked because they {types.map((t) => EDGE_REASON[t] ?? t).join(", ")}. Checked up to Monad block {c.sourceBlock.toLocaleString("en-US")}.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr]">
        <ClusterGraph cluster={c} />
        <div>
          <h2 className="font-semibold">The wallets</h2>
          <ul className="mono mt-2 grid grid-cols-2 gap-x-4 text-xs">
            {c.members.map((m) => (
              <li key={m}>
                <a href={addrUrl(m)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">{m}</a>
                {c.labels?.[m] ? <span className="ml-1 text-[var(--muted)]">({c.labels[m]!.label})</span> : null}
              </li>
            ))}
          </ul>
          {c.createdTokens.length ? (
            <>
              <h2 className="mt-4 font-semibold">Tokens this group launched ({c.createdTokens.length})</h2>
              <div className="mono mt-2 flex flex-wrap gap-2 text-xs">
                {c.createdTokens.map((t) => (
                  <Link key={t} href={`${base}/token/${t}/`} className="rounded border border-[var(--line)] px-2 py-0.5 hover:border-[var(--accent)]">
                    {short(t)}
                  </Link>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <section>
        <h2 className="font-semibold">Why we think these wallets belong together</h2>
        <p className="text-sm text-[var(--muted)]">Every line is one piece of proof. Click a transaction to see it yourself on the Monad explorer.</p>
        <EvidenceTable cluster={c} limit={2000} base={base} />
      </section>
    </div>
  );
}
