# Progress

## 2026-10-08 (Wed) — session 1

### Gate A: PASSED
- **Real events in DB**: 1-day backfill (blocks 111,420,401..111,706,507) → 10 tokens, 52 curve trades, 61 ERC-20 transfers, 0 graduations, 0 DEX swaps.
- **Real funders for ≥10 buyer wallets**: 12 unique buyers; 11 EOAs resolved with first-funding tx + block, 1 contract (`0xd243…f160`) excluded. 15 wallets resolved incl. hops 2–3; 15 funding edges stored.
- Spot-verified on-chain: tx `0x472f4f46f2d19b9e2dd95b885992cb10a8f28235e31d973fd9859ee00130b35b` is a plain transfer `0xb245…66d3b3 → 0x0a0f…6f0c`, 14,995 MON, block 66,478,720.

### First real finding (needs validation before any public claim)
All 10 tokens launched in the window were created by wallets whose **first funding** came from the same address `0xb2454805656dd62b4aec8718a53f5543cc66d3b3`, each receiving exactly 14,995 MON within blocks 66,478,706–66,478,748 (~13 s). Hop 2: `0xb245…` was funded by `0xf89d…aa40` (10 MON); hop 3 by `0x348e…c0eb`. Not yet checked against Nansen labels.

### Measured environment facts
| Fact | Value |
|---|---|
| Block time | 0.302 s (100k blocks = 30,206 s) |
| `eth_getLogs` range: rpc.monad.xyz | 100 blocks (`-32614 eth_getLogs is limited to a 100 range`) |
| `eth_getLogs` range: rpc1.monad.xyz, rpc-mainnet.monadinfra.com | 100 blocks (`-32602 block range too large`) |
| `eth_getLogs` range: rpc3.monad.xyz | 1000 blocks (`-32062 Block range is too large` above) |
| `eth_getLogs` range: monad-mainnet.drpc.org (free) | 100 blocks |
| `trace_transaction`, `trace_filter` | Not served by any public RPC tested (`-32601 Method not found`; rpc3: `-32053 API key is not allowed`; drpc: paid only) |
| `debug_traceTransaction`, `debug_traceBlockByNumber` (callTracer) | Served by rpc.monad.xyz, rpc1.monad.xyz, rpc-mainnet.monadinfra.com |
| Archive state (`eth_getBalance` at old blocks) | rpc1.monad.xyz and monadinfra: full history. rpc.monad.xyz, rpc3: recent only |
| nad.fun activity (24h to block ~111.7M) | 9–10 `CurveCreate`, 19 `CurveBuy`, 32 `CurveSell`, 11 unique buyers. Only one curve contract emits these events. |
| Backfill speed (rpc3, 6 parallel) | ~286k blocks (1 day) in ~1 min |
| Funding resolution | ~5 s per wallet incl. hops (binary search ≈ 27 × 2 archive calls + 1 block fetch/trace) |

### Funding source A (implemented): archive state + debug traces
No public `trace_filter`, and native MON transfers emit no logs. For each wallet:
1. Binary-search the first block where `balance > 0 || nonce > 0` (monotone for EOAs).
2. Check the block's top-level txs for a value transfer to the wallet; else `debug_traceBlockByNumber` (callTracer) and take value frames to the wallet (catches disperse contracts).
3. Store funder (frame sender), origin (tx signer), tx hash, block, value. Repeat on origin up to 3 hops.

Limitation: this finds the **first** funding only, not every inbound transfer before the first buy.

### Later in session 1
- 7-day backfill (window start block 109,705,483) **in progress**, resumable. rpc3 turned out slow on older ranges (~20 s per 1000-block call), so logs now round-robin over rpc1, monadinfra and rpc.monad.xyz at 100-block ranges, concurrency 8. One run died on `RpcError: HTTP 429` at concurrency 12; added long backoff on 429 and resumed.
- Partial 7-day data so far: 24 tokens, 191 curve trades (29 unique buyers), 39 wallets with resolved funding, 0 graduations.
- `pnpm metrics:run` works end to end (clusters + metrics stored per token). Holder metrics need pass 2 (transfers) to finish before they mean anything.
- Contracts: NunoFeed + OrganicGate, 15 Foundry tests (incl. fuzz), zero lint warnings. Deploy script `pnpm deploy:contracts` (testnet 10143 only), **not deployed**: needs `DEPLOYER_PRIVATE_KEY` in `.env`.

### Global entity resolution (approved by user 2026-10-08)
Clustering now runs once across all tokens. Same-block signals are grouped per (token, block) and their weights accumulate across tokens per wallet pair. Per-token metrics use the global wallet→entity map. On the partial 7-day data (64 tokens): **one 10-wallet entity created all 64 tokens**. Each creator was first funded with exactly 14,995 MON by `0xb245…66d3b3` (tx evidence stored); those creators made 201 of 483 curve trades.

