import { PLACEHOLDER } from "@/lib/api";
import { ClusterView, clusterParams } from "../../_views/cluster";
import { Sheet } from "../../sheet";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = clusterParams("live");
  return params.length ? params : [{ id: PLACEHOLDER }];
}

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  return <Sheet><ClusterView id={(await params).id} dataset="live" /></Sheet>;
}
