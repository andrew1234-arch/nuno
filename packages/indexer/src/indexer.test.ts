import { describe, expect, it } from "vitest";
import { runChunks } from "./indexer.js";

describe("runChunks", () => {
  it("only reports a watermark once every earlier chunk has completed", async () => {
    const chunks: Array<[number, number]> = [
      [0, 9],
      [10, 19],
      [20, 29],
      [30, 39],
    ];
    // Chunk 0 finishes last.
    const delay: Record<number, number> = { 0: 40, 10: 5, 20: 10, 30: 1 };
    const marks: number[] = [];
    await runChunks(
      chunks,
      4,
      (a) => new Promise((r) => setTimeout(r, delay[a])),
      async (m) => void marks.push(m),
    );
    expect(marks).toEqual([39]);
  });

  it("reports watermarks in increasing order when chunks finish in order", async () => {
    const marks: number[] = [];
    await runChunks(
      [
        [0, 9],
        [10, 19],
        [20, 29],
      ],
      1,
      async () => {},
      async (m) => void marks.push(m),
    );
    expect(marks).toEqual([9, 19, 29]);
  });

  it("stops taking new chunks when asked, leaving a valid watermark", async () => {
    const marks: number[] = [];
    let ran = 0;
    await runChunks(
      [
        [0, 9],
        [10, 19],
        [20, 29],
        [30, 39],
      ],
      1,
      async () => void ran++,
      async (m) => void marks.push(m),
      () => ran >= 2,
    );
    expect(ran).toBe(2);
    expect(marks).toEqual([9, 19]); // resume from 20
  });

  it("propagates chunk errors", async () => {
    await expect(
      runChunks([[0, 9]], 2, async () => Promise.reject(new Error("boom")), async () => {}),
    ).rejects.toThrow("boom");
  });
});
