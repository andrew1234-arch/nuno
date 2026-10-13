"use client";

import { useState } from "react";

/** Copies `text` to the clipboard; the label confirms for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }, () => {});
      }}
      className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
      aria-label={`${label}: ${text}`}
    >
      {done ? "Copied" : label}
    </button>
  );
}
