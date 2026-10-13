import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { testnetDeployment } from "@/lib/deployments";
import { addrUrl } from "@/lib/format";
import { RULES } from "@/lib/verdict";
import { Badge } from "../_views/badge";
import { CopyButton } from "../_views/copy";
import { ONE_LINER } from "@/lib/copy";
import { Sheet } from "../sheet";

export const metadata: Metadata = {
  title: "API",
  description: ONE_LINER,
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Code({ children }: { children: string }) {
  return (
    <div className="relative mt-3">
      <div className="absolute right-2 top-2"><CopyButton text={children} /></div>
      <pre className="mono overflow-x-auto rounded-md bg-[var(--panel)] p-4 pr-16 text-xs leading-relaxed">{children}</pre>
    </div>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 pt-6 text-2xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export default function Developers() {
  const dep = testnetDeployment();
  const sample = api.tokens("live").find((t) => t.metrics && t.metrics.rawHolders > 0)?.address ?? "0x…";
  const firstToken = api.tokens("live").find((t) => t.address === sample);
  const detail = api.token(sample, "live");
  const cid = detail?.clusters?.[0]?.id ?? api.clusterIds("live")[0];
  const cl = cid ? api.cluster(cid, "live") : null;
  const wal = cl ? api.wallet(cl.members[0]!, "live") : null;
  const excerpt = (v: unknown) => JSON.stringify(v, null, 2);
  const samples: Record<string, string> = {
    "api/meta.json": excerpt(api.meta("live")),
    "api/tokens.json": excerpt({ count: api.tokens("live").length, tokens: [firstToken, "…"] }),
    "api/tokens/{token}.json": excerpt(detail ? { ...detail, clusters: detail.clusters.slice(0, 1).map((c) => ({ ...c, members: [...c.members.slice(0, 2), "…"], links: [c.links[0], "…"] })), evidenceCanonical: "…" } : null),
    "api/clusters/{groupId}.json": excerpt(cl ? { ...cl, members: [...cl.members.slice(0, 3), "…"], createdTokens: [...cl.createdTokens.slice(0, 2), "…"], links: [cl.links[0], "…"] } : null),
    "api/wallets/{wallet}.json": excerpt(wal),
  };
  const endpoints: Array<[string, string]> = [
    ["api/meta.json", "Window (blocks and dates), data freshness, counts."],
    ["api/tokens.json", "Every token in the window with its numbers. Start here."],
    ["api/tokens/{token}.json", "One token: numbers, the wallet groups that trade it with their links and proof, and its latest on-chain snapshot."],
    ["api/clusters/{groupId}.json", "One wallet group: members, tokens it launched, every link with its transactions."],
    ["api/wallets/{wallet}.json", "One wallet in a group: its group, who funded it, whom it funded, its trades."],
  ];
  const fields: Array<[string, string]> = [
    ["rawHolders → realHolders", "Wallets holding the token → real owners, with each wallet group counted once."],
    ["clusterSupplyBps", "Share of supply held by wallet groups, in basis points (100 = 1%)."],
    ["creatorLinkedSupplyBps", "Share held by the creator and every wallet linked to them."],
    ["effectiveTop10Bps", "Share held by the 10 biggest owners, groups counted as one."],
    ["rawVolume → organicVolume", "All trading → trading by owners who kept their tokens, in wei (MON, 18 decimals)."],
    ["organicVolumeBps", "organicVolume as a share of rawVolume."],
    ["evidenceRoot", "keccak256 of the canonical proof behind the numbers; the same value is stored on-chain."],
  ];
  return (
    <Sheet>
      <div className="max-w-3xl">
        <h1 className="headline text-4xl sm:text-5xl">
          Use Nuno <span className="fade">in Your App</span>
        </h1>
        <p className="mt-4 text-lg text-[var(--muted)]">
          Nuno counts people, not wallets. The numbers on this site are open. Read them as static JSON from any app or bot, or straight from a contract on Monad. No key, no sign-up, no cost.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="On this page">
          {[["#api", "JSON API"], ["#rules", "Label rules"], ["#contracts", "Contracts"], ["#limits", "Limits"]].map(([h, l]) => (
            <a key={h} href={h} className="pill border border-[var(--line)] px-3.5 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent-text)]">{l}</a>
          ))}
        </nav>

        <H2 id="api">JSON API</H2>
        <p className="mt-2 text-[var(--muted)]">
          Plain files served next to this site and rebuilt every 15 minutes. Addresses are lowercase. Paths are relative to the site root.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {endpoints.map(([path, what]) => (
                <tr key={path} className="border-t border-[var(--line)] align-top">
                  <td className="py-2.5 pr-4">
                    {path.includes("{") ? <span className="mono whitespace-nowrap">{path}</span> : <a className="mono whitespace-nowrap text-[var(--accent-text)] hover:underline" href={`${BASE}/${path}`}>{path}</a>}
                  </td>
                  <td className="py-2.5 text-[var(--muted)]">
                    {what}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-[var(--accent-text)]">Sample from the current export</summary>
                      <div className="mt-2 flex justify-end"><CopyButton text={samples[path] ?? ""} label="Copy JSON" /></div>
                      <pre className="mono mt-1 max-h-72 overflow-auto rounded-md bg-[var(--panel)] p-3 text-[11px] leading-relaxed text-[var(--text)]">{samples[path]}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 font-medium">Check one token</p>
        <Code>{`const base = "${BASE}/api"; // or the full site URL from another origin
const t = await fetch(\`\${base}/tokens/${sample}.json\`).then((r) => r.json());
if (!t.metrics) throw new Error("not analysed yet");
const { rawHolders, realHolders, clusterSupplyBps, creatorLinkedSupplyBps } = t.metrics;
console.log(\`\${t.symbol}: \${rawHolders} holders, \${realHolders} real owners\`);
console.log(\`wallet groups trading it: \${t.clusters.length}\`);`}</Code>
        <p className="mt-6 font-medium">Fields in <span className="mono">metrics</span></p>
        <dl className="mt-2 divide-y divide-[var(--line)] text-sm">
          {fields.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[14rem_1fr]">
              <dt className="mono">{k}</dt>
              <dd className="text-[var(--muted)]">{v}</dd>
            </div>
          ))}
        </dl>

        <H2 id="rules">How labels are decided</H2>
        <p className="mt-2 text-[var(--muted)]">
          The site turns the fields above into a label with these rules. Any of the first three gives <b className="text-[var(--text)]">Many linked wallets</b>, any other gives{" "}
          <b className="text-[var(--text)]">Some linked wallets</b>, none gives <b className="text-[var(--text)]">No linked wallets found</b>. A token with no holders and no trading
          is <b className="text-[var(--text)]">Not enough data</b>. Labels describe what was found, not risk. The cut-offs are our own choice and have not been tested against hand-labelled tokens, so set your own thresholds if you need to.
        </p>
        <ul className="mt-4 space-y-3">
          {RULES.map(([level, text]) => (
            <li key={text} className="flex items-start gap-3 text-sm">
              <Badge level={level} />
              <span className="pt-0.5">{text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-[var(--muted)]">
          &quot;The creator&apos;s wallet group&quot; comes from <span className="mono">clusters/{"{groupId}"}.json</span>: the group whose{" "}
          <span className="mono">members</span> include the token&apos;s <span className="mono">creator</span>; <span className="mono">createdTokens</span> lists what it launched.
          How groups are formed is in the <Link href="/methodology/#method" className="text-[var(--accent-text)] underline">detailed method</Link>.
        </p>

        <H2 id="contracts">Contracts (Monad testnet)</H2>
        <p className="mt-2 text-[var(--muted)]">
          Nuno reads nad.fun on Monad mainnet and writes each token&apos;s numbers to <b className="text-[var(--text)]">NunoFeed</b> on Monad testnet (chain 10143) when they change.{" "}
          <b className="text-[var(--text)]">OrganicGate</b> is a ready-made check on top of it.
        </p>
        {dep ? (
          <ul className="mt-4 space-y-1 text-sm">
            <li>NunoFeed <a className="mono break-all text-[var(--accent-text)] hover:underline" href={addrUrl(dep.NunoFeed, dep.chainId)} target="_blank" rel="noreferrer">{dep.NunoFeed}</a></li>
            <li>OrganicGate <a className="mono break-all text-[var(--accent-text)] hover:underline" href={addrUrl(dep.OrganicGate, dep.chainId)} target="_blank" rel="noreferrer">{dep.OrganicGate}</a></li>
          </ul>
        ) : null}
        <p className="mt-6 font-medium">Refuse clustered tokens in your contract</p>
        <Code>{`interface IOrganicGate {
    // Reverts with NoSnapshot, StaleSnapshot or TooClustered.
    function requireOrganic(address token, uint16 maxClusterBps, uint256 maxAge) external view;
    function isOrganic(address token, uint16 maxClusterBps, uint256 maxAge) external view returns (bool);
}

// At most 20% of supply in wallet groups, data at most 1 day old:
gate.requireOrganic(token, 2000, 1 days);`}</Code>
        <p className="mt-6 font-medium">Read it with viem</p>
        <Code>{`import { createPublicClient, http, parseAbi } from "viem";

const client = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const abi = parseAbi([
  "function latest(address token) view returns ((uint64 sourceBlock, uint64 publishedAt, uint32 rawHolders, uint32 realHolders, uint16 clusterSupplyBps, uint16 effectiveTop10Bps, uint16 creatorLinkedSupplyBps, uint16 organicVolumeBps, bytes32 evidenceRoot))",
]);
const s = await client.readContract({ address: "${dep?.NunoFeed ?? "0x…"}", abi, functionName: "latest", args: ["${sample}"] });
console.log(s.rawHolders, "holders,", s.realHolders, "real owners");`}</Code>
        <p className="mt-6 font-medium">Read the raw snapshot</p>
        <Code>{`struct Snapshot {
    uint64 sourceBlock;            // mainnet block the numbers are from
    uint64 publishedAt;            // testnet timestamp of the write
    uint32 rawHolders;
    uint32 realHolders;
    uint16 clusterSupplyBps;
    uint16 effectiveTop10Bps;
    uint16 creatorLinkedSupplyBps;
    uint16 organicVolumeBps;
    bytes32 evidenceRoot;          // matches metrics.evidenceRoot in the JSON
}
function latest(address token) external view returns (Snapshot memory);
function hasSnapshot(address token) external view returns (bool);`}</Code>

        <H2 id="limits">Limits</H2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[var(--muted)]">
          <li>Covers nad.fun tokens launched in about the last week; older tokens drop out of the window.</li>
          <li>Updated every 15 minutes; <a className="text-[var(--accent-text)] underline" href={`${BASE}/api/meta.json`}>meta.json</a> says how fresh the data is.</li>
          <li>The contracts are on testnet: the numbers are real mainnet data, but don&apos;t secure real funds with them.</li>
          <li>Groups are a careful best guess from public transactions, not a certainty. Every link carries its proof so you can check it.</li>
        </ul>
      </div>
    </Sheet>
  );
}
