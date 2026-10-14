import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { ONE_LINER, SITE_URL } from "@/lib/copy";
import { testnetDeployment } from "@/lib/deployments";
import { dateRange } from "@/lib/finding";
import { addrUrl } from "@/lib/format";
import { LEVEL_HINT, LEVEL_LABEL, RULES, type Level } from "@/lib/verdict";
import { Badge } from "../_views/badge";
import { CopyButton } from "../_views/copy";
import { ApiReference, SubNav, type Endpoint } from "./api-reference";

export const metadata: Metadata = { title: "API", description: ONE_LINER };

const SECTIONS: Array<[string, string]> = [
  ["api", "JSON API"],
  ["rules", "Label rules"],
  ["contracts", "Contracts"],
  ["limits", "Limits"],
];

function Code({ children, title }: { children: string; title?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        {title ? <p className="text-xs text-[var(--muted)]">{title}</p> : <span />}
        <CopyButton text={children} />
      </div>
      <pre className="mono mt-2 overflow-x-auto rounded-md bg-[var(--panel)] p-3 text-[11px] leading-relaxed">{children}</pre>
    </div>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-32 pt-12 text-2xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

/** Right-hand reference column: sticky on desktop, inline below the text on smaller screens. */
function Side({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="space-y-4 rounded-md border border-[var(--line)] bg-[var(--surface)] p-4 lg:sticky lg:top-32">{children}</div>
    </div>
  );
}

const SNAPSHOT_FIELDS: Array<[string, string, string]> = [
  ["sourceBlock", "uint64", "mainnet block the numbers are from"],
  ["publishedAt", "uint64", "testnet timestamp of the write"],
  ["rawHolders", "uint32", "wallets holding the token"],
  ["realHolders", "uint32", "real owners, entities counted once"],
  ["clusterSupplyBps", "uint16", "supply held by clusters (bps)"],
  ["effectiveTop10Bps", "uint16", "top 10 owners' share (bps)"],
  ["creatorLinkedSupplyBps", "uint16", "creator and linked wallets (bps)"],
  ["organicVolumeBps", "uint16", "organic share of volume (bps)"],
  ["evidenceRoot", "bytes32", "matches metrics.evidenceRoot in the JSON"],
];

export default function Developers() {
  const dep = testnetDeployment();
  const meta = api.meta("live");
  const tokens = api.tokens("live");
  const sample = tokens.find((t) => t.metrics && t.metrics.rawHolders > 0)?.address ?? tokens[0]?.address ?? "";
  const firstToken = tokens.find((t) => t.address === sample);
  const detail = sample ? api.token(sample, "live") : null;
  const cid = detail?.clusters?.[0]?.id ?? api.clusterIds("live")[0];
  const cl = cid ? api.cluster(cid, "live") : null;
  const wid = cl?.members[0];
  const wal = wid ? api.wallet(wid, "live") : null;
  const excerpt = (v: unknown) => JSON.stringify(v, null, 2);
  const url = (p: string) => `${SITE_URL}/${p}`;
  const endpoints: Endpoint[] = [
    { path: "api/meta.json", description: "Window (blocks and dates), data freshness, counts.", url: url("api/meta.json"), sample: excerpt(meta) },
    {
      path: "api/tokens.json",
      description: "Every token in the window with its numbers. Start here.",
      url: url("api/tokens.json"),
      sample: excerpt({ count: tokens.length, tokens: [firstToken, "…"] }),
    },
    {
      path: "api/tokens/{token}.json",
      description: "One token: numbers, the clusters that trade it with their links and proof, and its latest on-chain snapshot.",
      url: url(`api/tokens/${sample}.json`),
      sample: excerpt(detail ? { ...detail, clusters: detail.clusters.slice(0, 1).map((c) => ({ ...c, members: [...c.members.slice(0, 2), "…"], links: [c.links[0], "…"] })), evidenceCanonical: "…" } : null),
    },
    {
      path: "api/clusters/{id}.json",
      description: "One entity: members, tokens it launched, every link with its transactions.",
      url: url(`api/clusters/${cid}.json`),
      sample: excerpt(cl ? { ...cl, members: [...cl.members.slice(0, 3), "…"], createdTokens: [...cl.createdTokens.slice(0, 2), "…"], links: [cl.links[0], "…"] } : null),
    },
    {
      path: "api/wallets/{wallet}.json",
      description: "One clustered wallet: its entity, who funded it, whom it funded, its trades.",
      url: url(`api/wallets/${wid}.json`),
      sample: excerpt(wal),
    },
    {
      path: "api/nansen.json",
      description: "Nansen cross-checks: for each wallet checked, Nansen's First Funder next to Nuno's own, and whether they match.",
      url: url("api/nansen.json"),
      sample: excerpt((() => { const n = api.nansen("live"); return n ? { ...n, checks: [...n.checks.slice(0, 2), "…"] } : null; })()),
    },
    {
      path: "api/logos.json",
      description: "Per token: image, website, X, Telegram (from its nad.fun metadata), curve version and creation time.",
      url: url("api/logos.json"),
      sample: excerpt(Object.fromEntries([[sample, api.links(sample, "live")], ["…", "…"]])),
    },
  ];
  const viem = dep
    ? `import { createPublicClient, http, parseAbi } from "viem";

const client = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const abi = parseAbi([
  "function latest(address token) view returns ((uint64 sourceBlock, uint64 publishedAt, uint32 rawHolders, uint32 realHolders, uint16 clusterSupplyBps, uint16 effectiveTop10Bps, uint16 creatorLinkedSupplyBps, uint16 organicVolumeBps, bytes32 evidenceRoot))",
]);
const s = await client.readContract({
  address: "${dep.NunoFeed}", // NunoFeed
  abi,
  functionName: "latest",
  args: ["${sample}"],
});
console.log(s.rawHolders, "holders,", s.realHolders, "real owners");`
    : "";
  const solidity = dep
    ? `interface IOrganicGate {
    function requireOrganic(address token, uint16 maxClusterBps, uint256 maxAge) external view;
    function isOrganic(address token, uint16 maxClusterBps, uint256 maxAge) external view returns (bool);
}

// OrganicGate on Monad testnet: ${dep.OrganicGate}
IOrganicGate constant GATE = IOrganicGate(${dep.OrganicGate});

function buy(address token) external {
    // Reverts with NoSnapshot, StaleSnapshot or TooClustered:
    // at most 20% of supply in clusters, data at most 1 day old.
    GATE.requireOrganic(token, 2000, 1 days);
    // ...
}`
    : "";
  const range = meta?.window.startTime && meta.window.endTime ? dateRange(meta.window.startTime, meta.window.endTime) : null;
  const refresh = (meta as { refreshIntervalMinutes?: number } | null)?.refreshIntervalMinutes ?? 15;
  const limits: Array<[string, React.ReactNode]> = [
    ["Refresh", `about every ${refresh} minutes`],
    ["Window", `${meta?.window.days ?? 7} days${range ? ` (now ${range})` : ""}`],
    ["Reads", "nad.fun on Monad mainnet (chain 143)"],
    ["Publishes", `NunoFeed on Monad testnet (chain ${dep?.chainId ?? 10143})`],
    ["Key", "none required"],
    ["Rate", "static files on GitHub Pages; cache them and re-fetch after each refresh"],
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-8">
      <header className="pt-8">
        <h1 className="headline text-4xl sm:text-5xl">
          Use Nuno <span className="fade">in Your App</span>
        </h1>
        <p className="mt-4 max-w-[70ch] text-lg text-[var(--muted)]">
          Nuno counts people, not wallets. The numbers on this site are open: read them as static JSON from any app or bot, or straight from NunoFeed on
          Monad. No key, no sign-up, no cost.
        </p>
      </header>
      <div className="mt-6">
        <SubNav items={SECTIONS} />
      </div>

      <H2 id="api">JSON API</H2>
      <p className="mt-2 max-w-[70ch] text-[var(--muted)]">
        Plain files served next to this site and rebuilt every {refresh} minutes. Addresses are lowercase. Select an endpoint to see its URL, examples and a
        real sample.
      </p>
      <div className="mt-6">
        <ApiReference endpoints={endpoints} />
      </div>

      <H2 id="rules">How labels are decided</H2>
      <div className="mt-6 grid gap-12 lg:grid-cols-[55fr_45fr]">
        <div className="min-w-0">
          <p className="max-w-[70ch] text-[var(--muted)]">
            The site turns the metrics into a label with these rules. Any of the first three gives <b className="text-[var(--text)]">Many linked wallets</b>, any
            other gives <b className="text-[var(--text)]">Some linked wallets</b>, none gives <b className="text-[var(--text)]">No linked wallets found</b>. Labels
            describe what was found, not risk. The cut-offs are our own choice and have not been tested against hand-labelled tokens.
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
            &quot;The creator&apos;s wallet group&quot; is the cluster whose <span className="mono">members</span> include the token&apos;s{" "}
            <span className="mono">creator</span>. How clusters are formed: <Link href="/methodology/#method" className="text-[var(--accent-text)] underline">methodology</Link>.
          </p>
        </div>
        <Side>
          <p className="text-sm font-medium">Labels</p>
          <table className="w-full text-sm">
            <tbody>
              {(["red", "amber", "clear", "none"] as Level[]).map((l) => (
                <tr key={l} className="border-t border-[var(--line)] align-top first:border-0">
                  <td className="py-2 pr-3"><Badge level={l} /></td>
                  <td className="py-2 text-xs text-[var(--muted)]">{LEVEL_HINT[l]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-[var(--muted)]">Label names as shown: {(["red", "amber", "clear", "none"] as Level[]).map((l) => LEVEL_LABEL[l]).join(" · ")}.</p>
        </Side>
      </div>

      <H2 id="contracts">Contracts (Monad testnet)</H2>
      <div className="mt-6 grid gap-12 lg:grid-cols-[55fr_45fr]">
        <div className="min-w-0 space-y-4">
          {dep ? (
            ([
              ["NunoFeed", dep.NunoFeed, "Stores the latest cluster-adjusted numbers per nad.fun token; anyone can read them."],
              ["OrganicGate", dep.OrganicGate, "Example consumer: reverts unless a token's snapshot is fresh and its cluster-held supply is under your limit."],
            ] as Array<[string, string, string]>).map(([name, addr, what]) => (
              <section key={name} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
                <p className="font-medium">{name}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{what}</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="mono break-all">{addr}</span>
                  <CopyButton text={addr} />
                  <a href={addrUrl(addr, dep.chainId)} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] hover:underline">Explorer ↗</a>
                </p>
              </section>
            ))
          ) : (
            <p className="text-[var(--muted)]">Not deployed yet.</p>
          )}
          <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="mono text-sm">function latest(address token) external view returns (Snapshot memory)</p>
            <p className="mono mt-1 text-sm">function hasSnapshot(address token) external view returns (bool)</p>
            <p className="mt-4 text-xs text-[var(--muted)]">Snapshot fields</p>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {SNAPSHOT_FIELDS.map(([f, t, d]) => (
                  <tr key={f} className="border-t border-[var(--line)] align-top">
                    <td className="mono break-all py-1.5 pr-3 text-xs">{f}</td>
                    <td className="mono py-1.5 pr-3 text-xs text-[var(--muted)]">{t}</td>
                    <td className="py-1.5 text-xs text-[var(--muted)]">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            <Link href="/contracts/" className="text-[var(--accent-text)] underline">Latest publish transactions</Link>
          </p>
        </div>
        <Side>
          {dep ? (
            <>
              <Code title="Read latest(token) with viem">{viem}</Code>
              <Code title="Gate a contract with OrganicGate">{solidity}</Code>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">Examples appear once the contracts are deployed.</p>
          )}
        </Side>
      </div>

      <H2 id="limits">Limits</H2>
      <div className="mt-6 grid gap-12 lg:grid-cols-[55fr_45fr]">
        <ul className="min-w-0 list-disc space-y-1.5 pl-5 text-[var(--muted)]">
          <li>Covers nad.fun tokens launched in about the last week; older tokens drop out of the window.</li>
          <li>
            Rebuilt every {refresh} minutes; <a className="text-[var(--accent-text)] underline" href={url("api/meta.json")}>meta.json</a> says how fresh the data is.
          </li>
          <li>The contracts are on testnet: the numbers are real mainnet data, but don&apos;t secure real funds with them.</li>
          <li>Clusters are a careful best guess from public transactions, not a certainty. Every link carries its proof so you can check it.</li>
        </ul>
        <Side>
          <p className="text-sm font-medium">At a glance</p>
          <dl className="text-sm">
            {limits.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6rem_1fr] gap-3 border-t border-[var(--line)] py-2 first:border-0">
                <dt className="text-[var(--muted)]">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Side>
      </div>
    </div>
  );
}
