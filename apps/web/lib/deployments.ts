import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Deployment {
  chainId: number;
  NunoFeed: string;
  OrganicGate: string;
  deployBlock: number;
  publisher: string;
}

/** Testnet contract addresses written by `pnpm deploy:contracts`; null before the first deploy. */
export function testnetDeployment(): Deployment | null {
  const path = resolve(process.cwd(), "../../deployments/monad-testnet.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Deployment) : null;
}
