import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Reads Nuno's static API from a base URL (https://…/api) or a local export directory (site/api). */
export interface Source {
  get<T>(path: string): Promise<T | null>;
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

/** Lowercases and validates an address so it is safe to use as a file or URL segment. */
export function normalizeAddress(input: string): string {
  const a = input.trim().toLowerCase();
  if (!ADDRESS.test(a)) throw new Error(`not an address: ${input}`);
  return a;
}

export function createSource(base: string, fetchImpl: typeof fetch = fetch): Source {
  const remote = /^https?:\/\//.test(base);
  return {
    async get<T>(path: string): Promise<T | null> {
      if (remote) {
        const res = await fetchImpl(`${base.replace(/\/$/, "")}/${path}`, { signal: AbortSignal.timeout(10_000) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Nuno API ${res.status} for ${path}`);
        return (await res.json()) as T;
      }
      try {
        return JSON.parse(await readFile(join(base, path), "utf8")) as T;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
  };
}
