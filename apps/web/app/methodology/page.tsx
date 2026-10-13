import type { Metadata } from "next";
import Link from "next/link";
import { marked } from "marked";
import { METHODOLOGY_MD, VALIDATION_MD } from "@/lib/methodology.generated";
import { LEVEL_HINT, RULES, type Level } from "@/lib/levels";
import { Badge } from "../_views/badge";
import { DocsNav } from "./docs-nav";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How to use Nuno, what its labels mean, and the full method it uses to group wallets and count real owners.",
};

const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default async function Docs() {
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
    { title: "Validation", items: [["validation", "Hand-reviewed sample"], ...vSections.filter(([, , d]) => d === 2).map(([id, t, d]) => [id, t, d] as [string, string, number])] },
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
              every 15 minutes. Its numbers are published as open JSON and written to a contract on Monad testnet. Nothing private is used.
            </p>

            <h2 id="method" className="scroll-mt-24 pt-10 text-2xl font-semibold tracking-tight">Method</h2>
            <p className="mt-3 text-[var(--prose)]">The full rulebook, for anyone who wants to check every detail.</p>
          </div>
          <div className="prose-nuno docs max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />
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
