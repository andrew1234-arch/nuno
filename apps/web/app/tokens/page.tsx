import type { Metadata } from "next";
import { api } from "@/lib/api";
import { dateRange } from "@/lib/finding";
import { rows } from "@/lib/verdict";
import { Freshness } from "../_views/landing";
import { SortableTable } from "../_views/sortable";

export const metadata: Metadata = {
  title: "All tokens",
  description: "Search and filter every nad.fun token Nuno checks: real owners, linked wallets and trading, with the proof one click away.",
};

export default function Tokens() {
  const meta = api.meta("live");
  const all = rows("live");
  const range = meta?.window.startTime && meta.window.endTime ? dateRange(meta.window.startTime, meta.window.endTime) : null;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">All tokens</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {all.length} nad.fun tokens{range ? ` launched ${range}` : ""}. Click a token for its wallet groups and the proof.
          </p>
        </div>
        {meta ? <Freshness meta={meta} tokens={all.length} /> : null}
      </div>
      <div className="card mt-6 px-4 py-2 sm:px-6">
        <SortableTable rows={all} base="" limit={50} syncUrl />
      </div>
    </div>
  );
}
