# Nuno

**The real numbers behind every nad.fun launch.**

Nuno detects coordinated wallet clusters behind [nad.fun](https://nad.fun) tokens on Monad and publishes cluster-adjusted metrics (real holders, real concentration, organic volume) through a REST API and an on-chain feed contract that other apps and contracts can read.

> Status: under active development for Monad Metropolis (Track 04). See [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Problem and intended user

nad.fun is Monad's main token launchpad. Its raw holder counts and volume are easy to fake, and the tooling is public: bundler/volume bots spread funds across 100+ wallets, generate automated buy/sell volume, and advertise "stealth" modes that defeat bubble maps. Screeners, launchpad trending lists, trading agents and holders all read the raw numbers these bots inflate.

Nuno counts by **entity**, not wallet, and strips volume an entity trades with itself.

**Intended users are integrators**: screeners, trackers, launchpad UIs, trading agents and smart contracts that want honest token metrics. They call the REST API or read `NunoFeed` on-chain. The screener in `apps/web` is the reference integration. `OrganicGate.sol` is an example contract consumer that reverts when a token's cluster-held supply is too high or Nuno's data is stale.

## Baseline: what already exists

GMGN (closed, commercial) already reports bundler share, insider-pattern volume and dev holdings for Monad tokens. Nuno's difference is an open methodology, per-flag evidence anyone can check on an explorer, entity-level metrics, and an on-chain feed contracts can compose with.

## Architecture

```
Monad mainnet (read-only)
  nad.fun curve events ─┐
  Uniswap V3 swaps ─────┼─► packages/indexer ──► SQLite (local backfill) ──► Cloudflare D1
  ERC-20 Transfers ─────┘           │
  archive state + debug traces ─► packages/funding (first funder, ≤3 hops, tx evidence)
                                    │
             packages/cluster (global weighted union-find, 6 evidence-backed edge types)
                                    │
                packages/metrics (per-token metrics + evidenceRoot; full run locally,
                                  incremental on cron)
                  ┌─────────────────┼──────────────────────┐
         apps/worker: Hono API   packages/publisher      apps/web (Next.js on Workers)
         + Cron Triggers         NunoFeed.sol (testnet)  screener, evidence pages
                                    │
                          OrganicGate.sol (example consumer)
```

Everything runs on **Cloudflare** (Workers Paid + D1). The one-time heavy jobs (7-day backfill, funding resolution, first full clustering) run locally into a SQLite file, which is size-gated and imported into D1. After that the Worker's cron does the ongoing work in bounded batches:

- **every minute:** tail new blocks, resolve funding for new buyers, run an incremental entity + metrics update for the affected tokens, publish changed snapshots;
- **hourly:** record D1 size;
- **daily:** prune.

Storage is budgeted (target ≤ 1.5 GB, D1 cap 10 GB). Addresses are stored once in a dictionary and referenced by integer ids, and hashes are stored as bytes. **Measured: 1 day of nad.fun data ≈ 184 KB, so the 7-day window ≈ 1.3 MB.**

Every metric is defined in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md), also rendered at `/methodology` in the web app.

## Stack

TypeScript (pnpm workspaces), viem, Drizzle ORM (SQLite dialect: `node:sqlite` locally, D1 on Cloudflare), Vitest, Hono, Cloudflare Workers + Cron Triggers + D1 (wrangler), Next.js App Router + Tailwind via OpenNext for Cloudflare, Solidity + Foundry.

## Data split

- **Analysis reads Monad mainnet** (chain 143), read-only: nad.fun curve events, Uniswap V3 swaps, ERC-20 transfers, funding history.
- **NunoFeed and OrganicGate are deployed on Monad testnet** (chain 10143) and carry snapshots of mainnet data.

## Setup

Requirements: Node 22.5+ (built-in `node:sqlite`), pnpm 10, [Foundry](https://getfoundry.sh), a Cloudflare account on the Workers Paid plan.

**1. Local backfill** (writes `data/nuno.sqlite`):

```bash
pnpm i
cp .env.example .env
BACKFILL_DAYS=1 pnpm backfill:local && pnpm storage:report   # size projection gate first
pnpm backfill:local                # full window (BACKFILL_DAYS, default 7), resumable
pnpm infra:scan                    # mark exchange-like funding origins as infrastructure
pnpm metrics:full                  # global entities + per-token metrics
pnpm storage:report                # size, row counts, budget level
```

**2. Contracts** (Monad testnet):

```bash
cd contracts && forge test && cd ..
pnpm deploy:contracts              # writes deployments/monad-testnet.json
pnpm publish:snapshots             # first snapshots from the local DB
```

**3. Cloudflare:**

```bash
cd apps/worker
pnpm exec wrangler login
pnpm exec wrangler d1 create nuno  # put the database_id into apps/worker/wrangler.jsonc
pnpm exec wrangler secret put PUBLISHER_PRIVATE_KEY
cd ../.. && pnpm d1:import         # size gate -> migrations -> data import
pnpm worker:deploy                 # API + crons; note the printed URL
# set NUNO_API_URL / NUNO_PUBLIC_API_URL in apps/web/wrangler.jsonc to that URL, and NUNO_FEED_ADDRESS in apps/worker/wrangler.jsonc
pnpm --filter @nuno/web cf:deploy  # screener
```

Local preview without an account: `pnpm d1:import:local`, then `pnpm worker:dev` (API on :8787; trigger a cron with `curl "localhost:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*"`) and `pnpm --filter @nuno/web dev`.

**Checks:** `pnpm test && pnpm typecheck && pnpm lint`.

Public Monad RPCs differ in what they serve (log ranges, archive state, debug traces); the measured table is in [`docs/PROGRESS.md`](docs/PROGRESS.md). Funding resolution needs archive state and `debug_traceBlockByNumber` (`https://rpc1.monad.xyz` works).

## API

| Endpoint | Returns |
|---|---|
| `GET /tokens?sort=holder_gap\|cluster_supply\|creator_supply\|wash\|raw_volume\|newest` | Tokens with raw vs adjusted metrics |
| `GET /tokens/:address` | One token, its metrics and latest NunoFeed snapshot tx |
| `GET /tokens/:address/clusters` | Entities active in the token, every link with evidence |
| `GET /tokens/:address/evidence` | Canonical evidence JSON; its keccak256 is the on-chain `evidenceRoot` |
| `GET /clusters/:id` | One entity: members, tokens it created, evidence |
| `GET /wallets/:address` | A wallet's entity, funders, funded wallets, trades |

OpenAPI spec at `/openapi.json`. Responses are cached for 15 s and rate-limited to 120 requests/min per client IP (`CF-Connecting-IP`).

## Why Monad

_TODO: measured numbers only._

## Nansen usage

_TODO_

## Validation

_TODO: observed precision on the hand-reviewed sample in `docs/VALIDATION.md` only._

## Attribution

- [viem](https://viem.sh) (MIT): RPC encoding/decoding
- [Drizzle ORM](https://orm.drizzle.team) (Apache-2.0), [Hono](https://hono.dev) (MIT), [Wrangler](https://github.com/cloudflare/workers-sdk) (MIT/Apache-2.0), [OpenNext for Cloudflare](https://opennext.js.org/cloudflare) (MIT), [Next.js](https://nextjs.org) (MIT), [Tailwind CSS](https://tailwindcss.com) (MIT), [marked](https://marked.js.org) (MIT)
- [Foundry](https://getfoundry.sh) and [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), vendored in `contracts/lib/forge-std`
- [Vitest](https://vitest.dev) (MIT), [TypeScript](https://www.typescriptlang.org) (Apache-2.0), [tsx](https://github.com/privatenumber/tsx) (MIT)
- nad.fun event ABIs and contract addresses copied from nad.fun's published docs (`nad.fun/abi.md`, `nad.fun/skill.md`)

No pre-existing code is included; everything was written during the Metropolis build window.

## AI tools used

This project was built with **Claude Code** (Anthropic) as a coding assistant: scaffolding, implementation, tests and documentation drafts. All on-chain facts (addresses, event signatures, RPC limits) were verified against live calls.

## License

MIT — see [LICENSE](LICENSE).
