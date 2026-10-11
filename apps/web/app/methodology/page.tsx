import { marked } from "marked";
import { METHODOLOGY_MD } from "@/lib/methodology.generated";
import { Sheet } from "../sheet";

export default async function Methodology() {
  // Embedded from the repo's docs/METHODOLOGY.md at build time, so the page and the doc never diverge.
  const html = await marked.parse(METHODOLOGY_MD);
  return <Sheet><article className="prose-nuno max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} /></Sheet>;
}
