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

### Code review (`/code-review xhigh`), 15 findings, all fixed in `efd0e9a`
Most serious: the evidence root included `sourceBlock`, so every recompute would have republished every token on-chain. Others: null results cached (stuck worker), rate-limit errors treated as fatal, timeout not covering the response body, graduations lost in out-of-order backfill chunks, funding-queue starvation, API vs metrics attribution mismatch, spoofable rate limiter and unbounded maps, worker publish retry and hot-loop issues, cursor not re-read after errors, unbounded RPC cache, unvalidated env vars, worker ignoring `PUBLISH_CHAIN_ID`, infrastructure list not reloaded, fixed-bucket same-funder windows. 115 TS tests pass.

### Platform pivot (from the updated CLAUDE.md/SPEC.md)
The project docs now require **Cloudflare only** (Workers + Cron + D1) with a local SQLite backfill, an address dictionary and a storage budget. Current storage (Postgres) and runtime (Node API + worker) must be migrated; the engines carry over. Plan in `CLAUDE.md` → "Current state". The updated docs are in `CLAUDE.md.new`/`SPEC.md.new`, because the originals are root-owned and read-only to Claude.

## 2026-10-09 (Thu): Cloudflare migration done, verified locally

**Storage/runtime now match the project rules:** Drizzle SQLite schema (address dictionary, 32-byte hash blobs, TEXT amounts), local `node:sqlite` file for backfill and full runs, Cloudflare D1 in production. Postgres, the Node API and the Node worker are removed.

**Measured (real mainnet data, SQLite):**
| | |
|---|---|
| 1-day ingest | 184 KB → projection for 7 days 1.3 MB (gate: ≤ 1.5 GB) |
| Full 7-day window (blocks 109,809,429–111,811,472) | **446 KB** locally, **475 KB** in D1 (`meta.size_after`) |
| Rows | 72 tokens, 529 curve trades, 559 transfers, 322 addresses, 78 funding edges, 434 evidence rows |
| Result | Same as before the migration: **1 entity (10 wallets) created all 72 tokens**; 99 trades re-attributed to their signers |

**Verified locally on Cloudflare's runtime** (`wrangler dev` + local D1 imported with `pnpm d1:import:local`):
- API: all endpoints; `keccak256(/tokens/:t/evidence) == evidenceRoot` holds.
- Cron tick: tails 1,000 real blocks per run, resolves funding, incremental update (≈10–65 s wall). Storage check: 475 KB, level ok. Daily prune runs.
- Web (OpenNext build) on the Workers runtime: screener, token, cluster and methodology pages render with Monadscan evidence links.
- `wrangler deploy --dry-run`: Worker bundle 1.2 MB, no Node-only code.

**Bugs found by running it (all fixed, with tests):** D1's 100-bound-parameter limit (local SQLite now enforces it too); incremental runs clustering funding ancestors that never traded (two exchange-like hot wallets became "members"); every operator token recomputed on each tick; a tick that failed after funding lost its "newly funded" list; `/methodology` read a file at runtime.

**Decision needed (user):** `MIN_BUYERS=20` (SPEC default) prunes 63 of 72 tokens after 24 h. nad.fun tokens have 2–8 buyers, so token pages would lose their trade detail, although storage is ~0.03% of target. Options: keep 20; lower to e.g. 3; or skip rule 5 while storage < target.

### Later on 2026-10-09
- Production cron tick now has an end-to-end test (index → fund → merge into the entity → recompute → cursors; idle tick is a no-op).
- **DEX volume:** post-graduation Uniswap V3 swaps count toward raw/organic volume and wash detection, attributed to the tx signer (migration `0001` adds `dex_swaps.tx_from`). There were no graduations in the window, so current numbers are unchanged.
- `docs/DEMO.md`: video script + pre-recording checklist.
- 138 TS tests passing; typecheck and lint clean.
- Wrangler is not logged in on this machine. `wrangler deploy --temporary` (throwaway preview account) exists, but it publishes publicly, so it was not used without the user's go-ahead.

