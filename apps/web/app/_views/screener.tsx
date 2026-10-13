import Link from "next/link";
import { api, hasDataset, type Dataset } from "@/lib/api";
import { rows } from "@/lib/verdict";
import { SortableTable } from "./sortable";

export const baseFor = (d: Dataset) => (d === "contrast" ? "/contrast" : "");

export function ScreenerView({ dataset }: { dataset: Dataset }) {
  const meta = api.meta(dataset);
  const tokens = api.tokens(dataset);
  const contrast = hasDataset("contrast");
  return (
    <div>
      {dataset === "contrast" ? (
        <>
          <h1 className="text-2xl font-bold">{meta?.label ?? "Historical contrast"}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            A fixed historical week, kept as a separate dataset for comparison with the live window. It is not updated.{" "}
            <Link href="/" className="text-[var(--accent-text)] hover:underline">Back to the live window</Link>.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">The real numbers behind every nad.fun launch</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Raw holder counts and volume are easy to fake with wallet farms. Nuno groups wallets controlled by the same operator into entities, using
            on-chain funding, transfer and trading evidence, and recomputes each token per entity.
          </p>
          {contrast ? (
            <p className="mt-3 text-sm">
              <Link href="/contrast/" className="text-[var(--accent-text)] hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"} →</Link>
            </p>
          ) : null}
        </>
      )}
      {meta ? (
        <p className="mono mt-3 text-xs text-[var(--muted)]">
          {dataset === "live" ? "Live window" : "Dataset"}: mainnet blocks {meta.window.startBlock.toLocaleString("en-US")}–{meta.window.endBlock.toLocaleString("en-US")}
          {meta.window.startTime && meta.window.endTime ? ` (${meta.window.startTime.slice(0, 10)} → ${meta.window.endTime.slice(0, 10)})` : ""}, {tokens.length} tokens, exported{" "}
          {meta.generatedAt.slice(0, 16).replace("T", " ")} UTC.
        </p>
      ) : null}
      <SortableTable rows={rows(dataset)} base={baseFor(dataset)} />
    </div>
  );
}
