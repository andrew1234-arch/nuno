#!/usr/bin/env -S npx tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_POLICY, counterpartyVerdict, tokenVerdict, type EntityFile, type MetaFile, type TokenFile, type WalletFile } from "./gate.js";
import { createSource, normalizeAddress } from "./source.js";

// MCP server (stdio). NUNO_API_URL is the static API base: a URL or a local export directory.
const source = createSource(process.env.NUNO_API_URL ?? "https://nuno-eight.vercel.app/api");
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

const server = new McpServer({ name: "nuno", version: "0.1.0" });

server.registerTool(
  "check_token",
  {
    description:
      "Call before buying a token. Returns allow/deny with reasons: share of supply held by linked wallets, real owner count after linked wallets are counted once, and data age. Missing or stale data is a deny.",
    inputSchema: {
      token: z.string().describe("Token contract address (0x…)"),
      maxClusterSupplyBps: z.number().int().min(0).max(10_000).optional(),
      maxCreatorLinkedSupplyBps: z.number().int().min(0).max(10_000).optional(),
      minRealHolders: z.number().int().min(0).optional(),
      maxAgeSeconds: z.number().int().min(1).optional(),
    },
  },
  async ({ token, ...overrides }) => {
    const address = normalizeAddress(token);
    const policy = { ...DEFAULT_POLICY, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
    const [file, meta] = await Promise.all([source.get<TokenFile>(`tokens/${address}.json`), source.get<MetaFile>("meta.json")]);
    return json({ token: address, policy, ...tokenVerdict(file, meta, new Date(), policy) });
  },
);

server.registerTool(
  "check_counterparty",
  {
    description:
      "Call before paying or trading with a wallet. Says whether the wallet belongs to a group of linked wallets run as one entity, with the transactions that link them. `known: false` means nothing was found, not that the wallet is verified.",
    inputSchema: { wallet: z.string().describe("Wallet address (0x…)") },
  },
  async ({ wallet }) => {
    const address = normalizeAddress(wallet);
    const file = await source.get<WalletFile>(`wallets/${address}.json`);
    const entity = file?.entityId ? await source.get<EntityFile>(`clusters/${file.entityId}.json`) : null;
    return json({ wallet: address, ...counterpartyVerdict(file, entity) });
  },
);

await server.connect(new StdioServerTransport());
