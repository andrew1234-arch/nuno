import { PLACEHOLDER } from "@/lib/api";
import { TokenView, tokenParams } from "../../../_views/token";
import { Sheet } from "../../../sheet";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = tokenParams("contrast");
  return params.length ? params : [{ address: PLACEHOLDER }];
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  return <Sheet><TokenView address={(await params).address} dataset="contrast" /></Sheet>;
}
