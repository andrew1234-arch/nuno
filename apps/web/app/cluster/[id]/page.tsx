import type { Metadata } from "next";
import { PLACEHOLDER } from "@/lib/api";
import { ClusterView, clusterMetadata, clusterParams } from "../../_views/cluster";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = clusterParams("live");
  return params.length ? params : [{ id: PLACEHOLDER }];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return clusterMetadata((await params).id, "live");
}

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  return <ClusterView id={(await params).id} dataset="live" />;
}
