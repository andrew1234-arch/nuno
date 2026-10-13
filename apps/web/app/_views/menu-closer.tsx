"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Closes the small-screen menu (a <details>) after each navigation. */
export function MenuCloser() {
  const path = usePathname();
  useEffect(() => {
    document.querySelectorAll("details.menu[open]").forEach((d) => d.removeAttribute("open"));
  }, [path]);
  return null;
}
