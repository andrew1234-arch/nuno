import Link from "next/link";
import { api, hasDataset, type Dataset } from "@/lib/api";
import { FINDING_TEXT, PAYOUTS, SEEDER, SEEDER_DEPOSIT } from "@/lib/finding";
import { addrUrl, short, txUrl } from "@/lib/format";
import { SortableTable } from "./sortable";

export const baseFor = (d: Dataset) => (d === "contrast" ? "/contrast" : "");

function Finding() {
  return (
    <section className="mt-4 rounded-lg border border-[var(--accent)] bg-[var(--panel)] p-4 text-sm">
      <p className="font-semibold">{FINDING_TEXT}</p>
      <p className="mt-2 text-[var(--muted)]">
        Seeder <a className="mono hover:text-white" href={addrUrl(SEEDER)} target="_blank" rel="noreferrer">{short(SEEDER)}</a> received{" "}
        {SEEDER_DEPOSIT.mon.toLocaleString("en-US")} MON in{" "}
        <a className="mono text-[var(--accent)] hover:underline" href={txUrl(SEEDER_DEPOSIT.tx)} target="_blank" rel="noreferrer">{short(SEEDER_DEPOSIT.tx)}</a>{" "}
        (block {SEEDER_DEPOSIT.block.toLocaleString("en-US")}), then sent 14,995 MON to each creator wallet:
      </p>
      <ul className="mono mt-2 grid gap-x-4 text-xs sm:grid-cols-2">
        {PAYOUTS.map((p) => (
          <li key={p.tx}>
            <a className="text-[var(--accent)] hover:underline" href={txUrl(p.tx)} target="_blank" rel="noreferrer">{short(p.tx)}</a>{" "}
            → <a className="hover:text-white" href={addrUrl(p.wallet)} target="_blank" rel="noreferrer">{short(p.wallet)}</a>{" "}
            <span className="text-[var(--muted)]">block {p.block.toLocaleString("en-US")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
            <Link href="/" className="text-[var(--accent)] hover:underline">Back to the live window</Link>.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">The real numbers behind every nad.fun launch</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Raw holder counts and volume are easy to fake with wallet farms. Nuno groups wallets controlled by the same operator into entities, using
            on-chain funding, transfer and trading evidence, and recomputes each token per entity.
          </p>
          <Finding />
          {contrast ? (
            <p className="mt-3 text-sm">
              <Link href="/contrast/" className="text-[var(--accent)] hover:underline">{api.meta("contrast")?.label ?? "Historical contrast"} →</Link>
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
      <SortableTable tokens={tokens} base={baseFor(dataset)} />
    </div>
  );
}
