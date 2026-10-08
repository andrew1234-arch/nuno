# Methodology

Nuno counts **entities**, not wallets. It groups wallets that are very likely controlled by the same operator into an entity (a "cluster"), then recomputes each nad.fun token's holder, concentration and volume numbers per entity. Every link between two wallets keeps the transactions that justify it, so anyone can check each flag on a Monad explorer.

This document is the definition of every number Nuno publishes. Code references are to this repository.

## 1. Data sources

| Data | Source | Notes |
|---|---|---|
| Token launches, curve buys/sells, graduations | `CurveCreate`, `CurveBuy`, `CurveSell`, `CurveGraduate` events from the nad.fun curve contract `0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE` on Monad mainnet | Event ABIs from `nad.fun/abi.md`; topic hashes checked against live logs. `sender` on buy/sell is the trading wallet. |
| Balances | ERC-20 `Transfer` events of every tracked token, from creation onward | Balances are rebuilt from the full transfer history. |
| Post-graduation trades | Uniswap V3 `Swap` events on the pool from `CurveGraduate` | Indexed, but not yet attributed to traders (see Limitations). |
| Funding (who sent a wallet its MON) | Monad archive state + `debug_traceBlockByNumber` (section 2) | No public Monad RPC serves `trace_filter`. |
| Infrastructure labels | Manual list (`packages/metrics/src/infrastructure.ts`); Nansen labels once integrated | Used only to stop exchanges/bridges/routers acting as links. |

Window: tokens **launched** in the last `BACKFILL_DAYS` days (default 7). Analysis reads mainnet only; snapshots are published to NunoFeed on Monad testnet.

## 2. Funding resolution

For each wallet that bought a tracked token:

1. **Find the first-funded block.** For an externally owned account, `touched(b) = balance(b) > 0 or nonce(b) > 0` can only flip from false to true. Once funded, a wallet can only spend by sending a transaction, which raises its nonce. Nuno binary-searches archive state for the first block where `touched` is true, searching strictly before the wallet's first buy. That takes about 27 steps over Monad's full history.
2. **Find the sender.** In that block, a top-level transaction with value to the wallet gives the sender directly. Otherwise Nuno traces the block with `callTracer` and takes every successful value-carrying frame (`CALL`, `CREATE`, `CREATE2`, `SELFDESTRUCT`) whose target is the wallet. Frames under a reverted frame are ignored.
3. **Record evidence.** Nuno stores the `funder` (the frame that sent value, possibly a disperse contract), the `origin` (the transaction signer, i.e. the entity that controls the funds), value, block, timestamp and tx hash.
4. **Repeat on the origin**, up to 3 hops back.

The **origin** is used for linking, so bundlers that fan out through a disperse contract are still linked to their operator.

## 3. Entity resolution (clustering)

Entity resolution runs **globally across every tracked token at once**. That way an operator who launches or trades many tokens is one entity everywhere, with the same id. Wallets are linked by weighted edges. Weights between the same pair of wallets add up across edge types **and across tokens**. A pair is merged (union-find) once its total weight reaches **1.0**.

| Edge | Weight | Rule |
|---|---|---|
| `same_direct_funder` | 1.0 | Both wallets' first funding came from the same non-infrastructure origin, within 24 h of each other |
| `common_funding_source` | 0.8 | The wallets share any non-infrastructure ancestor within 3 funding hops. Counted once per pair, however many ancestors they share (several shared ancestors on one chain are one signal) |
| `creator_funded` | 1.0 | A token's creator is among the wallet's funding ancestors (≤ 3 hops); links wallet and creator |
| `token_transfer` | 1.0 | One wallet sent a tracked token directly to the other (neither is a contract) |
| `same_block_early_buy` | 0.5 | Both bought the same token in the same block, within 200 blocks (~1 min) of its creation |
| `same_block_sell` | 0.5 | Both sold the same token in the same block |

Consequences of the weights:
- A single weak signal (one shared block, or a distant shared ancestor) never merges wallets on its own.
- Two weak signals do. Examples: co-selling in the same block on two different tokens (0.5 + 0.5), or a shared ancestor plus a same-block sell (0.8 + 0.5).

**Hard rules**
- Contracts are never entity members. Each address's code is checked with `eth_getCode`. nad.fun protocol contracts, curve pools and graduated pools are always excluded.
- Infrastructure addresses never act as linking funders or ancestors.
- Every accepted link keeps its evidence: edge type, tx hash, block, and the token where relevant.
- For very large groups (more than 64 wallets sharing one funder, block or source), links are chained in time order instead of all pairs. The merged result is identical; only per-pair weight accumulation across edge types is reduced.

