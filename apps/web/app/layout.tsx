import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import Link from "next/link";
import { testnetDeployment } from "@/lib/deployments";
import { addrUrl, short } from "@/lib/format";
import { Logo } from "./logo";
import { THEME_SCRIPT, ThemeToggle } from "./theme-toggle";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Nuno: check a nad.fun token before you buy", template: "%s · Nuno" },
  description: "Check any nad.fun token on Monad: how many real people own it, whether its creator runs a group of linked wallets, and the public proof. Free web app, JSON API and on-chain feed.",
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const REPO = "https://github.com/andrew1234-arch/nuno";

const NAV: Array<[string, string]> = [
  ["/#tokens", "Check a token"],
  ["/#how-to", "How to use"],
  ["/developers/", "Developers"],
  ["/about/", "About"],
];

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
      <nav aria-label="Main">
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--accent-text)]" aria-label="Nuno home">
          <Logo className="h-5 w-7" />
          nuno.
        </Link>
        <div className="hidden items-center gap-1 rounded-full bg-[var(--panel)] p-1 text-sm md:flex">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="pill px-4 py-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--accent-text)]">
              {label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/developers/" className="pill border border-[var(--line)] px-4 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent-text)]">
            API
          </Link>
        </div>
      </div>
      {/* Small screens: the same links as a scrollable row (the wide-screen copy is hidden there). */}
      <div className="flex gap-1 overflow-x-auto px-4 pb-2 text-sm sm:px-6 md:hidden">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className="pill shrink-0 bg-[var(--panel)] px-3 py-1 text-[var(--muted)] hover:text-[var(--accent-text)]">
            {label}
          </Link>
        ))}
      </div>
      </nav>
    </header>
  );
}

function Footer() {
  const dep = testnetDeployment();
  return (
    <footer className="band-plain pt-10">
      <div className="notch card mx-2 overflow-hidden rounded-b-none px-6 pt-20 text-[var(--accent-text)] sm:mx-4 sm:px-12">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
              <Logo className="h-7 w-10" /> nuno.
            </div>
            <p className="mt-5 max-w-xs text-lg leading-snug">
              Check a nad.fun token before you buy: how many real people are behind it, not just how many wallets.
            </p>
          </div>
          <div className="text-sm">
            <p className="text-[var(--muted)]">On the Monad test network</p>
            <p className="mt-3">Nuno writes its numbers to a contract that other apps can read:</p>
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
            <p className="mt-6 text-[var(--muted)]">Where the data comes from</p>
            <p className="mt-3">The public Monad blockchain. Nuno only reads it; nothing private is used.</p>
          </div>
          <div className="text-sm">
            <p className="text-[var(--muted)]">Read it yourself</p>
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {[
                [`${BASE}/api/tokens.json`, "Download all token numbers"],
                [`${BASE}/api/meta.json`, "Download the summary"],
                [`${BASE}/developers/`, "Use the API and contracts"],
                [`${BASE}/methodology/`, "Read the detailed method"],
                [REPO, "See the source code"],
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
          <span>Groups are a careful best guess, not a certainty. Every link shows its proof.</span>
          <span>MIT licensed · Monad Metropolis 2026</span>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface)] focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Nav />
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
