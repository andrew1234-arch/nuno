import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nuno: the real numbers behind every nad.fun launch",
  description: "Cluster-adjusted holders, concentration and organic volume for nad.fun tokens on Monad, with on-chain evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--line)]">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              nuno<span className="text-[var(--accent)]">.</span>
            </Link>
            <Link href="/" className="text-sm text-[var(--muted)] hover:text-white">Screener</Link>
            <Link href="/methodology" className="text-sm text-[var(--muted)] hover:text-white">Methodology</Link>
            <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/meta.json`} className="text-sm text-[var(--muted)] hover:text-white">Static API</a>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-[var(--muted)]">
          Analysis reads Monad mainnet; snapshots are published to NunoFeed on Monad testnet. Clusters are probabilistic. Every link shows its evidence.
        </footer>
      </body>
    </html>
  );
}
