"use client";

import { useEffect, useState } from "react";

/** Sticky docs sidebar; highlights the section in view. */
export function DocsNav({ groups }: { groups: Array<{ title: string; items: Array<[string, string, number?]> }> }) {
  const [active, setActive] = useState("start");
  useEffect(() => {
    const ids = groups.flatMap((g) => g.items.map(([id]) => id));
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null);
    const onScroll = () => {
      let cur = ids[0]!;
      for (const el of els) if (el.getBoundingClientRect().top < 120) cur = el.id;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [groups]);
  return (
    <nav aria-label="Docs" className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
      {groups.map((g) => (
        <div key={g.title} className="mb-6">
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{g.title}</p>
          <ul className="mt-2 space-y-0.5 text-sm">
            {g.items.map(([id, label, depth]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active === id ? "location" : undefined}
                  className={`block rounded-lg py-1.5 pr-3 ${depth === 3 ? "pl-7 text-xs" : "pl-3"} ${active === id ? "bg-[var(--panel)] font-medium text-[var(--accent-text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