### Next step
Deploy as soon as Cloudflare credentials and testnet keys exist (`README` → Setup 2–3). Then the validation re-sample and the video. to testnet and publish real snapshots (needs keys); Nansen labels; hand-review the validation sheet; run `pnpm index:tail` continuously for the live deploy; host API + web.

### Deployed addresses / tx hashes
None yet (no keys / Cloudflare account linked).

## 2026-10-09 (Thu, evening): off Cloudflare (`e95c8a1`, not recorded at the time)
- Replaced the Worker/D1 runtime with `packages/pipeline`: a bounded, budget-aware `tick` (index → funding → incremental clustering/metrics → publisher → Nansen checks; daily prune + VACUUM), a free-plan Nansen client (permanent cache, credit reserve, hub/related-wallet checks) and a static API export. `apps/worker` moved to `packages/api` (read model only). Storage budget set to 40/70/90 MB (stricter than before).
- The commit left `packages/pipeline/src/{index,cli,export,settings}.ts` uncommitted, so `main` did not build from a fresh clone until 2026-10-11.

## 2026-10-10 (Fri)
No commits and no recorded work.

## 2026-10-11 (Sun)

### Repo
- Committed the missing pipeline files (`387b768`) and made `typecheck` generate the embedded methodology first (`d789c04`). A fresh clone passes `pnpm i --frozen-lockfile`, typecheck, test (133), lint, web:build; `forge test` 15/15.
- Created the private repo `github.com/andrew1234-arch/nuno` and pushed `main`. `gh` cannot reach api.github.com from this machine (`error connecting to api.github.com`); the repo was created through the REST API with git's stored credential.

### Hosting decision (final, user, 2026-10-11)
**GitHub Actions + GitHub Pages, $0.** Every Cloudflare/D1/wrangler reference is removed from code, README, `CLAUDE.md.new`, `SPEC.md.new` and `docs/DEMO.md` (`CLAUDE.md`/`SPEC.md` are root-owned: the user copies the `.new` files over). The DB lives gzipped on the `data` branch (one force-pushed commit). `.github/workflows/tick.yml` runs every 15 min: restore DB → tick → save DB → export static API → `next build` (static export) → deploy Pages. GitHub Pages on a free account needs the repo to be public.

### Data sanity check (user request, blocking)
| Check | Result |
|---|---|
| Chain | `eth_chainId` = `0x8f` (143, mainnet) on rpc1 and rpc.monad.xyz |
| Contracts | All 7 mainnet addresses in `packages/shared/src/chain.ts` match nad.fun's `skill.md`/`indexer.md` |
| Curve versions | nad.fun documents one mainnet curve (`0xA728…0aCE`), deployed at block 37,709,836 (2025-11-24, mainnet launch day) |
| Other `CurveCreate` emitters | None (topic-only `eth_getLogs`, last 30k blocks) |
| Curve event types | Create, Buy, Sell + one 4th topic (`0xfd4b…`, once per trade: CurveSync) |
| Our 73 tokens (Oct 2 06:23 → Oct 9 05:38 UTC) vs nad.fun API `/agent/token/created/<creator>` | **73 = 73**, 0 missing, 0 extra |

nad.fun activity collapsed: 2,528 launches by 1,814 creators on 2025-11-27; 26 by 23 on 2026-05-13; ~10/day by the same 10 wallets in October. These 10 wallets have each created 128–146 tokens since April–June (nad.fun API).

`0xb245…66d3b3` is a private EOA (no code, nonce 91, ~1,097 MON). It received **300,000 MON** from `0xf89d…aa40` in tx `0x87d3adbb61deeee7b6a6a069cf9807612dca17381eca8e74370f0bc6f10a54f3` (block 66,370,945, 2026-04-06 16:20:42Z), then sent 14,995 MON to each of the 10 creators between blocks 66,478,706 and 66,478,748 (2026-04-07 04:21:47Z → 04:22:04Z, **17 s by block timestamps**; an earlier "13 s" came from 42 blocks × 0.302 s and was wrong). `0xf89d…` is exchange-like infrastructure (73,852 txs, 337M MON), already in `infrastructure.json`. `0xb245…` is not infrastructure and was not added.

