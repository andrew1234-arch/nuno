import { PLACEHOLDER } from "@/lib/api";
import { TokenView, tokenParams } from "../../../_views/token";

export const dynamicParams = false;

export function generateStaticParams() {
  const params = tokenParams("contrast");
  return params.length ? params : [{ address: PLACEHOLDER }];
}

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  return <TokenView address={(await params).address} dataset="contrast" />;
}
