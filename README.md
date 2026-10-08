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
  Uniswap V3 swaps ─────┼─► packages/indexer ─► Postgres
  ERC-20 Transfers ─────┘          │
  archive state + debug traces ─► packages/funding (first funder, ≤3 hops, with tx evidence)
                                   │
              packages/cluster (global weighted union-find, 6 evidence-backed edge types)
                                   │
                    packages/metrics (per-token metrics + evidenceRoot)
                  ┌────────────────┼──────────────────┐
             apps/api        packages/publisher      apps/web
           (REST+OpenAPI)   NunoFeed.sol (testnet)  (screener, evidence pages)
                                   │
                         OrganicGate.sol (example consumer)
```

Every metric is defined in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md), which is also rendered at `/methodology` in the web app.

## Stack

TypeScript (pnpm workspaces), viem, Postgres + Drizzle, Vitest, Hono (API), Next.js App Router + Tailwind (web), Solidity + Foundry (contracts).

## Data split

- **Analysis reads Monad mainnet** (chain 143), read-only: nad.fun curve events, Uniswap V3 swaps, ERC-20 transfers, funding history.
- **NunoFeed and OrganicGate are deployed on Monad testnet** (chain 10143) and carry snapshots of mainnet data.

## Setup

Requirements: Node 22+, pnpm 10, Docker, [Foundry](https://getfoundry.sh).

```bash
pnpm i
cp .env.example .env               # fill PUBLISHER_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY for testnet
docker compose up -d db            # Postgres on localhost:5433
pnpm db:push                       # create tables

pnpm index:backfill                # BACKFILL_DAYS (default 7) of nad.fun launches, resumable
pnpm funding:resolve               # first funder of every buyer, up to 3 hops, with tx evidence
pnpm metrics:run                   # global entity resolution + per-token metrics

pnpm deploy:contracts              # NunoFeed + OrganicGate on Monad testnet -> deployments/monad-testnet.json
pnpm publish:snapshots             # write changed snapshots to NunoFeed

pnpm infra:scan                    # mark exchange-like funding origins as infrastructure (re-run occasionally)

pnpm worker                        # live: tail blocks -> signers -> funding -> metrics (debounced) -> publish
pnpm api                           # REST API on :8787 (OpenAPI at /openapi.json)
pnpm web                           # screener on :3000 (NUNO_API_URL defaults to http://localhost:8787)

pnpm test && pnpm typecheck && pnpm lint
cd contracts && forge test
```

Public Monad RPCs differ in what they serve (log ranges, archive state, debug traces); the measured table is in [`docs/PROGRESS.md`](docs/PROGRESS.md). Funding resolution needs an endpoint with archive state and `debug_traceBlockByNumber` (`https://rpc1.monad.xyz` works).

## API

| Endpoint | Returns |
|---|---|
| `GET /tokens?sort=holder_gap\|cluster_supply\|creator_supply\|wash\|raw_volume\|newest` | Tokens with raw vs adjusted metrics |
| `GET /tokens/:address` | One token, its metrics and latest NunoFeed snapshot tx |
| `GET /tokens/:address/clusters` | Entities active in the token, every link with evidence |
| `GET /clusters/:id` | One entity: members, tokens it created, evidence |
| `GET /wallets/:address` | A wallet's entity, funders, funded wallets, trades |

Rate-limited (120 req/min/IP) and cached (15 s).

## Why Monad

_TODO: measured numbers only._

## Nansen usage

_TODO_

## Validation

_TODO: observed precision on the hand-reviewed sample in `docs/VALIDATION.md` only._

## Attribution

- [viem](https://viem.sh) (MIT): RPC encoding/decoding
- [Drizzle ORM](https://orm.drizzle.team) (Apache-2.0), [postgres.js](https://github.com/porsager/postgres) (Unlicense)
- [Foundry](https://getfoundry.sh) and [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0), vendored in `contracts/lib/forge-std`
- [Vitest](https://vitest.dev) (MIT), [TypeScript](https://www.typescriptlang.org) (Apache-2.0), [tsx](https://github.com/privatenumber/tsx) (MIT)
- nad.fun event ABIs and contract addresses copied from nad.fun's published docs (`nad.fun/abi.md`, `nad.fun/skill.md`)

No pre-existing code is included; everything was written during the Metropolis build window.

## AI tools used

This project was built with **Claude Code** (Anthropic) as a coding assistant: scaffolding, implementation, tests and documentation drafts. All on-chain facts (addresses, event signatures, RPC limits) were verified against live calls.

## License

MIT — see [LICENSE](LICENSE).
