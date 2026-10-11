"use client";

import { useEffect, useState } from "react";

const KEY = "nuno-theme";

function current(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light/dark switch. Defaults to the system theme; a choice is remembered on this device. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    setTheme(current());
    // With no saved choice the page follows the system; keep the button in step when the OS flips.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(current());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const flip = () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    setTheme(next);
  };
  const label = theme === null ? "Switch light or dark mode" : theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      title={label}
      className="pill flex h-9 w-9 items-center justify-center border border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
    >
      {/* Rendered after mount so server HTML never disagrees with the visitor's theme. */}
      {theme === null ? null : theme === "dark" ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

/** Inline in <head>: applies a remembered theme before first paint, so there is no flash. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
