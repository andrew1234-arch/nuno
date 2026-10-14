import Link from "next/link";
import { txUrl } from "@/lib/format";

/** "Verified by Nansen": Nansen's First Funder for this wallet is the same funder and tx Nuno found. */
export function NansenBadge({ tx, title }: { tx?: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-[var(--organic)] px-1.5 py-0.5 text-[11px] text-[var(--organic)]" title={title ?? "Nansen's First Funder for this wallet is the same funder and transaction Nuno found"}>
      <span aria-hidden="true">✓</span>
      {tx ? (
        <a href={txUrl(tx)} target="_blank" rel="noreferrer" className="hover:underline">Verified by Nansen</a>
      ) : (
        <Link href="/methodology/#nansen" className="hover:underline">Verified by Nansen</Link>
      )}
    </span>
  );
}
