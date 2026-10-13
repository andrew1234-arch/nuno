import type { Metadata } from "next";
import { PLACEHOLDER } from "@/lib/api";
import { TokenView, tokenMetadata, tokenParams } from "../../_views/token";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = tokenParams("live");
  return params.length ? params : [{ address: PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  return tokenMetadata((await params).address, "live");
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  return <TokenView address={(await params).address} dataset="live" />;
}
