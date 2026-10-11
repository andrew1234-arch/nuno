import Link from "next/link";
import { marked } from "marked";
import { METHODOLOGY_MD } from "@/lib/methodology.generated";
import { Sheet } from "../sheet";

export default async function Methodology() {
  // Embedded from the repo's docs/METHODOLOGY.md at build time, so the page and the doc never diverge.
  const html = await marked.parse(METHODOLOGY_MD);
  return (
    <Sheet>
      <p className="max-w-3xl rounded-xl bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
        This is Nuno&apos;s full rulebook, written for people who want to check every detail. For the short, plain-language version, see{" "}
        <Link href="/#how" className="text-[var(--accent)] underline">how it works</Link>.
      </p>
      <article className="prose-nuno max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />
    </Sheet>
  );
}
