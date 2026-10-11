import type { Metadata } from "next";
import { ScreenerView } from "../_views/screener";
import { Sheet } from "../sheet";

export const metadata: Metadata = { title: "Historical comparison" };

export default function ContrastScreener() {
  return <Sheet><ScreenerView dataset="contrast" /></Sheet>;
}