### Built later in session 1
- Publisher (`pnpm publish:snapshots`): change policy (holders changed, ≥25 bps move, evidence changed, or 6 h heartbeat); records tx hash, gas and price per snapshot in `snapshots`. Integration-tested on anvil (deploy + publish + read-back + OrganicGate).
- API (`pnpm api`): Hono, 5 endpoints + `/openapi.json`, 15 s cache, 120 req/min/IP. Smoke-tested on real data.
- `docs/METHODOLOGY.md` written.
- Web app (`apps/web`): screener, token page (metrics, cluster graph, evidence table with Monadscan links, snapshot), cluster page, methodology page.
- `pnpm --filter @nuno/metrics validation [seed]` generates the VALIDATION.md review sheet.

### What works
- `pnpm index:backfill` (2-pass parallel, resumable via `indexer:curve`/`indexer:tokens` cursors, window-widening safe), `pnpm index:tail`
- `pnpm funding:resolve [limit] [hops]`, DB-cached, in-flight deduped
- `packages/cluster`: weighted union-find, all 6 edge types, unit-tested (not yet wired to DB)
- `packages/metrics`: all SPEC §7.4 metrics + evidenceRoot, unit-tested; `pnpm metrics:run` / `pnpm cluster:run`
- `contracts`: `forge test` 15/15
- `pnpm test`: 60 tests passing; `pnpm typecheck` clean

### Broken / not started
- No `docker compose` plugin on this machine; DB started with `docker run --name nuno-db … -p 5433:5432 postgres:16` (`docker-compose.yml` matches it).
- `forge` installed at `~/.foundry/bin` but not on PATH.
- Nansen: no API key yet. Needed for infra exclusion (e.g. `0xabde…9d76` received 15.4M MON, likely an exchange).
- `docs/BOUNTIES.md`: bounty texts not pasted yet.
- Not done: testnet deploy + real snapshot txs (no keys), Nansen integration (no key), validation verdicts, hosting, video.
- DEX swap volume isn't attributed to traders yet (Swap `sender` is the router). No graduated tokens in the window so far, so no impact yet.
- `.env.example` still names `MONAD_MAINNET_LOGS_RPC_URL` (rpc3, range 1000). Permission rules block me from editing `.env*`. It should be `MONAD_MAINNET_LOGS_RPC_URLS=https://rpc1.monad.xyz,https://rpc-mainnet.monadinfra.com,https://rpc.monad.xyz` and `MONAD_MAINNET_LOGS_RANGE=100`.

### Risk to raise with user
nad.fun mainnet volume is low (~10 launches/day, ~20 curve buys/day). The 7-day window gives only ~70 tokens. Consider a longer backfill (P1) once P0 is green.

### 7-day results (source block 111,709,445; window from block 109,707,415)
| Count | Value |
|---|---|
| Tokens launched | 71 (0 graduated) |
| Curve trades | 537 |
| Transfers | 542 |
| Wallets clustered | 34 (26 funding edges) |
| Multi-wallet entities | **1**: 10 wallets, **created all 71 tokens**; links: same_direct_funder + common_funding_source |
| Typical token | 0–2 holders left (operator buys, then sells back to the curve); organic volume ≈ 17–30% |

The highest-volume token is `DUMP` (`0x63bce320…7777`): 11,474 MON raw, 59.7% organic.

### Bug found and fixed on real data
Two unrelated wallets were merged because they shared **two** ancestors on one funding chain, and `common_funding_source` was counted once per shared ancestor (0.8 + 0.8). It now counts once per pair. Regression test added; the false entity (`0x6f37…`) is gone.

### Validation
`docs/VALIDATION.md` sheet generated (seed 42): 20 flagged links (all from the one entity, since only one exists) and 10 unflagged buyers. **Verdicts not filled yet** (hand review).

### Attribution + infrastructure (approved by user)
- Curve trades now store the tx signer (`tx_from`); a trade with a contract `sender` is attributed to its signer. 94 of 537 trades re-attributed.
- EIP-7702 delegated wallets (code `0xef0100…`) were wrongly treated as contracts; fixed. 6 active traders affected, incl. `0xd243…` (50 trades).
- `pnpm infra:scan`: funding origins with ≥ 5,000 txs or ≥ 1M MON are exchange-like infrastructure (16 of 46 on 2026-10-08), with evidence in `packages/metrics/src/infrastructure.json`.
- Effect: same single operator entity. Volume-weighted organic volume dropped ~20% → ~1.2% because round-trip traders (notably sniper `0x022e…`) now count as wash under the SPEC's net-position rule. **Raised with the user** as a definitional question.

### Live worker
`pnpm worker` tails new blocks and chains signers → funding → metrics (≤ 1/min, only on new activity) → publish (when a key and feed are configured). Smoke test: caught up 17k blocks in 84 s and picked up a new launch, `HOPNAD` (`0x7a1a…7777`, block 111,714,423), created by operator wallet `0xdd1c…` and assigned to the same entity live (72 tokens, 1 entity).

### Next step
Deploy contracts to testnet and publish real snapshots (needs keys); Nansen labels; hand-review the validation sheet; run `pnpm index:tail` continuously for the live deploy; host API + web.

### Deployed addresses / tx hashes
None yet.
