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

### What works
- `pnpm index:backfill` (2-pass parallel, resumable via `indexer:curve`/`indexer:tokens` cursors, window-widening safe), `pnpm index:tail`
- `pnpm funding:resolve [limit] [hops]`, DB-cached, in-flight deduped
- `packages/cluster`: weighted union-find, all 6 edge types, unit-tested (not yet wired to DB)
- `pnpm test`: 44 tests passing; `pnpm typecheck` clean

### Broken / not started
- No `docker compose` plugin on this machine; DB started with `docker run --name nuno-db … -p 5433:5432 postgres:16` (`docker-compose.yml` matches it).
- `forge` installed at `~/.foundry/bin` but not on PATH.
- Nansen: no API key yet. Needed for infra exclusion (e.g. `0xabde…9d76` received 15.4M MON, likely an exchange).
- `docs/BOUNTIES.md`: bounty texts not pasted yet.
- Not yet built: metrics, cluster DB runner, contracts, API, web.

### Risk to raise with user
nad.fun mainnet volume is low (~10 launches/day, ~20 curve buys/day). The 7-day window gives only ~70 tokens. Consider a longer backfill (P1) once P0 is green.

### Next step
Run the full 7-day backfill and resolve funding at scale; wire the cluster engine to the DB (`pnpm cluster:run`); metrics engine + tests.

### Deployed addresses / tx hashes
None yet.
