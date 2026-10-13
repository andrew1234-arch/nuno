# Nuno static API

Plain JSON files served with the site (Vercel), rebuilt by the scheduled pipeline about every 20 minutes. No key needed; files are static and cacheable.. Addresses are lowercase. Paths are relative to the site root.

| Path | Contents |
|---|---|
| `api/meta.json` | Window (blocks and dates), data freshness (`sourceBlock`, `sourceTime`, `behindBlocks`, `generatedAt`), counts. |
| `api/tokens.json` | Every token in the window with its `metrics` (start here). |
| `api/tokens/{token}.json` | One token: metrics, the clusters that trade it with every link and its evidence, the latest NunoFeed snapshot. |
| `api/clusters/{id}.json` | One entity: members, tokens it launched, every link with its transactions. |
| `api/wallets/{wallet}.json` | One clustered wallet: its entity, who funded it, whom it funded, its trades. |
| `api/logos.json` | Per token: image, website, X, Telegram (from the token's own nad.fun metadata), curve version (V1/V2) and creation time. |

## Metrics fields

- `rawHolders` → `realHolders`: wallets holding the token → real owners, each entity counted once.
- `clusterSupplyBps`: share of supply held by clusters, in basis points (100 = 1%).
- `creatorLinkedSupplyBps`: share held by the creator and every wallet linked to them.
- `effectiveTop10Bps`: share held by the 10 biggest owners, entities counted once.
- `rawVolume` → `organicVolume`: all trading → trading by owners who kept their tokens, in wei (MON, 18 decimals); `organicVolumeBps` is the ratio.
- `evidenceRoot`: keccak256 of the canonical evidence behind the numbers; the same value is stored on-chain.

## On-chain

`NunoFeed.latest(address token)` on Monad testnet (chain 10143) returns the same numbers; `OrganicGate.requireOrganic(token, maxClusterBps, maxAge)` is an example consumer. Addresses are in `deployments/monad-testnet.json`. Full definitions: `docs/METHODOLOGY.md`.
