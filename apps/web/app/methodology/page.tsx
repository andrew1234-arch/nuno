import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";

export const dynamic = "force-static";

export default async function Methodology() {
  // Rendered from the repo's docs/METHODOLOGY.md so the page and the doc never diverge.
  const md = await readFile(join(process.cwd(), "../../docs/METHODOLOGY.md"), "utf8");
  const html = await marked.parse(md);
  return <article className="prose-nuno max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />;
}
