const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const uintString = { type: "string", description: "Unsigned integer in base units (wei-style), as a decimal string" };
const bps = { type: "integer", minimum: 0, maximum: 10000 };

const evidence = {
  type: "object",
  required: ["type", "txHash", "block"],
  properties: {
    type: {
      type: "string",
      enum: ["same_direct_funder", "common_funding_source", "creator_funded", "token_transfer", "same_block_early_buy", "same_block_sell"],
    },
    txHash: { type: "string" },
    block: { type: "integer" },
    token: address,
    detail: { type: "string" },
  },
};

const cluster = {
  type: "object",
  properties: {
    id: address,
    size: { type: "integer" },
    members: { type: "array", items: address },
    createdTokens: { type: "array", items: address },
    sourceBlock: { type: "integer" },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: { a: address, b: address, type: { type: "string" }, weight: { type: "number" }, evidence: { type: "array", items: evidence } },
      },
    },
  },
};

const metrics = {
  type: ["object", "null"],
  properties: {
    sourceBlock: { type: "integer", description: "Monad mainnet block the metrics were computed at" },
    totalSupply: uintString,
    rawHolders: { type: "integer" },
    realHolders: { type: "integer", description: "Distinct entities with a non-zero balance" },
    effectiveTop10Bps: bps,
    clusterSupplyBps: bps,
    creatorLinkedSupplyBps: bps,
    rawVolume: uintString,
    organicVolume: uintString,
    organicVolumeBps: bps,
    evidenceRoot: { type: "string", description: "keccak256 of the canonical evidence JSON" },
    computedAt: { type: "string", format: "date-time" },
  },
};

const token = {
  type: "object",
  properties: {
    address,
    name: { type: "string" },
    symbol: { type: "string" },
    creator: address,
    createBlock: { type: "integer" },
    createTx: { type: "string" },
    graduatedPool: { type: ["string", "null"] },
    metrics,
  },
};

const notFound = { description: "Not found" };
const badRequest = { description: "Invalid parameter" };
const addrParam = (name: string) => ({ name, in: "path", required: true, schema: address });

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Nuno API",
    version: "0.1.0",
    description:
      "Cluster-adjusted metrics for nad.fun tokens on Monad mainnet. Every cluster link carries its evidence (edge type, tx hash, block). Methodology: docs/METHODOLOGY.md.",
  },
  paths: {
    "/tokens": {
      get: {
        summary: "Tracked tokens with raw vs adjusted metrics",
        parameters: [
          {
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["holder_gap", "cluster_supply", "creator_supply", "wash", "raw_volume", "newest"], default: "holder_gap" },
          },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: {
          "200": {
            description: "Tokens",
            content: { "application/json": { schema: { type: "object", properties: { sort: { type: "string" }, count: { type: "integer" }, tokens: { type: "array", items: token } } } } },
          },
          "400": badRequest,
        },
      },
    },
    "/tokens/{address}": {
      get: {
        summary: "One token with metrics and its latest on-chain NunoFeed snapshot",
        parameters: [addrParam("address")],
        responses: { "200": { description: "Token", content: { "application/json": { schema: token } } }, "400": badRequest, "404": notFound },
      },
    },
    "/tokens/{address}/clusters": {
      get: {
        summary: "Multi-wallet entities active in this token, with evidence",
        parameters: [addrParam("address")],
        responses: {
          "200": { description: "Clusters", content: { "application/json": { schema: { type: "object", properties: { token: address, count: { type: "integer" }, clusters: { type: "array", items: cluster } } } } } },
          "400": badRequest,
          "404": notFound,
        },
      },
    },
    "/clusters/{id}": {
      get: {
        summary: "One entity (cluster): members and every link's evidence",
        parameters: [addrParam("id")],
        responses: { "200": { description: "Cluster", content: { "application/json": { schema: cluster } } }, "400": badRequest, "404": notFound },
      },
    },
    "/wallets/{address}": {
      get: {
        summary: "A wallet's entity, funding edges and trades",
        parameters: [addrParam("address")],
        responses: { "200": { description: "Wallet" }, "400": badRequest, "404": notFound },
      },
    },
  },
} as const;
