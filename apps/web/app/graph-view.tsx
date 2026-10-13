"use client";

import { useState } from "react";
import { EDGE_LABELS, EDGE_SHORT, addrUrl, short, txUrl } from "@/lib/format";

export interface GraphNode { id: string; x: number; y: number; creator: boolean }
export interface GraphEdge { a: string; b: string; type: string; evidence: Array<{ txHash: string; block: number; detail: string | null }> }

// Line style by evidence family, so the graph reads without relying on colour.
const DASH: Record<string, string | undefined> = {
  same_direct_funder: undefined,
  common_funding_source: undefined,
  creator_funded: undefined,
  same_block_early_buy: "5 3",
  token_transfer: "1.5 3",
  same_block_sell: "6 3 1.5 3",
};
const LEGEND: Array<[string, string | undefined]> = [
  ["funding", undefined],
  ["same-block buy", "5 3"],
  ["token transfer", "1.5 3"],
  ["coordinated sell", "6 3 1.5 3"],
];

/** Interactive view of a precomputed graph: click or focus a wallet to see its evidence. */
export function GraphView({ nodes, edges, size, total }: { nodes: GraphNode[]; edges: GraphEdge[]; size: number; total: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const mine = sel ? edges.filter((e) => e.a === sel || e.b === sel) : [];
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,22rem)_1fr]">
      <figure>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-sm rounded-md border border-[var(--line)] bg-[var(--bg)]" role="group" aria-label={`Entity of ${total} wallets`}>
          {edges.map((e, i) => {
            const p = pos.get(e.a)!, q = pos.get(e.b)!;
            const on = sel !== null && (e.a === sel || e.b === sel);
            return (
              <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeDasharray={DASH[e.type]} strokeWidth={on ? 2 : 1.1}
                style={{ stroke: on ? "var(--c-accent)" : "var(--soft)", strokeOpacity: sel && !on ? 0.25 : 0.8 }} />
            );
          })}
          {nodes.map((n) => (
            <circle
              key={n.id}
              cx={n.x}
              cy={n.y}
              r={n.creator ? 7 : 5}
              tabIndex={0}
              role="button"
              aria-label={`Wallet ${n.id}${n.creator ? ", token creator" : ""}`}
              aria-pressed={sel === n.id}
              onClick={() => setSel(sel === n.id ? null : n.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(sel === n.id ? null : n.id))}
              className="cursor-pointer outline-none"
              style={{ fill: n.creator ? "var(--surface)" : "var(--flag)", stroke: sel === n.id ? "var(--c-accent)" : n.creator ? "var(--flag)" : "var(--surface)", strokeWidth: n.creator || sel === n.id ? 2.5 : 1 }}
            />
          ))}
        </svg>
        <figcaption className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
          {LEGEND.map(([label, dash]) => (
            <span key={label} className="flex items-center gap-1">
              <svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" strokeDasharray={dash} strokeWidth="1.5" style={{ stroke: "var(--muted)" }} /></svg>
              {label}
            </span>
          ))}
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[var(--flag)]" /> creator</span>
          {total > nodes.length ? <span>{nodes.length} of {total} wallets shown</span> : null}
        </figcaption>
      </figure>
      <div className="min-w-0 rounded-md border border-[var(--line)] p-3 text-sm" aria-live="polite">
        {sel ? (
          <>
            <p className="text-xs text-[var(--muted)]">Wallet</p>
            <a href={addrUrl(sel)} target="_blank" rel="noreferrer" className="mono break-all text-[var(--accent-text)] hover:underline">{sel}</a>
            <p className="mt-3 text-xs text-[var(--muted)]">{mine.length} evidence link{mine.length === 1 ? "" : "s"} shown</p>
            <ul className="mt-1 space-y-2">
              {mine.map((e, i) => {
                const other = e.a === sel ? e.b : e.a;
                return (
                  <li key={i} className="border-t border-[var(--line)] pt-2">
                    <p>{EDGE_LABELS[e.type] ?? EDGE_SHORT[e.type] ?? e.type} <span className="mono text-xs text-[var(--muted)]">↔ {short(other)}</span></p>
                    {e.evidence.map((ev) => (
                      <p key={ev.txHash} className="mono text-xs text-[var(--muted)]">
                        <a href={txUrl(ev.txHash)} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] hover:underline">{short(ev.txHash)}</a> · block {ev.block.toLocaleString("en-US")}
                        {ev.detail ? ` · ${ev.detail}` : ""}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-[var(--muted)]">Select a wallet in the graph to see its address and evidence. Every link opens the transaction on Monadscan.</p>
        )}
      </div>
    </div>
  );
}
