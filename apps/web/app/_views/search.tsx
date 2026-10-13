"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { short } from "@/lib/format";
import type { Level } from "@/lib/levels";
import { Badge } from "./badge";
import { TokenLogo } from "./token-logo";

/** Compact search index entry: address, symbol, name, label. */
export type SearchItem = [string, string, string, Level, string | null];

export function match(items: SearchItem[], q: string): SearchItem[] {
  const query = q.trim().toLowerCase().replace(/^\$/, "");
  if (!query) return [];
  const scored = items
    .map((it) => {
      const [a, s, n] = it;
      const sym = s.toLowerCase();
      const score = a === query ? 0 : sym === query ? 1 : sym.startsWith(query) ? 2 : a.startsWith(query) ? 3 : sym.includes(query) || n.toLowerCase().includes(query) ? 4 : 9;
      return [score, it] as const;
    })
    .filter(([s]) => s < 9);
  return scored.sort((x, y) => x[0] - y[0]).map(([, it]) => it);
}

/** Token search with suggestions. Enter opens the highlighted token, or the full results page. */
export function Search({ items, size = "md", autoFocus }: { items: SearchItem[]; size?: "md" | "lg"; autoFocus?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hits = match(items, q);
  const top = hits.slice(0, 6);
  const isAddress = /^0x[0-9a-f]{40}$/.test(q.trim().toLowerCase());

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  const submit = () => {
    if (top[active]) go(`/token/${top[active]![0]}/`);
    else if (q.trim()) go(`/?q=${encodeURIComponent(q.trim())}`);
  };

  const lg = size === "lg";
  return (
    <form
      role="search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">Search nad.fun tokens</label>
      <svg viewBox="0 0 20 20" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--soft)] ${lg ? "left-5 h-5 w-5" : "left-3 h-4 w-4"}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="9" cy="9" r="6" />
        <path d="m14 14 4 4" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(top.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Escape") setOpen(false);
        }}
        role="combobox"
        aria-expanded={open && q.trim() !== ""}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        placeholder={lg ? "Paste a token address, or search by name or $TICKER" : "Search token or address"}
        autoComplete="off"
        spellCheck={false}
        className={`w-full border border-[var(--line)] bg-[var(--surface)] outline-none placeholder:text-[var(--soft)] focus:border-[var(--accent)] ${lg ? "rounded-md py-4 pl-13 pr-28 text-base" : "rounded-full py-2 pl-9 pr-3 text-sm"}`}
      />
      {lg ? (
        <button type="submit" className="pill absolute right-2 top-1/2 -translate-y-1/2 bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--c-accent-ink)] hover:opacity-90">
          Check
        </button>
      ) : null}
      {open && q.trim() ? (
        <div id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] text-left shadow-md">
          {top.map(([a, s, n, l, img], i) => (
            <button
              key={a}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(`/token/${a}/`)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm ${i === active ? "bg-[var(--panel)]" : ""}`}
            >
              <TokenLogo src={img} symbol={s} size={32} />
              <span className="min-w-0 flex-1 text-left">
                <span className="font-medium">{s}</span> <span className="text-[var(--muted)]">{n}</span>
                <span className="mono block text-xs text-[var(--muted)]">{short(a)}</span>
              </span>
              <Badge level={l} />
            </button>
          ))}
          {top.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">
              {isAddress ? "Not a nad.fun token launched in the window Nuno checks." : "No tokens match."}
            </p>
          ) : (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(`/?q=${encodeURIComponent(q.trim())}`)}
              className="block w-full border-t border-[var(--line)] px-4 py-2.5 text-left text-sm font-medium text-[var(--accent-text)] hover:bg-[var(--panel)]"
            >
              See all {hits.length} result{hits.length === 1 ? "" : "s"} →
            </button>
          )}
        </div>
      ) : null}
    </form>
  );
}
