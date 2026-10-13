"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Main navigation links; the current section is highlighted. */
export function NavLinks({ items }: { items: Array<[string, string]> }) {
  const path = usePathname();
  const isActive = (href: string) => (href.startsWith("/#") || href === "/" ? path === "/" || path.startsWith("/token/") || path.startsWith("/cluster/") : path.startsWith(href));
  return (
    <>
      {items.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={`rounded-md px-4 py-1.5 ${isActive(href) ? "bg-[var(--accent)] font-medium text-[var(--c-accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"}`}
        >
          {label}
        </Link>
      ))}
    </>
  );
}