Approved public wording: "Every nad.fun launch from Oct 2–9, 2026 came from 10 wallets seeded in one 17-second burst by a single private wallet." No "scam", no operator name; evidence txs linked (`apps/web/lib/finding.ts`).

### Web
`apps/web` is now a Next.js static export: pages read `site/api` at build time, one static page per token and cluster, sorting in the browser, `/contrast/` for the historical contrast dataset, headline finding with all 11 evidence txs, Nansen labels shown next to funders in the evidence table.

### CORRECTION (2026-10-11, later): coverage is NOT complete, nad.fun has an undocumented V2 curve
- nad.fun's API reports `market_type: "V2_CURVE"`, `market_id: 0x9f3832732923252A21044F21eE6bd87F09514ae4`, `version: "V2"` for e.g. token `0x47Ab…7777` (created block 92,051,446 by `0x0a0f…6f0c` through router `0x8986c8fd44eb85294a725a7e61af35e76ba26f91`). V2 is not in `nad.fun/abi.md`, `skill.md` or `indexer.md`; the contract is unverified on Monadscan and absent from Sourcify.
- V2 activity is far larger than V1: first day of our window (blocks 109,821,684–110,107,684) had 111 V2 create events, 1,455 `Buy`, 902 `Sell`, 2,357 `Sync`. V1 had ~10 launches/day. **The indexer misses most nad.fun activity.**
- The earlier "73 = 73" check only compared the 10 group wallets' token lists, so it could not see V2 launches by other creators. The headline "Every nad.fun launch from Oct 2–9 came from 10 wallets…" is only true for the V1 curve and must not be published as is.
- V2 event signatures, verified by keccak hash match (openchain signature DB + local hashing): `0x89f5adc1` = `Buy(address,address,uint256,uint256)`, `0xa082022e` = `Sell(address,address,uint256,uint256)`, `0x27efe2fe` = `Sync(address,uint256,uint256,uint256,uint256)`. Create `0xac11ceed…` has no public signature: topics are (creator, token, pool) by position, verified against the API for one token; 480 data bytes undecoded. V1's 4th event `0xfd4bb47b` = `CurveSync(...)` (hash match).
- The May 1 → Oct 11 per-day table computed from V1 `CurveCreate` only shows V1 dark from May 19 to Aug 24; nad.fun's API lists 77 June / 184 July tokens for the 10 group wallets, all on V2. The table is V1-only and incomplete.
- Funding: up to 5 inbound edges per wallet shipped (`a42ded2`); the 300,000 MON deposit into `0xb245…` (block 66,370,945) is now stored. Re-cluster on current data: still 1 entity of 10 wallets.
- Local DB note: 63 of 73 tokens were already pruned (`MIN_BUYERS=20`, from an Oct 9 run); only 191 trades remain.

### V2 indexing (2026-10-11, evening)
- **`MIN_BUYERS` defaults to 0** (prune rule 5 off; user decision). nad.fun tokens have 2–8 buyers and the low-buyer tokens hold the operator evidence. `MIN_BUYERS` now accepts 0. `SPEC.md.new` updated; `.env.example` (Claude cannot edit) should say `MIN_BUYERS=0`.
- **V2 curve indexed** (`155819a`): `0x9f38…4ae4`, address and router `0x8986…6f91` in `packages/shared/src/chain.ts`. Live-log checks:
  - `Buy`/`Sell` topics are (token, sender), the reverse of V1. Data is (amountIn, amountOut).
  - The create event `0xac11ceed…` is decoded by layout. Topics are (creator, token, pool). Data is (address quote = WMON, string name, string symbol, string uri, 3 × uint256 not interpreted), 480 bytes. Creator = nad.fun API creator = tx signer for token `0x0293…7777` ("Uniswap Mascot"/"swappy").
  - Real-log fixtures in `packages/indexer/src/decode.test.ts`.
