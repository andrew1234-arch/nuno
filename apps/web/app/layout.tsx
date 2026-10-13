import type { Metadata } from "next";
import { Inter_Tight } from "next/font/google";
import Link from "next/link";
import { testnetDeployment } from "@/lib/deployments";
import { addrUrl, short } from "@/lib/format";
import { Logo } from "./logo";
import { searchItems } from "@/lib/verdict";
import { MenuCloser } from "./_views/menu-closer";
import { NavLinks } from "./_views/nav-links";
import { Search } from "./_views/search";
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
  ["/", "Home"],
  ["/tokens/", "Tokens"],
  ["/docs/", "Docs"],
  ["/developers/", "Developers"],
  ["/about/", "About"],
];

function Nav() {
  const items = searchItems("live");
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]/90 backdrop-blur">
      <nav aria-label="Main" className="grid h-16 w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-xl font-semibold tracking-tight text-[var(--accent-text)]" aria-label="Nuno home">
          <Logo className="h-5 w-7" />
          nuno.
        </Link>
        <div className="hidden items-center justify-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 text-sm lg:flex">
          <NavLinks items={NAV} />
        </div>
        <div className="flex items-center justify-end gap-2 lg:col-start-3">
          <div className="hidden w-64 md:block xl:w-72">
            <Search items={items} />
          </div>
          <ThemeToggle />
          <a href={`${BASE}/api/tokens.json`} className="pill hidden border border-[var(--line)] px-3.5 py-1.5 text-sm hover:border-[var(--accent)] hover:text-[var(--accent-text)] sm:inline-block">
            API
          </a>
          {/* Small screens: menu with search and links. */}
          <details className="menu relative lg:hidden">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--line)]" aria-label="Menu">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-xl">
              <div className="md:hidden">
                <Search items={items} />
              </div>
              <ul className="mt-2 md:mt-0">
                {NAV.map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="block rounded-xl px-3 py-2.5 hover:bg-[var(--panel)]">{label}</Link>
                  </li>
                ))}
                <li>
                  <a href={`${BASE}/api/tokens.json`} className="block rounded-xl px-3 py-2.5 hover:bg-[var(--panel)]">API (JSON)</a>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  const dep = testnetDeployment();
  const cols: Array<[string, Array<[string, string, boolean?]>]> = [
    ["Product", [["/", "Home"], ["/tokens/", "All tokens"], ["/about/", "About"]]],
    ["Developers", [["/developers/", "Developer guide"], [`${BASE}/api/tokens.json`, "tokens.json", true], [`${BASE}/api/meta.json`, "meta.json", true]]],
    ["Resources", [["/docs/", "Docs"], ["/docs/#labels", "How labels work"], [REPO, "Source code", true]]],
  ];
  return (
    <footer className="mt-16 border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="grid w-full gap-10 px-4 py-12 sm:px-6 lg:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--accent-text)]">
            <Logo className="h-5 w-7" /> nuno.
          </Link>
          <p className="mt-3 max-w-xs text-sm text-[var(--muted)]">How many real people are behind a nad.fun token, not just how many wallets. Built on Monad.</p>
          {dep ? (
            <p className="mt-4 text-xs text-[var(--muted)]">
              NunoFeed{" "}
              <a className="mono hover:text-[var(--accent-text)]" href={addrUrl(dep.NunoFeed, dep.chainId)} target="_blank" rel="noreferrer">{short(dep.NunoFeed)}</a>
              {" · "}OrganicGate{" "}
              <a className="mono hover:text-[var(--accent-text)]" href={addrUrl(dep.OrganicGate, dep.chainId)} target="_blank" rel="noreferrer">{short(dep.OrganicGate)}</a>
              <br />on Monad testnet
            </p>
          ) : null}
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <p className="text-sm font-medium">{title}</p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              {links.map(([href, label, raw]) => (
                <li key={href}>
                  {raw ? <a href={href} className="hover:text-[var(--accent-text)]">{label}</a> : <Link href={href} className="hover:text-[var(--accent-text)]">{label}</Link>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--line)]">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-[var(--muted)] sm:px-6 lg:px-8">
          <span>Labels describe links found in public Monad transactions. Not financial advice.</span>
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
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface)] focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Nav />
        <MenuCloser />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
