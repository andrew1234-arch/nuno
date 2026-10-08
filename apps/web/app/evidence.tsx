import Link from "next/link";
import type { Cluster } from "@/lib/api";
import { EDGE_LABELS, addrUrl, short, txUrl } from "@/lib/format";

/** Every accepted link with every piece of evidence, each linked to the explorer. */
export function EvidenceTable({ cluster, limit = 200 }: { cluster: Cluster; limit?: number }) {
  const rows = cluster.links.flatMap((l) => l.evidence.map((e) => ({ ...e, a: l.a, b: l.b, weight: l.weight })));
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = `${r.a}${r.b}${r.type}${r.txHash}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[var(--muted)]">
          <tr>
            <th className="py-1 text-left">Edge</th>
            <th className="text-left">Wallets</th>
            <th className="text-left">Evidence tx</th>
            <th className="text-right">Block</th>
            <th className="text-left pl-3">Detail</th>
          </tr>
        </thead>
        <tbody>
          {unique.slice(0, limit).map((r, i) => (
            <tr key={i} className="border-t border-[var(--line)]">
              <td className="py-1 pr-2">{EDGE_LABELS[r.type] ?? r.type} <span className="text-[var(--muted)]">({r.weight})</span></td>
              <td className="mono pr-2">
                <a href={addrUrl(r.a)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">{short(r.a)}</a>
                {" ↔ "}
                <a href={addrUrl(r.b)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]">{short(r.b)}</a>
              </td>
              <td className="mono pr-2">
                <a href={txUrl(r.txHash)} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">{short(r.txHash)}</a>
              </td>
              <td className="mono text-right tabular-nums">{r.block.toLocaleString("en-US")}</td>
              <td className="mono pl-3 text-[var(--muted)]">
                {r.detail ? <a href={addrUrl(r.detail)} target="_blank" rel="noreferrer" className="hover:text-white">via {short(r.detail)}</a> : null}
                {r.token ? <> {" "}<Link href={`/token/${r.token}`} className="hover:text-white">token {short(r.token)}</Link></> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {unique.length > limit ? <p className="mt-2 text-xs text-[var(--muted)]">Showing {limit} of {unique.length} evidence rows. Full list: <Link className="text-[var(--accent)]" href={`/cluster/${cluster.id}`}>cluster page</Link>.</p> : null}
    </div>
  );
}
