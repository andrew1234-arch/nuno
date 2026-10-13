import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { testnetDeployment } from "@/lib/deployments";
import { addrUrl } from "@/lib/format";
import { Logo } from "./logo";
import { api, hasDataset } from "@/lib/api";
import { dateRange } from "@/lib/finding";
import { ONE_LINER, SITE_URL, TAGLINE } from "@/lib/copy";
import { searchItems } from "@/lib/verdict";
import { FreshnessBar } from "./_views/freshness-bar";
import { MenuCloser } from "./_views/menu-closer";
import { NavLinks } from "./_views/nav-links";
import { Search } from "./_views/search";
import { THEME_SCRIPT, ThemeToggle } from "./theme-toggle";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `Nuno: ${TAGLINE.replace(/\.$/, "")}`, template: "%s · Nuno" },
  description: ONE_LINER,
  openGraph: {
    type: "website",
    siteName: "Nuno",
    title: `Nuno: ${TAGLINE.replace(/\.$/, "")}`,
    description: ONE_LINER,
    images: [{ url: `${SITE_URL}/og.png`, width: 1200, height: 630, alt: `Nuno: ${TAGLINE}` }],
  },
  twitter: { card: "summary_large_image", title: `Nuno: ${TAGLINE.replace(/\.$/, "")}`, description: ONE_LINER, images: [`${SITE_URL}/og.png`] },
};

const REPO = "https://github.com/andrew1234-arch/nuno";

const NAV: Array<[string, string]> = [
  ["/#screener", "Screener"],
  ["/methodology/", "Methodology"],
  ["/developers/", "API"],
  ["/contracts/", "Contracts"],
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
          <a href={REPO} target="_blank" rel="noreferrer" aria-label="Source code on GitHub" className="hidden h-9 w-9 items-center justify-center rounded-md border border-[var(--line)] hover:border-[var(--accent)] sm:flex">
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
            </svg>
          </a>
          {/* Small screens: menu with search and links. */}
          <details className="menu relative lg:hidden">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--line)]" aria-label="Menu">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 shadow-md">
              <div className="md:hidden">
                <Search items={items} />
              </div>
              <ul className="mt-2 md:mt-0">
                {NAV.map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="block rounded-md px-3 py-2.5 hover:bg-[var(--panel)]">{label}</Link>
                  </li>
                ))}
                <li>
                  <a href={REPO} className="block rounded-md px-3 py-2.5 hover:bg-[var(--panel)]">GitHub</a>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}

function Freshness() {
  const meta = api.meta("live");
  if (!meta) return null;
  const range = meta.window.startTime && meta.window.endTime ? dateRange(meta.window.startTime, meta.window.endTime) : null;
  const refresh = (meta as { refreshIntervalMinutes?: number }).refreshIntervalMinutes ?? 15;
  return (
    <FreshnessBar
      sourceBlock={meta.sourceBlock}
      generatedAt={meta.generatedAt}
      window={range}
      refreshMinutes={refresh}
      contrastLabel={hasDataset("contrast") ? (api.meta("contrast")?.label ?? "historical week") : null}
    />
  );
}

function Footer() {
  const dep = testnetDeployment();
  const cols: Array<[string, Array<[string, string, boolean?]>]> = [
    ["Product", [["/", "Screener"], ["/about/", "About"]]],
    ["Methodology", [["/methodology/", "Methodology"], ["/methodology/#labels", "Labels"], ["/methodology/#start", "Getting started"]]],
    ["Build", [["/developers/", "API"], ["/contracts/", "Contracts"], [REPO, "Repository", true]]],
    [
      "On Monad",
      dep
        ? [[addrUrl(dep.NunoFeed, dep.chainId), "NunoFeed", true], [addrUrl(dep.OrganicGate, dep.chainId), "OrganicGate", true], ["https://nad.fun", "nad.fun", true]]
        : [["https://nad.fun", "nad.fun", true]],
    ],
  ];
  return (
    <footer className="mt-16 px-4 pb-4 sm:px-6 lg:px-8">
      <div className="band-plain relative overflow-hidden rounded-md px-6 pt-14 sm:px-10 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_auto]">
          <div className="max-w-sm">
            <Link href="/" className="flex items-center gap-2 text-3xl font-semibold tracking-tight text-[var(--band-ink)]">
              <Logo className="h-6 w-8" /> nuno.
            </Link>
            <p className="mt-3 text-sm text-[var(--band-soft)]">{TAGLINE}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-4">
            {cols.map(([title, links]) => (
              <div key={title}>
                <p className="text-sm font-medium text-[var(--band-ink)]">{title}</p>
                <ul className="mt-3 space-y-2 text-sm text-[var(--band-soft)]">
                  {links.map(([href, label, raw]) => (
                    <li key={label}>
                      {raw ? (
                        <a href={href} className="hover:text-[var(--c-accent)]" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{label}</a>
                      ) : (
                        <Link href={href} className="hover:text-[var(--c-accent)]">{label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--band-soft)]">
          <span>Reads nad.fun data from Monad mainnet · publishes snapshots to Monad testnet · Not financial advice</span>
          <span>Built for Monad Metropolis · MIT licensed</span>
        </div>
        {/* Oversized wordmark, cropped by the card's bottom edge. */}
        <div aria-hidden="true" className="wordmark pointer-events-none -mb-[0.22em] mt-4 select-none text-center text-[clamp(5rem,26vw,24rem)] font-bold leading-[0.8] tracking-[-0.06em]">
          NUNO
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--surface)] focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Nav />
        <Freshness />
        <MenuCloser />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
