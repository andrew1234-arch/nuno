import type { Metadata } from "next";
import { PLACEHOLDER, api } from "@/lib/api";
import { ClusterView, clusterParams } from "../../_views/cluster";
import { Sheet } from "../../sheet";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = clusterParams("live");
  return params.length ? params : [{ id: PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const c = api.cluster((await params).id, "live");
  return c ? { title: `Wallet group ${c.id.slice(0, 6)}…${c.id.slice(-4)}`, description: `${c.size} wallets that very likely belong to one owner, with the public proof.` } : { title: "Group not found" };
}

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  return <Sheet><ClusterView id={(await params).id} dataset="live" /></Sheet>;
}
