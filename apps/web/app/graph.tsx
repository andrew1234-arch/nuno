import type { Cluster } from "@/lib/api";
import { EDGE_SHORT, short } from "@/lib/format";

const EDGE_COLORS: Record<string, string> = {
  same_direct_funder: "#c0703f",
  common_funding_source: "#b0785a",
  creator_funded: "#d0533d",
  token_transfer: "#4f9a6c",
  same_block_early_buy: "#d4a373",
  same_block_sell: "#a39184",
};

/** Static circular layout of an entity's wallets and accepted links (server-rendered SVG). */
export function ClusterGraph({ cluster, highlight }: { cluster: Cluster; highlight?: string }) {
  const MAX = 60;
  const members = cluster.members.slice(0, MAX);
  const size = 360;
  const r = size / 2 - 40;
  const pos = new Map(
    members.map((m, i) => {
      const a = (2 * Math.PI * i) / members.length - Math.PI / 2;
      return [m, { x: size / 2 + r * Math.cos(a), y: size / 2 + r * Math.sin(a) }];
    }),
  );
  const edges = new Map<string, string>();
  for (const l of cluster.links) if (pos.has(l.a) && pos.has(l.b)) edges.set(`${l.a}|${l.b}`, l.type);
  return (
    <figure>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-sm" role="img" aria-label={`Cluster of ${cluster.size} wallets`}>
        {[...edges].map(([k, type]) => {
          const [a, b] = k.split("|") as [string, string];
          const p = pos.get(a)!;
          const q = pos.get(b)!;
          return <line key={k} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={EDGE_COLORS[type] ?? "#555"} strokeOpacity={0.6} strokeWidth={1.2} />;
        })}
        {members.map((m) => {
          const p = pos.get(m)!;
          const isHl = m === highlight;
          return (
            <g key={m}>
              <circle cx={p.x} cy={p.y} r={isHl ? 7 : 5} style={{ fill: isHl ? "#d0533d" : "var(--text)" }} />
              {members.length <= 16 ? (
                <text x={p.x} y={p.y - 9} textAnchor="middle" fontSize={8} style={{ fill: "var(--muted)" }} className="mono">
                  {short(m)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
        {Object.entries(EDGE_COLORS).map(([t, c]) => (
          <span key={t} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: c }} />
            {EDGE_SHORT[t] ?? t}
          </span>
        ))}
        {cluster.members.length > MAX ? <span>showing {MAX} of {cluster.members.length} wallets</span> : null}
        <span>· each dot is a wallet, each line a reason they're linked</span>
      </figcaption>
    </figure>
  );
}