- **No V2 graduation event found.** Two days of V2 logs (blocks 111,970,000–112,540,000) contain only create (95), Buy (4,084), Sell (3,357) and Sync (7,441). V2 post-graduation DEX swaps are not counted yet (`docs/METHODOLOGY.md` §7).
- **Storage projection (gate, rule 8).** A 1-day V1+V2 ingest (blocks 112,256,706–112,542,905) gave 61 tokens, 4,373 curve trades, 5,185 transfers, 818 addresses and **1.9 MB** of events. Projected 7-day window ≈ 13 MB of events, ~15–20 MB with funding/metrics. That is under the 40 MB target, so no pruning is needed.
- Funding in the local backfill now runs in parallel (`FUNDING_CONCURRENCY`, default 6; `9d80c4d`). Sequential resolution measured ~17 s/wallet incl. the deposit search.
- Local DBs: `data/nuno.v1-only.sqlite` = old V1-only DB (63 tokens pruned). `data/nuno.day1.sqlite` = 1-day projection run. `data/nuno.sqlite` = 7-day V1+V2 backfill, seeded from the day-1 run (in progress).
- **Contracts deployed on Monad testnet (10143)**, block 70,192,539. Deployer/publisher `0x3Da64F02123A5F66f36Ca1591321e2fB5BD98028`.
  - NunoFeed `0xBeda259a77417E20839ebc2bDE4558Abcfd47042`, tx `0x54e120caa109b968c06dfc1ad486d65bf5c0eef98df98e5ddd66d4acaa43c01c`
  - OrganicGate `0xec3b8718154f5a060bc9D29A11b23583999BBbd8`, tx `0x94e1f7928d3551ab31674ca946f81e910d454b0c9675cab3b0c9ac2a61b155ce`
  - No snapshots published yet: waiting for the 7-day V1+V2 backfill.
- The first 7-day backfill run crashed on a transient null `eth_getTransactionByHash` from one round-robin node. `txSigner` now retries. Resumed.
- Second crash: `rpc3.monad.xyz` returns `null` for older txs (recent history only). The local `.env` still points log reads at rpc3 alone (`MONAD_MAINNET_LOGS_RPC_URL`, range 1000). The backfill now runs with `MONAD_MAINNET_LOGS_RPC_URLS=https://rpc1.monad.xyz,https://rpc-mainnet.monadinfra.com,https://rpc.monad.xyz` and `MONAD_MAINNET_LOGS_RANGE=100`, the same as Actions. `.env` should be changed to match.

### 7-day V1+V2 backfill: paused by the user (2026-10-11, ~21:50 local)
- Indexing complete for window blocks 110,547,485–112,552,209 (cursors `indexer:curve` = `indexer:tokens` = `backfill:target` = 112,552,209).
- **Rows:** 350 tokens, 23,324 curve trades, 35,374 transfers, 5,913 addresses, 2,050 distinct buyers. DB 10.9 MB, under the 40 MB target.
- **Funding:** 160 wallets / 201 edges resolved. About 1,850 buyers still pending.
- **Resume** (skips indexing, goes straight to funding, then reclusters and computes metrics):
  `MONAD_MAINNET_LOGS_RPC_URLS=https://rpc1.monad.xyz,https://rpc-mainnet.monadinfra.com,https://rpc.monad.xyz MONAD_MAINNET_LOGS_RANGE=100 BACKFILL_DAYS=7 MIN_BUYERS=0 FUNDING_CONCURRENCY=6 pnpm backfill:local`
  Estimated 1.5–2.5 h at ~17 s/wallet with 6 workers.
- **After it finishes:** `pnpm export:static`, check the site, draft the new headline for user approval (the Oct 2–9 V1-only wording in `apps/web/lib/finding.ts` is invalid), publish the first snapshots to NunoFeed (`NUNO_FEED_ADDRESS` must be in `.env`), then run `pnpm web:build` (not yet run after the redesign).
- **Web redesign** (`635ed6f`): cream/rust theme from the user's template, landing page built from exported data only. Dev server checked on desktop and at ~520 px; the static build is still unverified.
