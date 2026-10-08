import { inArray } from "drizzle-orm";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { MAX_PARAMS, chunks, insertIgnore, type SqlDb } from "./client.js";
import { addresses } from "./schema.js";

const norm = (a: string) => a.toLowerCase() as Hex;

/**
 * Address dictionary (SPEC §7.11 rule 1): 20-byte blobs <-> integer ids, cached in memory.
 * `ids()` creates missing entries; `hexes()` resolves ids back for display.
 */
export class AddressBook {
  private readonly byHex = new Map<string, number>();
  private readonly byId = new Map<number, Hex>();

  constructor(private readonly db: SqlDb) {}

  private remember(id: number, hex: Hex) {
    this.byHex.set(hex, id);
    this.byId.set(id, hex);
  }

  /** Ids for addresses, inserting any that are new. */
  async ids(addrs: string[]): Promise<Map<string, number>> {
    const want = [...new Set(addrs.map(norm))];
    const missing = want.filter((a) => !this.byHex.has(a));
    if (missing.length) {
      await this.load(missing);
      const stillMissing = missing.filter((a) => !this.byHex.has(a));
      if (stillMissing.length) {
        await insertIgnore(this.db, addresses, stillMissing.map((a) => ({ addr: hexToBytes(a) })));
        await this.load(stillMissing);
      }
    }
    const out = new Map<string, number>();
    for (const a of want) {
      const id = this.byHex.get(a);
      if (id === undefined) throw new Error(`address ${a} could not be stored`);
      out.set(a, id);
    }
    return out;
  }

  async id(addr: string): Promise<number> {
    return (await this.ids([addr])).get(norm(addr))!;
  }

  /** Existing id or undefined (never inserts): for lookups such as API paths. */
  async find(addr: string): Promise<number | undefined> {
    const a = norm(addr);
    if (!this.byHex.has(a)) await this.load([a]);
    return this.byHex.get(a);
  }

  /** Hex addresses for ids (unknown ids are omitted). */
  async hexes(ids: number[]): Promise<Map<number, Hex>> {
    const missing = [...new Set(ids)].filter((id) => id !== 0 && !this.byId.has(id));
    for (const part of chunks(missing, MAX_PARAMS - 1)) {
      const rows = await this.db.select().from(addresses).where(inArray(addresses.id, part));
      for (const r of rows) this.remember(r.id, bytesToHex(r.addr));
    }
    const out = new Map<number, Hex>();
    for (const id of ids) {
      const h = this.byId.get(id);
      if (h) out.set(id, h);
    }
    return out;
  }

  async hex(id: number): Promise<Hex | undefined> {
    return (await this.hexes([id])).get(id);
  }

  private async load(hexes: Hex[]) {
    for (const part of chunks(hexes, MAX_PARAMS - 1)) {
      const rows = await this.db
        .select()
        .from(addresses)
        .where(inArray(addresses.addr, part.map((h) => hexToBytes(h))));
      for (const r of rows) this.remember(r.id, bytesToHex(r.addr));
    }
  }
}

export const txBytes = (h: string): Uint8Array => hexToBytes(h as Hex);
export const txHex = (b: Uint8Array): Hex => bytesToHex(b);
