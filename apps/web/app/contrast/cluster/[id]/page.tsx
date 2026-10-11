import { PLACEHOLDER } from "@/lib/api";
import { ClusterView, clusterParams } from "../../../_views/cluster";
import { Sheet } from "../../../sheet";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = clusterParams("contrast");
  return params.length ? params : [{ id: PLACEHOLDER }];
}

export default async function ClusterPage({ params }: { params: Promise<{ id: string }> }) {
  return <Sheet><ClusterView id={(await params).id} dataset="contrast" /></Sheet>;
}
