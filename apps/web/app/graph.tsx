import type { Cluster } from "@/lib/api";
import { GraphView, type GraphEdge, type GraphNode } from "./graph-view";

const MAX = 60;

/**
 * Deterministic force layout (Fruchterman–Reingold from a circle), computed at build time so the graph
 * renders instantly and never moves. Positions are in a 0..size box.
 */
function layout(ids: string[], links: Array<[string, string]>, size: number): Map<string, { x: number; y: number }> {
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const p = ids.map((_, i) => ({ x: Math.cos((2 * Math.PI * i) / n) * size * 0.3, y: Math.sin((2 * Math.PI * i) / n) * size * 0.3 }));
  const e = links.map(([a, b]) => [idx.get(a)!, idx.get(b)!] as const);
  const k = Math.sqrt((size * size * 0.5) / Math.max(n, 1));
  let t = size * 0.1;
  for (let it = 0; it < 300; it++) {
    const d = p.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = p[i]!.x - p[j]!.x, dy = p[i]!.y - p[j]!.y;
        const dist = Math.max(Math.hypot(dx, dy), 0.01);
        const f = (k * k) / dist;
        d[i]!.x += (dx / dist) * f; d[i]!.y += (dy / dist) * f;
        d[j]!.x -= (dx / dist) * f; d[j]!.y -= (dy / dist) * f;
      }
    for (const [a, b] of e) {
      const dx = p[a]!.x - p[b]!.x, dy = p[a]!.y - p[b]!.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const f = (dist * dist) / k;
      d[a]!.x -= (dx / dist) * f; d[a]!.y -= (dy / dist) * f;
      d[b]!.x += (dx / dist) * f; d[b]!.y += (dy / dist) * f;
    }
    for (let i = 0; i < n; i++) {
      const len = Math.max(Math.hypot(d[i]!.x, d[i]!.y), 0.01);
      p[i]!.x += (d[i]!.x / len) * Math.min(len, t);
      p[i]!.y += (d[i]!.y / len) * Math.min(len, t);
      // Gentle pull to the centre keeps disconnected wallets on screen.
      p[i]!.x *= 0.995; p[i]!.y *= 0.995;
    }
    t *= 0.985;
  }
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 24;
  const sx = (size - 2 * pad) / Math.max(maxX - minX, 1), sy = (size - 2 * pad) / Math.max(maxY - minY, 1);
  const s = Math.min(sx, sy);
  return new Map(ids.map((id, i) => [id, { x: pad + (p[i]!.x - minX) * s + ((size - 2 * pad) - (maxX - minX) * s) / 2, y: pad + (p[i]!.y - minY) * s + ((size - 2 * pad) - (maxY - minY) * s) / 2 }]));
}

/** An entity's wallets and evidence links; layout precomputed here, interaction in GraphView. */
export function ClusterGraph({ cluster, highlight }: { cluster: Cluster; highlight?: string }) {
  const size = 360;
  // The creator first, so it is always among the drawn wallets.
  const ordered = highlight && cluster.members.includes(highlight) ? [highlight, ...cluster.members.filter((m) => m !== highlight)] : cluster.members;
  const ids = ordered.slice(0, MAX);
  const shown = new Set(ids);
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const l of cluster.links) {
    const key = `${l.a}|${l.b}|${l.type}`;
    if (!shown.has(l.a) || !shown.has(l.b) || seen.has(key)) continue;
    seen.add(key);
    edges.push({ a: l.a, b: l.b, type: l.type, evidence: l.evidence.slice(0, 3).map((e) => ({ txHash: e.txHash, block: e.block, detail: e.detail ?? null })) });
  }
  const pos = layout(ids, edges.map((e) => [e.a, e.b]), size);
  const nodes: GraphNode[] = ids.map((id) => ({ id, ...pos.get(id)!, creator: id === highlight }));
  return <GraphView nodes={nodes} edges={edges} size={size} total={cluster.members.length} />;
}
