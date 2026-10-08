import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { addrUrl, short } from "@/lib/format";
import { ClusterGraph } from "../../graph";
import { EvidenceTable } from "../../evidence";

export const dynamic = "force-dynamic";

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await api.cluster(id.toLowerCase());
  if (!c) notFound();
  const types = [...new Set(c.links.map((l) => l.type))];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Entity <span className="mono">{short(c.id)}</span>
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {c.size} wallets, {c.links.length} accepted links ({types.join(", ").replaceAll("_", " ")}). Resolved at mainnet block {c.sourceBlock.toLocaleString("en-US")}.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr]">
        <ClusterGraph cluster={c} />
        <div>
          <h2 className="font-semibold">Wallets</h2>
          <ul className="mono mt-2 grid grid-cols-2 gap-x-4 text-xs">
            {c.members.map((m) => (
              <li key={m}>
                <a href={addrUrl(m)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">{m}</a>
              </li>
            ))}
          </ul>
          {c.createdTokens.length ? (
            <>
              <h2 className="mt-4 font-semibold">Tracked tokens created by this entity ({c.createdTokens.length})</h2>
              <div className="mono mt-2 flex flex-wrap gap-2 text-xs">
                {c.createdTokens.map((t) => (
                  <Link key={t} href={`/token/${t}`} className="rounded border border-[var(--line)] px-2 py-0.5 hover:border-[var(--accent)]">
                    {short(t)}
                  </Link>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <section>
        <h2 className="font-semibold">Evidence</h2>
        <EvidenceTable cluster={c} limit={2000} />
      </section>
    </div>
  );
}
