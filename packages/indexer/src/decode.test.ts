import { describe, expect, it } from "vitest";
import { TOPICS, type RpcLog } from "@nuno/shared";
import { decodeCurveLog, decodeSwapLog } from "./decode.js";

const V2 = "0x9f3832732923252a21044f21ee6bd87f09514ae4";
const pad = (a: string) => `0x000000000000000000000000${a.slice(2)}` as const;
const log = (topics: string[], data: string): RpcLog =>
  ({ address: V2, topics, data, blockNumber: "0x1", transactionHash: `0x${"0".repeat(64)}`, logIndex: "0x0" }) as RpcLog;

// Fixtures: real mainnet V2 logs captured 2026-10-11 (tx 0xb20b86d3…, 0x88cb2245…, 0x8a55038a…).
describe("decodeCurveLog: nad.fun V2", () => {
  it("decodes the create event by layout (creator, token, pool; name, symbol, uri)", () => {
    const data =
      "0x0000000000000000000000003bd359c1119da7da1d913d1c4d2b7c461115433a00000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000ed2b525841adfc000000000000000000000000000000000000000000000036d4838b18bc4ba75a00000000000000000000000000000000000000000000000d02b2bd359927a58a822b7000000000000000000000000000000000000000000000000000000000000000e556e6973776170204d6173636f7400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000067377617070790000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004d68747470733a2f2f73746f726167652e6e61646170702e6e65742f6d657461646174612f63343663383736352d636238302d346535362d626661372d3532646261313633333532642e6a736f6e00000000000000000000000000000000000000";
    const r = decodeCurveLog(
      log([TOPICS.V2Create, pad("0x5d6f8e8e8b688be08c32d68485a4c137c82ca89b"), pad("0x0293e493887c61edcd39ddf0dc3eb7684a897777"), pad("0x1b66ae713b01980a498660b245436b5e024aa930")], data),
    );
    expect(r).toEqual({
      kind: "create",
      creator: "0x5d6f8e8e8b688be08c32d68485a4c137c82ca89b",
      token: "0x0293e493887c61edcd39ddf0dc3eb7684a897777",
      pool: "0x1b66ae713b01980a498660b245436b5e024aa930",
      name: "Uniswap Mascot",
      symbol: "swappy",
      tokenUri: "https://storage.nadapp.net/metadata/c46c8765-cb80-4e56-bfa7-52dba163352d.json",
    });
  });

  it("decodes buy with topic1 = token, topic2 = sender (reverse of V1)", () => {
    const r = decodeCurveLog(
      log(
        [TOPICS.V2Buy, pad("0xc8a6331208fcb3f49212808905f1f08ee7ef7777"), pad("0xad787af42c3b3fd8f596ac8e6bc68f4fd907c970")],
        "0x00000000000000000000000000000000000000000000002b5e3af16b1880000000000000000000000000000000000000000000000004a4fae94c00817ae23691",
      ),
    );
    expect(r).toMatchObject({ kind: "trade", side: "buy", token: "0xc8a6331208fcb3f49212808905f1f08ee7ef7777", trader: "0xad787af42c3b3fd8f596ac8e6bc68f4fd907c970", amountIn: 800n * 10n ** 18n });
  });

  it("decodes sell (sender is the router here; the indexer attributes it to the signer)", () => {
    const r = decodeCurveLog(
      log(
        [TOPICS.V2Sell, pad("0x2fbcb475de6b91b39805377a87afca01cd617777"), pad("0x8986c8fd44eb85294a725a7e61af35e76ba26f91")],
        "0x0000000000000000000000000000000000000000000450eb490a9ccf3bbb1d57000000000000000000000000000000000000000000000025dec9a1a88a7f2490",
      ),
    );
    expect(r).toMatchObject({ kind: "trade", side: "sell", token: "0x2fbcb475de6b91b39805377a87afca01cd617777", trader: "0x8986c8fd44eb85294a725a7e61af35e76ba26f91" });
  });

  it("ignores the V2 Sync event and malformed creates", () => {
    expect(decodeCurveLog(log(["0x27efe2fec96cb0ff68b9206e3dca402a919bb7172e2f2d12d49b633df3eabc4f", pad(V2)], "0x"))).toEqual({ kind: "ignored" });
    expect(decodeCurveLog(log([TOPICS.V2Create, pad(V2)], "0x"))).toEqual({ kind: "ignored" });
  });
});

// Fixtures: Moncat (0x7d1c…7777) graduation, tx 0x0e4e7c25… block 110,980,938, and the first swap on
// its pair, tx 0x7715002b… block 110,980,940 (real mainnet logs, captured 2026-10-11).
describe("V2 graduation and Uniswap V2-style pair swaps", () => {
  it("decodes Graduate(token, pool) from the V2 curve", () => {
    const r = decodeCurveLog(log([TOPICS.V2Graduate, pad("0x7d1ca08c16a46837b02a25112d188b6df1d17777"), pad("0xbd1bebc1ca6ce1955ed5ec466b89da58051d8f4e")], "0x"));
    expect(r).toEqual({ kind: "graduate", token: "0x7d1ca08c16a46837b02a25112d188b6df1d17777", pool: "0xbd1bebc1ca6ce1955ed5ec466b89da58051d8f4e" });
  });

  it("normalizes a V2 pair Swap to signed pool deltas (WMON in, token out = buy)", () => {
    const sw = decodeSwapLog({
      ...log(
        [
          "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
          pad("0x251886ada13aa3fb2b02bb101fd9a263cca7ede4"),
          pad("0xb6abdad170f18b43ac3eb77489a3e9762778fa15"),
        ],
        "0x00000000000000000000000000000000000000000000002aa1011944a934b77a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008b4d1a1afb96b3e7d907",
      ),
      address: "0xbd1bebc1ca6ce1955ed5ec466b89da58051d8f4e",
    } as RpcLog);
    expect(sw).not.toBeNull();
    expect(sw!.pool).toBe("0xbd1bebc1ca6ce1955ed5ec466b89da58051d8f4e");
    expect(sw!.recipient).toBe("0xb6abdad170f18b43ac3eb77489a3e9762778fa15");
    expect(sw!.amount0).toBe(0x2aa1011944a934b77an); // WMON (token0) into the pool
    expect(sw!.amount1).toBe(-0x8b4d1a1afb96b3e7d907n); // Moncat out of the pool
  });
});
