import type { Metadata } from "next";
import { PLACEHOLDER, api } from "@/lib/api";
import { TokenView, tokenParams } from "../../_views/token";
import { Sheet } from "../../sheet";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = tokenParams("live");
  return params.length ? params : [{ address: PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const t = api.token((await params).address, "live");
  return t ? { title: `${t.name} ($${t.symbol})`, description: `Who really owns ${t.name} ($${t.symbol}) on nad.fun: real owners, wallet groups and the public proof.` } : { title: "Token not found" };
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  return <Sheet><TokenView address={(await params).address} dataset="live" /></Sheet>;
}