An entity's id is its lexicographically smallest member address. A wallet with no accepted links is its own entity.

## 4. Metrics (per token)

All supply shares are in **basis points of total supply** (10,000 = 100%), rounded down. Total supply is mints minus burns from the token's transfer history. Curve, pool and nad.fun protocol contracts are never counted as holders.

| Metric | Definition |
|---|---|
| `rawHolders` | Addresses with a non-zero balance, excluding contracts |
| `realHolders` | Distinct entities among those holders |
| `effectiveTop10Bps` | Combined balance of the 10 largest **entities**, as a share of total supply |
| `clusterSupplyBps` | Balance held by wallets that belong to multi-wallet entities, as a share of total supply |
| `creatorLinkedSupplyBps` | Balance held by the creator's entity (the creator alone if unclustered), as a share of total supply |
| `rawVolume` | Sum of the MON side of every curve trade (buy: MON in; sell: MON out) |
| `organicVolume` | `rawVolume` minus wash-like volume (below) |
| `organicVolumeBps` | `organicVolume / rawVolume`; **0 when there is no volume** |

**Wash-like volume**, computed per entity across all its wallets:
- (a) If an entity both bought and sold, and its net token position change is under **5%** of its gross tokens traded, **all** its MON volume is wash-like.
- (b) Otherwise, round trips count: for each window of 3,600 blocks (~18 min), `2 × min(buy MON, sell MON)`.
- Entities that only bought or only sold are directional and never count as wash.

Because entities span wallets, one wallet buying while a sibling wallet sells is detected as an entity round trip.

## 5. Evidence root

`evidenceRoot = keccak256(utf8(canonicalJson))`, where `canonicalJson` is:

```json
{"token": "<addr>", "sourceBlock": <n>, "clusters": [
  {"id": "<addr>", "members": ["<sorted addrs>"],
   "evidence": ["<a>:<b>:<edgeType>:<txHash>:<block>", "... sorted, deduplicated"]}
]}
```

`clusters` lists the entities active in the token, sorted by id. The canonical JSON is stored and served, so anyone can recompute the root and compare it with the one on-chain.

## 6. On-chain feed

`NunoFeed.publish(token, Snapshot)` stores the metrics above plus `sourceBlock` (the mainnet block they were computed at) and `evidenceRoot`; `publishedAt` is stamped by the contract. Snapshots can only move forward in `sourceBlock`. The publisher sends a new snapshot when any of these hold:
- holder counts changed;
- a bps metric moved by at least 25;
- the evidence root changed;
- 6 hours have passed since the last snapshot (heartbeat).

`OrganicGate.requireOrganic(token, maxClusterBps, maxAge)` reverts when there is no snapshot, when the snapshot is older than `maxAge`, or when `clusterSupplyBps > maxClusterBps`.

## 7. Limitations and known false-positive cases

- **First funding only.** Only a wallet's *first* inbound MON is resolved, not every transfer before its first buy. A wallet first funded by a friend and later topped up by an operator is linked to the friend.
- **Native MON only.** Funding via WMON or other ERC-20s is not yet followed.
- **EIP-7702 accounts.** A delegated EOA can move funds without raising its nonce, which breaks the monotonicity assumption in section 2. Such wallets may resolve to a later block, or to a block with no inbound value; the latter is stored as "no inbound value frame".
- **Shared infrastructure funders.** Until Nansen labels are integrated, an exchange hot wallet funding two unrelated users within 24 h links them (`same_direct_funder`). This is the main expected source of false positives, and the hand-review in `docs/VALIDATION.md` checks for it.
- **Coincidental same-block trades.** Two independent traders can share a block, especially right after launch. That is why these edges weigh 0.5 and need a second signal.
- **Post-graduation volume.** Uniswap V3 swaps are indexed but not attributed to traders (the `Swap` sender is a router), so DEX volume is not yet in `rawVolume`.
- **Supply denominator.** Shares use total supply. On the bonding curve most supply sits in the curve contract, so shares of *circulating* supply are higher than the published numbers.
- **No ground truth.** No labelled dataset exists. Accuracy is reported only as the observed precision on the hand-reviewed sample in `docs/VALIDATION.md`.
