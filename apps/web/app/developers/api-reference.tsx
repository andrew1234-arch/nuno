"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "../_views/copy";

export interface Endpoint {
  /** Path as documented, e.g. "api/tokens/{token}.json". */
  path: string;
  description: string;
  /** Full URL of a real file (placeholders filled with a real id from the export). */
  url: string;
  sample: string;
}

/** Minimal JSON highlighter using the existing palette tokens. */
export function JsonCode({ text }: { text: string }) {
  const parts = text.split(/("(?:[^"\\]|\\.)*"(?:\s*:)?|\b-?\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith('"')) return <span key={i} style={{ color: p.trimEnd().endsWith(":") ? "var(--c-accent-text)" : "var(--organic)" }}>{p}</span>;
        if (/^(true|false|null)$/.test(p)) return <span key={i} style={{ color: "var(--muted)" }}>{p}</span>;
        if (/^-?\d/.test(p)) return <span key={i} style={{ color: "var(--text)" }}>{p}</span>;
        return <span key={i} style={{ color: "var(--soft)" }}>{p}</span>;
      })}
    </>
  );
}

const EXAMPLES: Array<[string, (url: string) => string]> = [
  ["fetch (JS)", (u) => `const res = await fetch("${u}");\nconst data = await res.json();\nconsole.log(data);`],
  ["curl", (u) => `curl -s "${u}"`],
  ["Python", (u) => `import json, urllib.request\n\nwith urllib.request.urlopen("${u}") as r:\n    data = json.load(r)\nprint(data)`],
];

function Panel({ e }: { e: Endpoint }) {
  const [tab, setTab] = useState(0);
  const code = EXAMPLES[tab]![1](e.url);
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <p className="text-xs text-[var(--muted)]">URL</p>
        <div className="mt-1 flex items-start gap-2">
          <a href={e.url} className="mono min-w-0 flex-1 break-all text-xs text-[var(--accent-text)] hover:underline">{e.url}</a>
          <CopyButton text={e.url} />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <div role="tablist" aria-label="Example language" className="inline-flex rounded-md border border-[var(--line)] p-0.5 text-xs">
            {EXAMPLES.map(([label], i) => (
              <button key={label} role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={`rounded px-2.5 py-1 ${tab === i ? "bg-[var(--panel)] font-medium text-[var(--text)]" : "text-[var(--muted)]"}`}>
                {label}
              </button>
            ))}
          </div>
          <CopyButton text={code} />
        </div>
        <pre className="mono mt-2 overflow-x-auto rounded-md bg-[var(--panel)] p-3 text-[11px] leading-relaxed">{code}</pre>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--muted)]">Sample from the current export</p>
          <CopyButton text={e.sample} label="Copy JSON" />
        </div>
        <pre className="mono mt-2 max-h-[60vh] overflow-auto rounded-md bg-[var(--panel)] p-3 text-[11px] leading-relaxed"><JsonCode text={e.sample} /></pre>
      </div>
    </div>
  );
}

/** Endpoint list (left) with a sticky code panel (right) on desktop; inline expanders on smaller screens. */
export function ApiReference({ endpoints }: { endpoints: Endpoint[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="grid gap-12 lg:grid-cols-[55fr_45fr]">
      <ul className="min-w-0 self-start divide-y divide-[var(--line)] rounded-md border border-[var(--line)] bg-[var(--surface)]">
        {endpoints.map((e, i) => (
          <li key={e.path} className={`border-l-2 ${i === active ? "border-l-[var(--accent)] bg-[var(--panel)]" : "border-l-transparent"}`}>
            <button type="button" onClick={() => setActive(i)} aria-pressed={i === active} className="block w-full px-4 py-3 text-left">
              <span className="mono block break-all text-sm">{e.path}</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">{e.description}</span>
            </button>
            <details className="px-4 pb-3 lg:hidden">
              <summary className="cursor-pointer text-xs text-[var(--accent-text)]">Sample from the current export</summary>
              <div className="mt-3"><Panel e={e} /></div>
            </details>
          </li>
        ))}
      </ul>
      <div className="hidden min-w-0 lg:block">
        <div className="sticky top-32 rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="mono mb-3 text-sm font-medium">{endpoints[active]!.path}</p>
          <Panel e={endpoints[active]!} />
        </div>
      </div>
    </div>
  );
}

/** Section tabs that stick under the main nav and highlight the section in view. */
export function SubNav({ items }: { items: Array<[string, string]> }) {
  const [cur, setCur] = useState(items[0]![0]);
  useEffect(() => {
    const els = items.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null);
    const on = () => {
      let c = items[0]![0];
      for (const el of els) if (el.getBoundingClientRect().top < 160) c = el.id;
      setCur(c);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [items]);
  return (
    <nav aria-label="On this page" className="sticky top-16 z-10 -mx-4 border-b border-[var(--line)] bg-[var(--bg)]/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex gap-1 overflow-x-auto text-sm">
        {items.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={cur === id ? "location" : undefined} className={`shrink-0 rounded-md px-3 py-1.5 ${cur === id ? "bg-[var(--accent)] font-medium text-[var(--c-accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"}`}>
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
