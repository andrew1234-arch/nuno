import type { Metadata } from "next";
import Link from "next/link";
import { marked } from "marked";
import { METHODOLOGY_MD, VALIDATION_MD } from "@/lib/methodology.generated";
import { LEVEL_HINT, RULES, type Level } from "@/lib/levels";
import { Badge } from "../_views/badge";
import { DocsNav } from "./docs-nav";
import { api } from "@/lib/api";
import { addrUrl, short, txUrl } from "@/lib/format";
import { NansenBadge } from "../_views/nansen-badge";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How to use Nuno, what its labels mean, and the full method it uses to group wallets and count real owners.",
};

const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default async function Docs() {
  const nansen = api.nansen("live");
  // Embedded from docs/METHODOLOGY.md at build time, so the page and the doc never diverge. Its title is
  // replaced by the section heading below; h2/h3 get ids for the sidebar.
  const md = METHODOLOGY_MD.replace(/^# .*\n/, "");
  const sections: Array<[string, string, number]> = [];
  const html = (await marked.parse(md)).replace(/<h([23])>(.*?)<\/h\1>/g, (_, d: string, inner: string) => {
    const id = `m-${slug(inner)}`;
    sections.push([id, inner.replace(/<[^>]+>/g, ""), Number(d)]);
    return `<h${d} id="${id}">${inner}</h${d}>`;
  });
  // Validation: the hand-reviewed sample, rendered as-is (its own caveats included).
  const vSections: Array<[string, string, number]> = [];
  const vHtml = (await marked.parse(VALIDATION_MD.replace(/^# .*\n/, ""))).replace(/<h([23])>(.*?)<\/h\1>/g, (_, d: string, inner: string) => {
    const id = `v-${slug(inner)}`;
    vSections.push([id, inner.replace(/<[^>]+>/g, ""), Number(d)]);
    return `<h${d} id="${id}">${inner}</h${d}>`;
  });
  const toc: Array<{ title: string; items: Array<[string, string, number?]> }> = [
    { title: "Guide", items: [["start", "Getting started"], ["labels", "Labels"], ["data", "Where the data comes from"]] },
    { title: "Method", items: [["method", "Overview"], ...sections.map(([id, t, d]) => [id, t, d] as [string, string, number])] },
    { title: "Validation", items: [["nansen", "Nansen cross-checks"], ["validation", "Hand-reviewed sample"], ...vSections.filter(([, , d]) => d === 2).map(([id, t, d]) => [id, t, d] as [string, string, number])] },
  ];

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <DocsNav groups={toc} />
        <article className="card min-w-0 px-5 py-8 sm:px-10">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-[var(--accent-text)]">Transparency is the product</p>
            <h1 className="headline mt-2 text-4xl sm:text-5xl">
              Methodology
            </h1>
            <p className="mt-4 text-lg text-[var(--muted)]">
              Everything about checking a token, what the labels mean and the exact rules behind them. Building something? See the{" "}
              <Link href="/developers/" className="text-[var(--accent-text)] underline">developer guide</Link>.
            </p>

            <h2 id="start" className="scroll-mt-24 pt-10 text-2xl font-semibold tracking-tight">Getting started</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-[var(--prose)]">
              <li>Copy a token&apos;s address from nad.fun, or remember its name or ticker.</li>
              <li>Paste it into the search box at the top of any page. Suggestions appear as you type; press Enter to open the token.</li>
              <li>Read its label and the one-line reasons under it.</li>
              <li>Open a wallet group to see which wallets are linked, why, and the public transaction behind each link.</li>
            </ol>
            <p className="mt-4 text-[var(--prose)]">
              To browse instead, open <Link href="/" className="text-[var(--accent-text)] underline">screener</Link>: filter by label, sort by trading,
              holders or holder gap, and share the link, which keeps your filters.
            </p>

            <h2 id="labels" className="scroll-mt-24 pt-10 text-2xl font-semibold tracking-tight">Labels</h2>
            <p className="mt-3 text-[var(--prose)]">
              Every token gets one label. Labels describe links found in public transactions, not whether a token is good or bad, and are not financial advice.
            </p>
            <ul className="mt-4 space-y-3">
              {(["red", "amber", "clear", "none"] as Level[]).map((l) => (
                <li key={l} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <Badge level={l} />
                  <span className="text-sm text-[var(--muted)]">{LEVEL_HINT[l]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 font-medium">The rules, in order</p>
            <ul className="mt-3 space-y-2">
              {RULES.map(([level, text]) => (
                <li key={text} className="flex items-start gap-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${level === "red" ? "bg-[var(--flag)]" : "bg-[var(--c-accent)]"}`} aria-hidden="true" />
                  <span>
                    <b className="font-medium">{level === "red" ? "Many linked wallets" : "Some linked wallets"}:</b> {text}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-[var(--muted)]">
              The cut-offs are our own choice and have not been tested against hand-labelled tokens. Grouping itself was checked by hand on a small sample only.
            </p>

            <h2 id="data" className="scroll-mt-24 pt-10 text-2xl font-semibold tracking-tight">Where the data comes from</h2>
            <p className="mt-3 text-[var(--prose)]">
              Nuno reads every nad.fun launch, trade and transfer from the public Monad blockchain, traces where each buyer&apos;s money came from, and updates
              every 20 minutes. Its numbers are published as open JSON and written to a contract on Monad testnet. Nothing private is used.
            </p>

            <h2 id="method" className="scroll-mt-24 pt-10 text-2xl font-semibold tracking-tight">Method</h2>
            <p className="mt-3 text-[var(--prose)]">The full rulebook, for anyone who wants to check every detail.</p>
          </div>
          <div className="prose-nuno docs max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />
          <div className="max-w-4xl">
            <h2 id="nansen" className="scroll-mt-24 pt-10 text-2xl font-semibold tracking-tight">Nansen cross-checks</h2>
            <p className="mt-3 text-[var(--prose)]">
              For hub funders, Nuno asks Nansen&apos;s <span className="mono text-sm">related-wallets</span> endpoint about a wallet the hub funded and compares
              Nansen&apos;s &quot;First Funder&quot; with its own funding trace. {nansen ? <><b>{nansen.matches} of {nansen.checked}</b> agree on both the funder and the transaction.</> : "No checks in this export."}{" "}
              Matching wallets carry a <NansenBadge /> badge on their entity page. Nansen labels exchanges and other shared infrastructure, which stops them from
              linking unrelated wallets; none of the funders checked so far had such a label.
            </p>
            {nansen?.checks.length ? (
              <div className="mt-4 overflow-x-auto rounded-md border border-[var(--line)]">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="text-xs text-[var(--muted)]">
                    <tr className="text-left"><th className="px-3 py-2 font-medium">Wallet</th><th className="px-3 font-medium">Nansen first funder</th><th className="px-3 font-medium">Nuno first funder</th><th className="px-3 font-medium">Tx</th><th className="px-3 font-medium">Result</th></tr>
                  </thead>
                  <tbody>
                    {nansen.checks.map((k) => (
                      <tr key={k.address} className="border-t border-[var(--line)]">
                        <td className="mono px-3 py-1.5 text-xs">
                          <a href={addrUrl(k.address)} target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)]">{short(k.address)}</a>
                          {k.entityId ? <> · <Link href={`/cluster/${k.entityId}/`} className="text-[var(--accent-text)] hover:underline">#{k.entityId.slice(2, 8)}</Link></> : null}
                        </td>
                        <td className="mono px-3 text-xs">{k.nansenFirstFunder ? short(k.nansenFirstFunder.address) : "–"}{k.nansenFirstFunder?.label ? <span className="ml-1 font-sans text-[var(--muted)]">({k.nansenFirstFunder.label})</span> : null}</td>
                        <td className="mono px-3 text-xs">{k.nunoFirstFunder ? short(k.nunoFirstFunder.address) : "–"}</td>
                        <td className="mono px-3 text-xs">{k.nansenFirstFunder ? <a href={txUrl(k.nansenFirstFunder.tx)} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] hover:underline">{short(k.nansenFirstFunder.tx)}</a> : "–"}</td>
                        <td className="px-3 text-xs">{k.match ? <span className="text-[var(--organic)]">✓ same funder and tx</span> : <span className="text-[var(--muted)]">differs</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
          <div className="max-w-3xl">
            <h2 id="validation" className="scroll-mt-24 pt-10 text-2xl font-semibold tracking-tight">Validation</h2>
            <p className="mt-3 text-[var(--prose)]">
              There is no labelled ground truth for wallet clusters. This is the hand review of a reproducible random sample, shown in full. Accuracy is
              claimed for this sample only.
            </p>
          </div>
          <div className="prose-nuno docs max-w-3xl" dangerouslySetInnerHTML={{ __html: vHtml }} />
        </article>
      </div>
    </div>
  );
}
