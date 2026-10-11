import type { Metadata } from "next";
import { PLACEHOLDER } from "@/lib/api";
import { TokenView, tokenMetadata, tokenParams } from "../../../_views/token";
import { Sheet } from "../../../sheet";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = tokenParams("contrast");
  return params.length ? params : [{ address: PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  return tokenMetadata((await params).address, "contrast");
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  return <Sheet><TokenView address={(await params).address} dataset="contrast" /></Sheet>;
}
