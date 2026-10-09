import { marked } from "marked";
import { METHODOLOGY_MD } from "@/lib/methodology.generated";

export const dynamic = "force-static";

export default async function Methodology() {
  // Embedded from the repo's docs/METHODOLOGY.md at build time, so the page and the doc never diverge.
  const html = await marked.parse(METHODOLOGY_MD);
  return <article className="prose-nuno max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />;
}
