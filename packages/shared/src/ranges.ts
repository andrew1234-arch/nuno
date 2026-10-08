/** Split inclusive [from, to] into inclusive chunks of at most `size` blocks. */
export function chunkRange(from: number, to: number, size: number): Array<[number, number]> {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: Array<[number, number]> = [];
  for (let start = from; start <= to; start += size) {
    out.push([start, Math.min(start + size - 1, to)]);
  }
  return out;
}

export const lower = <T extends string>(a: T): Lowercase<T> => a.toLowerCase() as Lowercase<T>;
