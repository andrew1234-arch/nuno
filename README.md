# Nuno

**The real numbers behind every nad.fun launch.**

Nuno detects coordinated wallet clusters behind [nad.fun](https://nad.fun) tokens on Monad and publishes cluster-adjusted metrics (real holders, real concentration, organic volume) through a REST API and an on-chain feed contract that other apps and contracts can read.

> Status: under active development for Monad Metropolis (Track 04). See [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Problem and intended user

_TODO_

## Baseline: what already exists

GMGN (closed, commercial) already reports bundler share, insider-pattern volume and dev holdings for Monad tokens. Nuno's difference is an open methodology, per-flag evidence anyone can check on an explorer, entity-level metrics, and an on-chain feed contracts can compose with.

## Architecture

_TODO_

## Data split

- **Analysis reads Monad mainnet** (chain 143), read-only: nad.fun curve events, Uniswap V3 swaps, ERC-20 transfers, funding history.
- **NunoFeed and OrganicGate are deployed on Monad testnet** (chain 10143) and carry snapshots of mainnet data.

## Setup

```bash
pnpm i
cp .env.example .env
docker compose up -d db        # Postgres on localhost:5433
pnpm db:push                   # create tables
pnpm index:backfill            # BACKFILL_DAYS (default 7) of nad.fun activity
pnpm funding:resolve           # first-funding resolution for every buyer, 3 hops
pnpm test
```

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
