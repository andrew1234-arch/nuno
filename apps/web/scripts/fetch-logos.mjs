// Token logos and links for the site, from each token's own metadata: tokenURI() on the token contract
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
const CONCURRENCY = 8;
const MAX_NEW = Number(process.env.LOGOS_MAX_NEW || 500);

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

async function lookup(address) {
  const res = await get(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: address, data: TOKEN_URI }, "latest"] }),
  });
  const uri = res.result ? https(decodeString(res.result)) : null;
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
  const tokens = JSON.parse(readFileSync(tokensPath, "utf8")).tokens.map((t) => t.address);
  let known = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  if (process.env.LOGOS_CACHE_URL) {
    try {
      known = { ...(await get(process.env.LOGOS_CACHE_URL)), ...known };
    } catch (e) {
      console.log(`[logos] no cache from the live site (${e.message})`);
    }
  }
  const todo = tokens.filter((a) => !(a in known)).slice(0, MAX_NEW);
  let failed = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        try {
          known[a] = await lookup(a);
        } catch {
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
