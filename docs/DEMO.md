# Demo video script (≤ 3:00)

Rules: real operation only, Monad interactions visible, no fake data. Every number on screen comes from the live deployment at recording time. Items marked **[needs deploy]** require the testnet contracts and the GitHub Pages deployment (see README → Setup).

| Time | Screen | Narration (approx.) |
|---|---|---|
| 0:00–0:15 | Home hero, then the screener | "Count people, not wallets. nad.fun holder counts and volume are easy to fake: public bundler bots spread one operator over many wallets. Nuno counts entities, not wallets, and shows the evidence." |
| 0:15–0:45 | Headline box on the screener, then click the top token → token page: raw → real holders, raw → organic volume, the entity card with the cluster graph | "Every nad.fun launch from Oct 2–9, 2026 came from 10 wallets seeded in one 17-second burst by a single private wallet." (Use exactly this wording: no "scam", no operator name.) |
| 0:45–1:15 | Evidence table → click a `same_direct_funder` tx → **Monadscan opens on mainnet**: the same funder sending 14,995 MON to the creator wallet | "Every link is a Monad transaction you can check yourself. Here one private wallet sends identical amounts to fresh wallets within seconds." |
| 1:15–1:35 | Cluster page: 10 wallets, tokens created, full evidence list | "Entities are resolved across all tokens, so the operator has one id everywhere." |
| 1:35–2:05 | **[needs deploy]** Token page → "On-chain snapshot (NunoFeed)" → click the publish tx → **Monadscan testnet**: `publish(token, snapshot)` with the metrics and `evidenceRoot` | "Nuno publishes these numbers on Monad so other contracts can use them. The evidence root is the hash of the evidence JSON in the static API." Show `api/tokens/<t>.json` → `evidenceCanonical` and that `keccak256(evidenceCanonical) == evidenceRoot` (one terminal line). |
| 2:05–2:35 | **[needs deploy]** `cast call` to `OrganicGate.isOrganic(token, 3000, 3600)` on testnet → `false` for an operator-heavy token; `requireOrganic` reverting with `TooClustered` | "Any contract can refuse tokens whose supply sits with one coordinated entity, or whose data is stale. This is the integration story: a static JSON API and an on-chain feed." |
| 2:35–2:50 | GitHub Actions: a recent **tick** run log (`indexed`, `funded`, `metrics`, `published`) | "It runs every 20 minutes on GitHub Actions and is served from GitHub Pages, for $0: new blocks, incremental clustering, snapshots only when something meaningful changes." |
| 2:50–3:00 | Methodology page (limitations section), then the home hero | "Methodology, limitations and a hand-reviewed validation sample are in the repo. Open source, MIT. Count people, not wallets." |

## Pre-recording checklist
- [ ] Contracts deployed; `deployments/monad-testnet.json` committed; at least one real snapshot tx.
- [ ] `tick` workflow ran within the last 20 minutes (`api/meta.json` → `generatedAt` fresh).
- [ ] Pages site live and the repo public.
- [ ] Pick the token for the walk-through from the live screener at recording time, with real numbers.
- [ ] Measured publish cost/frequency for "Why Monad" taken from the `snapshots` table, not estimated.
- [ ] Organic-volume definition decided (the current rule reports ~1% organic; don't present it as a headline without that context).
