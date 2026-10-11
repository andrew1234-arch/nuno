# Nuno

**The real numbers behind every nad.fun launch.**

Nuno detects coordinated wallet clusters behind [nad.fun](https://nad.fun) tokens on Monad and publishes cluster-adjusted metrics (real holders, real concentration, organic volume) through a static JSON API and an on-chain feed contract that other apps and contracts can read.

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

**Hosting is $0: GitHub Actions + GitHub Pages.** There is no server and no hosted database.

- The heavy one-time job (the window backfill, funding resolution, first full clustering) runs locally into one SQLite file. The file is gzipped and kept on the `data` branch as a single, force-pushed commit, so the repo does not grow with every run.
- [`.github/workflows/tick.yml`](.github/workflows/tick.yml) runs every 15 minutes: restore the DB → one bounded tick (tail new blocks, resolve funding for new buyers, incremental entity + metrics update, publish changed snapshots to NunoFeed on testnet, Nansen hub-funder checks within the free-plan budget, daily prune) → save the DB → export the static API → build the site → deploy to GitHub Pages.
- Every step is bounded and resumable by cursor; a run never assumes it finishes everything.

Storage is budgeted (target 40 MB, alarm 70 MB, hard stop 90 MB). Addresses are stored once in a dictionary and referenced by integer ids, and hashes are stored as bytes. **Measured: the 7-day window is ~0.3 MB.**

Every metric is defined in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md), also rendered at `/methodology` on the site.

## Stack

TypeScript (pnpm workspaces), viem, Drizzle ORM (SQLite dialect, `node:sqlite`), Vitest, Next.js App Router (static export) + Tailwind, Solidity + Foundry, GitHub Actions + GitHub Pages.

## Data split

- **Analysis reads Monad mainnet** (chain 143), read-only: nad.fun curve events, Uniswap V3 swaps, ERC-20 transfers, funding history.
- **NunoFeed and OrganicGate are deployed on Monad testnet** (chain 10143) and carry snapshots of mainnet data.

### Deployed contracts (Monad testnet, chain 10143)

| Contract | Address | Deploy tx |
|---|---|---|
| NunoFeed | [`0xBeda259a77417E20839ebc2bDE4558Abcfd47042`](https://testnet.monadscan.com/address/0xBeda259a77417E20839ebc2bDE4558Abcfd47042) | [`0x54e120ca…c01c`](https://testnet.monadscan.com/tx/0x54e120caa109b968c06dfc1ad486d65bf5c0eef98df98e5ddd66d4acaa43c01c) |
| OrganicGate | [`0xec3b8718154f5a060bc9D29A11b23583999BBbd8`](https://testnet.monadscan.com/address/0xec3b8718154f5a060bc9D29A11b23583999BBbd8) | [`0x94e1f792…55ce`](https://testnet.monadscan.com/tx/0x94e1f7928d3551ab31674ca946f81e910d454b0c9675cab3b0c9ac2a61b155ce) |

Deployed at testnet block 70,192,539. Publisher: `0x3Da64F02123A5F66f36Ca1591321e2fB5BD98028`. Machine-readable copy: [`deployments/monad-testnet.json`](deployments/monad-testnet.json).

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

**4. Run it on GitHub ($0):**

1. Push the repo to GitHub (Pages on a free account needs a public repo).
2. `scripts/data-push.sh backfill` uploads the local DB to the `data` branch.
3. Settings → Pages → Source: **GitHub Actions**.
4. Settings → Secrets and variables → Actions: secrets `PUBLISHER_PRIVATE_KEY` and (optional) `NANSEN_API_KEY`; variable `NUNO_FEED_ADDRESS`. RPC URLs have working public defaults in `tick.yml` and can be overridden with variables of the same name.
5. Actions → **tick** → Run workflow. After that it runs every 15 minutes.

**Checks:** `pnpm test && pnpm typecheck && pnpm lint`.

Public Monad RPCs differ in what they serve (log ranges, archive state, debug traces); the measured table is in [`docs/PROGRESS.md`](docs/PROGRESS.md). Funding resolution needs archive state and `debug_traceBlockByNumber` (`https://rpc1.monad.xyz` works).

## Static API

Plain JSON files, regenerated every tick and served from GitHub Pages under `/api/`:

| File | Returns |
|---|---|
| `api/meta.json` | Window (blocks), source block, export time, row counts |
| `api/tokens.json` | Every token with raw vs adjusted metrics, sorted by holder inflation |
| `api/tokens/<address>.json` | One token: metrics, latest NunoFeed snapshot tx, entities with every link and its evidence, and `evidenceCanonical` (its keccak256 is the on-chain `evidenceRoot`) |
| `api/clusters/<id>.json` | One entity: members, tokens it created, evidence, Nansen labels where checked |
| `api/wallets/<address>.json` | A wallet in a multi-wallet entity: entity, funders, funded wallets, trades |

Addresses are lowercase. The same layout under `api/contrast/` holds the historical contrast dataset, if one is published.

## Why Monad

_TODO: measured numbers only._

## Nansen usage

_TODO_

## Validation

_TODO: observed precision on the hand-reviewed sample in `docs/VALIDATION.md` only._

## Attribution

- [viem](https://viem.sh) (MIT): RPC encoding/decoding
- [Drizzle ORM](https://orm.drizzle.team) (Apache-2.0), [Next.js](https://nextjs.org) (MIT), [Tailwind CSS](https://tailwindcss.com) (MIT), [marked](https://marked.js.org) (MIT)
- GitHub Actions: [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [upload-pages-artifact](https://github.com/actions/upload-pages-artifact), [deploy-pages](https://github.com/actions/deploy-pages) (MIT), [pnpm/action-setup](https://github.com/pnpm/action-setup) (MIT)
- [Foundry](https://getfoundry.sh) and [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), vendored in `contracts/lib/forge-std`
- [Vitest](https://vitest.dev) (MIT), [TypeScript](https://www.typescriptlang.org) (Apache-2.0), [tsx](https://github.com/privatenumber/tsx) (MIT)
- nad.fun event ABIs and contract addresses copied from nad.fun's published docs (`nad.fun/abi.md`, `nad.fun/skill.md`)

No pre-existing code is included; everything was written during the Metropolis build window.

## AI tools used

This project was built with **Claude Code** (Anthropic) as a coding assistant: scaffolding, implementation, tests and documentation drafts. All on-chain facts (addresses, event signatures, RPC limits) were verified against live calls.

## License

MIT — see [LICENSE](LICENSE).
