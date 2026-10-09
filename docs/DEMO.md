# Demo video script (≤ 3:00)

Rules: real operation only, Monad interactions visible, no fake data. Every number on screen comes from the live deployment at recording time. Items marked **[needs deploy]** require the testnet contracts and the Cloudflare deployment (see README → Setup).

| Time | Screen | Narration (approx.) |
|---|---|---|
| 0:00–0:15 | Screener home, sorted by **Creator-linked supply** | "nad.fun holder counts and volume are easy to fake: public bundler bots spread one operator over many wallets. Nuno counts entities, not wallets, and shows the evidence." |
| 0:15–0:45 | Click the top token → token page: raw → real holders, raw → organic volume, the entity card with the cluster graph | "This token's creator belongs to an entity of 10 wallets. Every launch in the last 7 days came from that same entity." (Say only what the live numbers show.) |
| 0:45–1:15 | Evidence table → click a `same_direct_funder` tx → **Monadscan opens on mainnet**: the same funder sending 14,995 MON to the creator wallet | "Every link is a Monad transaction you can check yourself. Here the operator's funder sends identical amounts to fresh wallets within seconds." |
| 1:15–1:35 | Cluster page: 10 wallets, tokens created, full evidence list | "Entities are resolved across all tokens, so the operator has one id everywhere." |
| 1:35–2:05 | **[needs deploy]** Token page → "On-chain snapshot (NunoFeed)" → click the publish tx → **Monadscan testnet**: `publish(token, snapshot)` with the metrics and `evidenceRoot` | "Nuno publishes these numbers on Monad so other contracts can use them. The evidence root is the hash of the evidence JSON served by the API." Show `GET /tokens/:t/evidence` and that `keccak256(canonical) == evidenceRoot` (one terminal line). |
| 2:05–2:35 | **[needs deploy]** `cast call` to `OrganicGate.isOrganic(token, 3000, 3600)` on testnet → `false` for an operator-heavy token; `requireOrganic` reverting with `TooClustered` | "Any contract can refuse tokens whose supply sits with one coordinated entity, or whose data is stale. This is the integration story: an API and an on-chain feed." |
| 2:35–2:50 | Terminal: Worker logs showing the per-minute cron tick (`indexed`, `funded`, `metrics`) and `GET /openapi.json` | "It runs continuously on Cloudflare: new blocks every minute, incremental clustering, snapshots only when something meaningful changes." |
| 2:50–3:00 | Methodology page (limitations section) | "Methodology, limitations and a hand-reviewed validation sample are in the repo. Open source, MIT." |

## Pre-recording checklist
- [ ] Contracts deployed; `deployments/monad-testnet.json` committed; at least one real snapshot tx.
- [ ] Worker deployed and the cron ran within the last few minutes (`storage_stats` and cursors fresh).
- [ ] Web deployed with `NUNO_API_URL` pointing at the Worker.
- [ ] Pick the token for the walk-through from the live screener at recording time, with real numbers.
- [ ] Measured publish cost/frequency for "Why Monad" taken from the `snapshots` table, not estimated.
- [ ] Organic-volume definition decided (the current rule reports ~1% organic; don't present it as a headline without that context).
