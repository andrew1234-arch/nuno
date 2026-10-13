import type { Metadata } from "next";
import { About } from "../_views/landing";

export const metadata: Metadata = {
  title: "About",
  description: "What Nuno found on nad.fun, how it groups wallets, and why counting people instead of wallets matters.",
};

export default function AboutPage() {
  return <About />;
}
