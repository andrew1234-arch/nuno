import type { Metadata } from "next";
import Link from "next/link";
import { Sheet } from "./sheet";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Sheet>
      <div className="py-20 text-center">
        <h1 className="headline text-4xl">
          Nothing <span className="fade">here.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[var(--muted)]">
          This page doesn&apos;t exist, or the token wasn&apos;t launched during the week Nuno is checking.
        </p>
        <Link href="/" className="pill mt-6 inline-block bg-[var(--accent)] px-6 py-3 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90">
          Back to all tokens
        </Link>
      </div>
    </Sheet>
  );
}
