import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import Link from "next/link";
import { testnetDeployment } from "@/lib/deployments";
import { addrUrl, short } from "@/lib/format";
import { Logo } from "./logo";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Nuno: the real numbers behind every nad.fun launch",
  description: "Cluster-adjusted holders, concentration and organic volume for nad.fun tokens on Monad, with on-chain evidence.",
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const REPO = "https://github.com/andrew1234-arch/nuno";

function Nav() {
  const links: Array<[string, string]> = [
    ["/", "Screener"],
    ["/#how", "How it works"],
    ["/methodology/", "Methodology"],
    ["/#faq", "FAQ"],
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--accent)]">
          <Logo className="h-5 w-7" />
          nuno.
        </Link>
        <div className="hidden items-center gap-1 rounded-full bg-[var(--panel)] p-1 text-sm md:flex">
          {links.map(([href, label], i) => (
            <Link
              key={href}
              href={href}
              className={`pill px-4 py-1.5 ${i === 0 ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--accent)]"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <a href={`${BASE}/api/tokens.json`} className="pill border border-[var(--line)] px-4 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]">
          Static API
        </a>
      </nav>
    </header>
  );
}

function Footer() {
  const dep = testnetDeployment();
  return (
    <footer className="band-plain pt-10">
      <div className="notch card mx-2 overflow-hidden rounded-b-none px-6 pt-20 text-[var(--accent)] sm:mx-4 sm:px-12">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
              <Logo className="h-7 w-10" /> nuno.
            </div>
            <p className="mt-5 max-w-xs text-lg leading-snug">
              Count entities, not wallets: the real holders, concentration and volume behind nad.fun launches.
            </p>
          </div>
          <div className="text-sm">
            <p className="text-[var(--accent-soft)]">On-chain feed (Monad testnet)</p>
            {dep ? (
              <ul className="mt-3 space-y-2">
                <li>
                  NunoFeed{" "}
                  <a className="mono hover:underline" href={addrUrl(dep.NunoFeed, dep.chainId)} target="_blank" rel="noreferrer">{short(dep.NunoFeed)}</a>
                </li>
                <li>
                  OrganicGate{" "}
                  <a className="mono hover:underline" href={addrUrl(dep.OrganicGate, dep.chainId)} target="_blank" rel="noreferrer">{short(dep.OrganicGate)}</a>
                </li>
              </ul>
            ) : (
              <p className="mt-3">Not deployed yet.</p>
            )}
            <p className="mt-6 text-[var(--accent-soft)]">Data</p>
            <p className="mt-3">Reads Monad mainnet (chain 143), read-only.</p>
          </div>
          <div className="text-sm">
            <p className="text-[var(--accent-soft)]">Read it yourself</p>
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {[
                [`${BASE}/api/tokens.json`, "All tokens (JSON)"],
                [`${BASE}/api/meta.json`, "Window and counts (JSON)"],
                [`${BASE}/methodology/`, "Methodology"],
                [REPO, "Source code"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="flex items-center justify-between py-2.5 hover:underline">
                    {label} <span aria-hidden="true">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none mx-auto -mb-8 mt-10 max-w-6xl select-none text-center text-[clamp(6rem,24vw,20rem)] font-semibold leading-none tracking-tighter text-[var(--panel)]">
          nuno
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] py-5 text-xs">
          <span>Clusters are probabilistic. Every link shows its evidence.</span>
          <span>MIT licensed · Monad Metropolis 2026</span>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen">
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
