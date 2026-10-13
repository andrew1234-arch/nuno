import type { Metadata } from "next";
import Link from "next/link";
import { api, type Snapshot } from "@/lib/api";
import { testnetDeployment } from "@/lib/deployments";
import { addrUrl, short, txUrl } from "@/lib/format";
import { CopyButton } from "../_views/copy";

export const metadata: Metadata = {
  title: "Contracts",
  description: "NunoFeed and OrganicGate on Monad testnet: addresses, what they do, and the latest snapshot transactions.",
};

export default function Contracts() {
  const dep = testnetDeployment();
  // Latest NunoFeed publish per token, from the export; newest first.
  const snaps = api
    .tokens("live")
    .map((t) => ({ t, s: api.token(t.address, "live")?.latestSnapshot ?? null }))
    .filter((x): x is { t: (typeof x)["t"]; s: Snapshot } => x.s !== null)
    .sort((a, b) => b.s.publishedAt.localeCompare(a.s.publishedAt));
  const cards: Array<[string, string | undefined, string]> = [
    ["NunoFeed", dep?.NunoFeed, "Stores the latest cluster-adjusted numbers per nad.fun token, written by Nuno's publisher, readable by any app or contract."],
    ["OrganicGate", dep?.OrganicGate, "Example consumer: one call reverts unless a token's snapshot is fresh and its cluster-held supply is under your limit."],
  ];
  return (
    <div className="w-full space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Contracts</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          Nuno reads nad.fun on Monad mainnet and publishes snapshots to Monad testnet (chain {dep?.chainId ?? 10143}). How to call them:{" "}
          <Link href="/developers/#contracts" className="text-[var(--accent-text)] underline">API page</Link>.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(([name, addr, what]) => (
          <section key={name} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-semibold">{name}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{what}</p>
            {addr ? (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="mono break-all">{addr}</span>
                <CopyButton text={addr} />
                <a href={addrUrl(addr, dep!.chainId)} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] hover:underline">Explorer ↗</a>
              </p>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">Not deployed yet.</p>
            )}
          </section>
        ))}
      </div>
      {dep ? (
        <p className="text-xs text-[var(--muted)]">
          Deployed at testnet block <span className="mono">{dep.deployBlock.toLocaleString("en-US")}</span> · publisher{" "}
          <a href={addrUrl(dep.publisher, dep.chainId)} target="_blank" rel="noreferrer" className="mono hover:text-[var(--accent-text)]">{short(dep.publisher)}</a>
        </p>
      ) : null}
      <section aria-labelledby="pubs">
        <h2 id="pubs" className="text-lg font-semibold">Latest publish transactions</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">The 10 most recent NunoFeed writes in the export (the latest per token). Each opens on the testnet explorer.</p>
        {snaps.length ? (
          <div className="mt-3 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-xs text-[var(--muted)]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Published (UTC)</th>
                  <th className="px-3 font-medium">Token</th>
                  <th className="px-3 font-medium">Tx</th>
                  <th className="px-3 text-right font-medium">Mainnet block</th>
                  <th className="px-3 text-right font-medium">Gas</th>
                </tr>
              </thead>
              <tbody>
                {snaps.slice(0, 10).map(({ t, s }) => (
                  <tr key={s.txHash} className="border-t border-[var(--line)]">
                    <td className="px-3 py-2 text-xs">{s.publishedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3"><Link href={`/token/${t.address}/`} className="font-medium hover:text-[var(--accent-text)]">{t.symbol}</Link></td>
                    <td className="mono px-3 text-xs"><a href={txUrl(s.txHash, s.chainId)} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] hover:underline">{short(s.txHash)}</a></td>
                    <td className="mono px-3 text-right text-xs">{s.sourceBlock.toLocaleString("en-US")}</td>
                    <td className="mono px-3 text-right text-xs">{Number(s.gasUsed).toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-[var(--line)] p-3 text-sm text-[var(--muted)]">No snapshots in this export yet.</p>
        )}
      </section>
    </div>
  );
}
