// Token logos, links, curve version and creation time for the site. Logos and links come from each token's own metadata: tokenURI() on the token contract
// (nad.fun tokens return a storage.nadapp.net JSON with image_uri, website, twitter, telegram, is_nsfw).
// Writes site/api/logos.json. Already-known tokens are reused from the existing file or from the live
// site (LOGOS_CACHE_URL), so a scheduled build only fetches new tokens. Never fails the build.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(process.cwd(), process.env.NUNO_DATA_DIR ?? "../../site/api");
const OUT = resolve(DIR, "logos.json");
const RPC = process.env.MONAD_MAINNET_RPC_URL || "https://rpc1.monad.xyz";
const TOKEN_URI = "0x3c130d90"; // tokenURI()
const TIMEOUT = 8000;
const CONCURRENCY = 4;
const MAX_NEW = Number(process.env.LOGOS_MAX_NEW || 500);
// nad.fun bonding curves (packages/shared/src/chain.ts): the create event's emitter tells V1 from V2.
const CURVE_V1 = "0xa7283d07812a02afb7c09b60f8896bcea3f90ace";
const CURVE_V2 = "0x9f3832732923252a21044f21ee6bd87f09514ae4";

async function get(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Decodes an ABI-encoded single string return value. */
function decodeString(hex) {
  const b = Buffer.from(hex.slice(2), "hex");
  if (b.length < 64) return "";
  const len = Number(b.readBigUInt64BE(56));
  return b.subarray(64, 64 + len).toString("utf8");
}

const https = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
const handle = (u, host) => (typeof u === "string" && u.trim() ? (https(u) ?? `https://${host}/${u.replace(/^@/, "")}`) : null);

async function rpc(method, params, attempt = 0) {
  try {
    const res = await get(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.error) throw new Error(res.error.message);
    return res.result;
  } catch (e) {
    // Public RPCs rate-limit bursts: back off and retry a few times.
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return rpc(method, params, attempt + 1);
  }
}

/** Curve version from the create tx's logs, and the creation time from its block. */
async function origin(createTx) {
  const r = await rpc("eth_getTransactionReceipt", [createTx]);
  const emitters = new Set(r.logs.map((l) => l.address.toLowerCase()));
  const curve = emitters.has(CURVE_V2) ? "V2" : emitters.has(CURVE_V1) ? "V1" : null;
  const b = await rpc("eth_getBlockByNumber", [r.blockNumber, false]);
  return { curve, createdAt: new Date(Number(BigInt(b.timestamp)) * 1000).toISOString() };
}

async function lookup(address) {
  const result = await rpc("eth_call", [{ to: address, data: TOKEN_URI }, "latest"]);
  const uri = result ? https(decodeString(result)) : null;
  if (!uri) return {};
  const m = await get(uri);
  if (m.is_nsfw) return { nsfw: true };
  return {
    image: https(m.image_uri),
    website: https(m.website),
    twitter: handle(m.twitter, "x.com"),
    telegram: handle(m.telegram, "t.me"),
  };
}

async function main() {
  const tokensPath = resolve(DIR, "tokens.json");
  if (!existsSync(tokensPath)) return console.log("[logos] no tokens.json, skipped");
  const list = JSON.parse(readFileSync(tokensPath, "utf8")).tokens;
  const tokens = list.map((t) => t.address);
  const createTx = Object.fromEntries(list.map((t) => [t.address, t.createTx]));
  let known = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  if (process.env.LOGOS_CACHE_URL) {
    try {
      known = { ...(await get(process.env.LOGOS_CACHE_URL)), ...known };
    } catch (e) {
      console.log(`[logos] no cache from the live site (${e.message})`);
    }
  }
  // Fetch tokens never seen, and older cache entries made before curve/createdAt were recorded.
  const todo = tokens.filter((a) => !(a in known) || !("createdAt" in known[a])).slice(0, MAX_NEW);
  let failed = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        try {
          const meta = a in known ? known[a] : await lookup(a);
          known[a] = { ...meta, ...(await origin(createTx[a])) };
        } catch (e) {
          if (!failed) console.log(`[logos] first failure: ${e.message}`);
          failed++; // retried on the next build
        }
      }
    }),
  );
  const out = Object.fromEntries(tokens.filter((a) => a in known).map((a) => [a, known[a]]));
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`[logos] ${Object.keys(out).length}/${tokens.length} tokens, ${todo.length - failed} fetched, ${failed} failed`);
}

main().catch((e) => console.log(`[logos] skipped: ${e.message}`));
