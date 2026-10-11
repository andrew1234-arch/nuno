import Link from "next/link";
import { Sheet } from "./sheet";

export default function NotFound() {
  return <Sheet><div className="py-20 text-center">
      <p className="text-[var(--muted)]">Not tracked by Nuno (only nad.fun tokens launched in the indexed window are covered).</p>
      <Link href="/" className="mt-4 inline-block text-[var(--accent)]">Back to the screener</Link>
    </div></Sheet>;
}
