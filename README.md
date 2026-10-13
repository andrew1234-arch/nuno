# Nuno

**Count people, not wallets.**

One operator can look like a hundred holders. Nuno groups linked wallets into real entities and publishes the corrected numbers, through an open API and on-chain on Monad, with public proof for every link.

A wallet cluster is a group of wallets run by one person, often used to make a new token look more popular than it is. Nuno detects these clusters behind [nad.fun](https://nad.fun) tokens on Monad and publishes cluster-adjusted metrics (real holders, real concentration, organic volume) through a static JSON API and an on-chain feed contract that other apps and contracts can read.

> Status: under active development for Monad Metropolis (Track 04). See [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Problem and intended user

nad.fun is Monad's main token launchpad. Its raw holder counts and volume are easy to fake, and the tooling is public: bundler/volume bots spread funds across 100+ wallets, generate automated buy/sell volume, and advertise "stealth" modes that defeat bubble maps. Screeners, launchpad trending lists, trading agents and holders all read the raw numbers these bots inflate.

Nuno counts by **entity**, not wallet, and strips volume an entity trades with itself.

**Intended users are integrators**: screeners, trackers, launchpad UIs, trading agents and smart contracts that want honest token metrics. They read the static JSON API or `NunoFeed` on-chain. The screener in `apps/web` is the reference integration. `OrganicGate.sol` is an example contract consumer that reverts when a token's cluster-held supply is too high or Nuno's data is stale.

## Baseline: what already exists

GMGN (closed, commercial) already reports bundler share, insider-pattern volume and dev holdings for Monad tokens. Nuno's difference is an open methodology, per-flag evidence anyone can check on an explorer, entity-level metrics, and an on-chain feed contracts can compose with.

## Architecture

```
Monad mainnet (read-only)
  nad.fun curve events ─┐
  Uniswap V3 swaps ─────┼─► packages/indexer ──► SQLite file (data/nuno.sqlite)
  ERC-20 Transfers ─────┘           │
  archive state + debug traces ─► packages/funding (inbound funders, ≤3 hops, tx evidence)
                                    │
             packages/cluster (global weighted union-find, 6 evidence-backed edge types)
                                    │
                packages/metrics (per-token metrics + evidenceRoot)
                  ┌─────────────────┼──────────────────────┐
     packages/pipeline           packages/publisher       apps/web (Next.js static export)
     tick + static API export    NunoFeed.sol (testnet)   screener, evidence pages
                                    │
                          OrganicGate.sol (example consumer)
```

**Live: [nuno-eight.vercel.app](https://nuno-eight.vercel.app).** Hosting is $0: the backend runs on GitHub Actions and the static site and JSON API are served by Vercel (Hobby). There is no server and no hosted database.

- The heavy one-time job (the window backfill, funding resolution, first full clustering) runs locally into one SQLite file. The file is gzipped and kept on the `data` branch as a single, force-pushed commit, so the repo does not grow with every run.
- [`.github/workflows/tick.yml`](.github/workflows/tick.yml) runs every 20 minutes: restore the DB → one bounded tick (tail new blocks, resolve funding for new buyers, incremental entity + metrics update, publish changed snapshots to NunoFeed on testnet, Nansen hub-funder checks within the free-plan budget, daily prune) → save the DB → export the static API → build the site → deploy to Vercel (one archive upload, so the free plan's file and deployment limits hold).
- Every step is bounded and resumable by cursor; a run never assumes it finishes everything.

Storage is budgeted (target 40 MB, alarm 70 MB, hard stop 90 MB). Addresses are stored once in a dictionary and referenced by integer ids, and hashes are stored as bytes. **Measured: the 7-day window is ~0.3 MB.**

Every metric is defined in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md), also rendered at `/methodology` on the site.

## Stack

TypeScript (pnpm workspaces), viem, Drizzle ORM (SQLite dialect, `node:sqlite`), Vitest, Next.js App Router (static export) + Tailwind, Solidity + Foundry, GitHub Actions + Vercel.

## Data split

- **Analysis reads Monad mainnet** (chain 143), read-only: events from both nad.fun bonding curves (the documented curve `0xA728…0aCE` and the undocumented V2 curve `0x9f38…4ae4`, which carries most activity), Uniswap V3 swaps, ERC-20 transfers, funding history.
- **NunoFeed and OrganicGate are deployed on Monad testnet** (chain 10143) and carry snapshots of mainnet data.

### Deployed contracts (Monad testnet, chain 10143)

| Contract | Address | Deploy tx |
|---|---|---|
| NunoFeed | [`0xBeda259a77417E20839ebc2bDE4558Abcfd47042`](https://testnet.monadscan.com/address/0xBeda259a77417E20839ebc2bDE4558Abcfd47042) | [`0x54e120ca…c01c`](https://testnet.monadscan.com/tx/0x54e120caa109b968c06dfc1ad486d65bf5c0eef98df98e5ddd66d4acaa43c01c) |
| OrganicGate | [`0xec3b8718154f5a060bc9D29A11b23583999BBbd8`](https://testnet.monadscan.com/address/0xec3b8718154f5a060bc9D29A11b23583999BBbd8) | [`0x94e1f792…55ce`](https://testnet.monadscan.com/tx/0x94e1f7928d3551ab31674ca946f81e910d454b0c9675cab3b0c9ac2a61b155ce) |

Deployed at testnet block 70,192,539. Publisher: `0x3Da64F02123A5F66f36Ca1591321e2fB5BD98028`. Machine-readable copy: [`deployments/monad-testnet.json`](deployments/monad-testnet.json).

**Real snapshots on NunoFeed.** 40 snapshots of mainnet data were published by the pipeline on 2026-10-12/13, at about 85,300 gas for a token's first snapshot and 50,800 for an update. Examples:

| Token (mainnet) | Snapshot tx (testnet) | Gas |
|---|---|---|
| `0x0ed4…7777` | [`0xc785ed0a…dae5`](https://testnet.monadscan.com/tx/0xc785ed0a7067e2f0016024ff4182e415d7bb5ee7311327d4a27dfb0f48e8dae5) | 85,328 |
| `0x0d21…7777` (JELLY) | [`0x0ae7a856…dbba`](https://testnet.monadscan.com/tx/0x0ae7a8569592b3b2b829ae3013a7e4cfed66e63822d5a5758662399f80c6dbba) | 85,340 |
| `0x6490…7777` | [`0x82f337ea…72cb`](https://testnet.monadscan.com/tx/0x82f337eaefa9e32b3ac3774a2928793e5314f1c6717f17eae27f79c28ab472cb) | 85,268 |
| `0x344a…7777` | [`0xaf18eb59…5732`](https://testnet.monadscan.com/tx/0xaf18eb5965aa4c49b66dc8fbf993b3c30ca4eee7e790ed03322b5a0799c15732) | 50,801 |

Every token page links its latest snapshot tx.

## Setup

Requirements: Node 22.5+ (built-in `node:sqlite`), pnpm 10, [Foundry](https://getfoundry.sh). No accounts are needed to run it locally.

**1. Local backfill** (writes `data/nuno.sqlite`):

```bash
pnpm i
cp .env.example .env
BACKFILL_DAYS=1 pnpm backfill:local && pnpm storage:report   # size projection gate first
pnpm backfill:local                # full window (BACKFILL_DAYS, default 7), resumable
pnpm infra:scan                    # mark exchange-like funding origins as infrastructure
pnpm recluster                     # global entities + per-token metrics
pnpm storage:report                # size, row counts, budget level
```

**2. Contracts** (Monad testnet):

```bash
cd contracts && forge test && cd ..
pnpm deploy:contracts              # writes deployments/monad-testnet.json
pnpm publish:snapshots             # first snapshots from the local DB
```

**3. Site, locally:**

```bash
pnpm export:static                 # static API -> site/api
pnpm web:build                     # static site -> apps/web/out
cp -r site/api apps/web/out/api && npx serve apps/web/out
```

**4. Run it on GitHub Actions + Vercel ($0):**

1. Push the repo to GitHub.
2. `scripts/data-push.sh backfill` uploads the local DB to the `data` branch.
3. `npx vercel@63.1.2 login` (in a normal terminal), then `SITE_URL=<your Vercel URL> scripts/vercel-deploy.sh`: creates the Vercel project `nuno`, deploys, and prints `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
4. Settings → Secrets and variables → Actions: secrets `PUBLISHER_PRIVATE_KEY`, (optional) `NANSEN_API_KEY`, `VERCEL_TOKEN` (vercel.com/account/tokens), `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; variables `NUNO_FEED_ADDRESS` and `SITE_URL`. RPC URLs have working public defaults in `tick.yml` and can be overridden with variables of the same name.
5. Actions → **tick** → Run workflow. After that it runs every 20 minutes; without `VERCEL_TOKEN` the run skips the deploy step.

**Checks:** `pnpm test && pnpm typecheck && pnpm lint`.

Public Monad RPCs differ in what they serve (log ranges, archive state, debug traces); the measured table is in [`docs/PROGRESS.md`](docs/PROGRESS.md). Funding resolution needs archive state and `debug_traceBlockByNumber` (`https://rpc1.monad.xyz` works).

## Static API

Plain JSON files, regenerated every tick and served from Vercel under `/api/` (CORS open):

| File | Returns |
|---|---|
| `api/meta.json` | Window (blocks), source block, export time, row counts |
| `api/tokens.json` | Every token with raw vs adjusted metrics, sorted by holder inflation |
| `api/tokens/<address>.json` | One token: metrics, latest NunoFeed snapshot tx, entities with every link and its evidence, and `evidenceCanonical` (its keccak256 is the on-chain `evidenceRoot`) |
| `api/clusters/<id>.json` | One entity: members, tokens it created, evidence, Nansen labels where checked |
| `api/wallets/<address>.json` | A wallet in a multi-wallet entity: entity, funders, funded wallets, trades |

Addresses are lowercase. The same layout under `api/contrast/` holds the historical contrast dataset, if one is published.

## Why Monad

Measured on Monad mainnet (details in [`docs/PROGRESS.md`](docs/PROGRESS.md)):

| Measurement | Value |
|---|---|
| Block time | 0.302 s (100,000 blocks in 30,206 s) |
| One 7-day window | ~2,000,000 blocks |
| nad.fun activity, one day of October 2026 (both curves) | 61 launches, 4,373 curve trades, 5,185 token transfers |
| One 7-day window, both curves | 350 launches, 23,324 curve trades, 35,374 token transfers, 2,050 distinct buyers |
| Storage for that window | ~11 MB of SQLite before funding |

At sub-second blocks, a bundler's coordinated buys land in the same block or a few blocks apart, so same-block co-trading is a strong signal. Funding chains are also short in time: fresh wallets are typically funded a few blocks before they trade. Nuno's funding search exploits that by searching backwards from the spend block before falling back to a full binary search.

Monad's public RPCs serve archive state and `debug_traceBlockByNumber`, but no `trace_filter`, and native MON transfers emit no logs. So Nuno finds each wallet's funding from archive balances and nonces plus block traces (see [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) §2), and spreads those calls over the full-history endpoints `rpc1`, `rpc2` and `rpc-mainnet.monadinfra.com`.

## Nansen usage

Nuno uses Nansen to stop exchanges and other shared infrastructure from acting as links between unrelated wallets. On the free plan it calls `POST /api/v1/profiler/address/related-wallets` (1 credit, `chain: "monad"`) for hub funders, meaning funding origins shared by several buyers. It reads Nansen's `address_label` for the funder from the returned rows. Every response is cached permanently, and the tick keeps a credit reserve. Labels appear next to funders in the evidence tables. Implementation: [`packages/pipeline/src/nansen.ts`](packages/pipeline/src/nansen.ts).

**Live check (2026-10-11).** `pnpm --filter @nuno/pipeline nansen 0xb2454805656dd62b4aec8718a53f5543cc66d3b3` used 1 credit and returned:
- **First funder:** `0xf89d7b9c864f589bbf53a82105107622b35eaa40`, labelled "High Activity".
- **Tx:** [`0x8efaee1f…7695`](https://monadscan.com/tx/0x8efaee1f74b4a1e87a7b0c2addb37cc9e4da89536a9d5fae82407894da8e7695).

That is the same first-funding edge (same tx, block 61,808,158, 10 MON) that Nuno's own archive-state resolver found independently. Nansen thus confirms Nuno's funding method on this wallet. "High Activity" is a behavioural label, not an exchange label, so it is shown but does not mark the address as infrastructure. `0xf89d…` is already treated as infrastructure by the on-chain heuristic (73,852 txs, 337M MON).

## Validation

_TODO: observed precision on the hand-reviewed sample in `docs/VALIDATION.md` only._

## Attribution

- [viem](https://viem.sh) (MIT): RPC encoding/decoding
- [Drizzle ORM](https://orm.drizzle.team) (Apache-2.0), [Next.js](https://nextjs.org) (MIT), [Tailwind CSS](https://tailwindcss.com) (MIT), [marked](https://marked.js.org) (MIT)
- GitHub Actions: [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [upload-pages-artifact](https://github.com/actions/upload-pages-artifact), [deploy-pages](https://github.com/actions/deploy-pages) (MIT), [pnpm/action-setup](https://github.com/pnpm/action-setup) (MIT)
- [Foundry](https://getfoundry.sh) and [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), vendored in `contracts/lib/forge-std`
- [Vitest](https://vitest.dev) (MIT), [TypeScript](https://www.typescriptlang.org) (Apache-2.0), [tsx](https://github.com/privatenumber/tsx) (MIT)
- nad.fun event ABIs and contract addresses copied from nad.fun's published docs (`nad.fun/abi.md`, `nad.fun/skill.md`). The V2 curve is undocumented: its address comes from nad.fun's own API (`market_type: "V2_CURVE"`), and its event layout was derived from live logs and keccak signature matches (see `packages/shared/src/abis.ts`)
- [Inter Tight](https://fonts.google.com/specimen/Inter+Tight) (SIL Open Font License), loaded with `next/font/google`

No pre-existing code is included; everything was written during the Metropolis build window.

## AI tools used

This project was built with **Claude Code** (Anthropic) as a coding assistant: scaffolding, implementation, tests and documentation drafts. All on-chain facts (addresses, event signatures, RPC limits) were verified against live calls.

## License

MIT — see [LICENSE](LICENSE).
