import { afterEach, describe, expect, it, vi } from "vitest";
import { isContractCode } from "./chain.js";
import { chunkRange } from "./ranges.js";
import { RpcClient, RpcError, RpcLimitError, classifyRpcError } from "./rpc.js";

describe("chunkRange", () => {
  it("splits inclusive ranges into chunks of at most size blocks", () => {
    expect(chunkRange(0, 249, 100)).toEqual([
      [0, 99],
      [100, 199],
      [200, 249],
    ]);
  });
  it("handles a single block", () => {
    expect(chunkRange(7, 7, 100)).toEqual([[7, 7]]);
  });
  it("returns nothing for an empty range", () => {
    expect(chunkRange(10, 9, 100)).toEqual([]);
  });
  it("rejects size < 1", () => {
    expect(() => chunkRange(0, 1, 0)).toThrow();
  });
});

describe("classifyRpcError", () => {
  // Messages below are the exact errors observed from Monad RPCs on 2026-10-08.
  it.each([
    ["eth_getLogs is limited to a 100 range", -32614],
    ["block range too large", -32602],
    ["Block range is too large", -32062],
  ])("treats %s as a non-retryable limit error", (msg, code) => {
    const e = classifyRpcError("eth_getLogs", code, msg);
    expect(e).toBeInstanceOf(RpcLimitError);
    expect(e.retryable).toBe(false);
  });

  it("treats method-not-found and access errors as fatal", () => {
    expect(classifyRpcError("trace_filter", -32601, "Method not found").retryable).toBe(false);
    expect(classifyRpcError("debug_traceTransaction", -32053, "API key is not allowed to access method").retryable).toBe(false);
  });

  it.each([
    ["rate limit exceeded", -32000],
    ["request rate exceeded", -32005],
    ["capacity exceeded", -32000],
    ["Too Many Requests", -32000],
  ])("treats rate limiting (%s) as retryable, not as a size limit", (msg, code) => {
    const e = classifyRpcError("eth_getLogs", code, msg);
    expect(e).not.toBeInstanceOf(RpcLimitError);
    expect(e.retryable).toBe(true);
    expect(e.code).toBe(429);
  });

  it("treats unknown server errors as retryable", () => {
    expect(classifyRpcError("eth_call", -32000, "internal error").retryable).toBe(true);
  });
});

describe("RpcClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("retries retryable failures then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => respond({}, 429))
      .mockImplementationOnce(() => respond({ jsonrpc: "2.0", id: 1, result: "0x10" }));
    vi.stubGlobal("fetch", fetchMock);
    const rpc = new RpcClient({ url: "http://x", retries: 2 });
    await expect(rpc.call<string>("eth_blockNumber", [])).resolves.toBe("0x10");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry limit errors", async () => {
    const fetchMock = vi.fn(() => respond({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "block range too large" } }));
    vi.stubGlobal("fetch", fetchMock);
    const rpc = new RpcClient({ url: "http://x", retries: 3 });
    await expect(rpc.call("eth_getLogs", [{}])).rejects.toBeInstanceOf(RpcError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never caches null results", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => respond({ jsonrpc: "2.0", id: 1, result: null }))
      .mockImplementationOnce(() => respond({ jsonrpc: "2.0", id: 1, result: { from: "0xabc" } }));
    vi.stubGlobal("fetch", fetchMock);
    const rpc = new RpcClient({ url: "http://x" });
    expect(await rpc.call("eth_getTransactionByHash", ["0x1"], { cache: true })).toBeNull();
    expect(await rpc.call("eth_getTransactionByHash", ["0x1"], { cache: true })).toEqual({ from: "0xabc" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out while reading a stalled body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve({
          status: 200,
          json: () =>
            new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted")))),
        } as unknown as Response),
      ),
    );
    const rpc = new RpcClient({ url: "http://x", timeoutMs: 20, retries: 0 });
    await expect(rpc.call("debug_traceBlockByNumber", [])).rejects.toThrow(/timed out/);
  });

  it("caches only when asked", async () => {
    const fetchMock = vi.fn(() => respond({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    vi.stubGlobal("fetch", fetchMock);
    const rpc = new RpcClient({ url: "http://x" });
    await rpc.call("eth_getBalance", ["0xa", "0x1"], { cache: true });
    await rpc.call("eth_getBalance", ["0xa", "0x1"], { cache: true });
    await rpc.call("eth_blockNumber", []);
    await rpc.call("eth_blockNumber", []);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("isContractCode", () => {
  it("treats empty code as an EOA", () => {
    expect(isContractCode("0x")).toBe(false);
  });
  it("treats EIP-7702 delegation designators as EOAs", () => {
    // Exact shape observed on Monad mainnet (e.g. 0xd243…f160): 0xef0100 + 20-byte delegate.
    expect(isContractCode("0xef010063" + "ab".repeat(19))).toBe(false);
  });
  it("treats real bytecode as a contract, including code that merely starts with ef01", () => {
    expect(isContractCode("0x6080604052")).toBe(true);
    expect(isContractCode("0xef0100" + "ab".repeat(21))).toBe(true);
  });
});
