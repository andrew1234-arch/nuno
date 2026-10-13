"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/**
 * How current the data is, on every page (from meta.json at build time; the relative time is computed in the
 * browser, so it stays true between builds). The dataset switch appears only when a historical set exists.
 */
export function FreshnessBar({
  sourceBlock,
  generatedAt,
  window,
  refreshMinutes,
  contrastLabel,
}: {
  sourceBlock: number;
  generatedAt: string;
  window: string | null;
  refreshMinutes: number;
  contrastLabel: string | null;
}) {
  const path = usePathname();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const historical = path.startsWith("/contrast");
  return (
    <div className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-xs text-[var(--muted)] sm:px-6 lg:px-8">
        <p className="tabular">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--organic)] align-middle" aria-hidden="true" />
          Data as of block <span className="mono text-[var(--text)]">{sourceBlock.toLocaleString("en-US")}</span>
          {" · "}generated <time dateTime={generatedAt} title={generatedAt}>{now === null ? generatedAt.slice(0, 16).replace("T", " ") + " UTC" : ago(generatedAt, now)}</time>
          {window ? <> · window: {window}</> : null}
          {" · "}refreshes ~every {refreshMinutes} min
        </p>
        {contrastLabel ? (
          <div role="group" aria-label="Dataset" className="inline-flex rounded-md border border-[var(--line)] p-0.5">
            <Link href="/" aria-current={!historical ? "page" : undefined} className={`rounded px-2.5 py-1 ${!historical ? "bg-[var(--panel)] font-medium text-[var(--text)]" : ""}`}>
              Live (last 7 days)
            </Link>
            <Link href="/contrast/" aria-current={historical ? "page" : undefined} className={`rounded px-2.5 py-1 ${historical ? "bg-[var(--panel)] font-medium text-[var(--text)]" : ""}`}>
              Historical contrast ({contrastLabel})
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
