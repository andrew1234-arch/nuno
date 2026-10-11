/**
 * Smallest block b in [lo, hi] where the monotone predicate `touched(b)` is true, or null.
 *
 * For an EOA, touched(b) = balance(b) > 0 || nonce(b) > 0 is monotone: once funded, the only
 * way to drain the balance is to send a transaction, which raises the nonce. The first such
 * block therefore contains the wallet's first inbound value transfer.
 * (Caveat: EIP-7702-delegated accounts can move funds without a nonce bump; documented in
 * METHODOLOGY.md.)
 */
/** Backward gallop stops at this distance from `hi` and falls back to a plain binary search. */
export const GALLOP_LIMIT = 4_096;

/**
 * Same result as a plain binary search over [lo, hi], but first gallops backwards from `hi`
 * (distances 1, 2, 4, …, GALLOP_LIMIT). Funding chains of fresh wallets are typically funded a few
 * blocks before they spend, so this finds them in ~2·log2(distance) probes instead of ~log2(hi − lo)
 * (≈27 over Monad's history). Old wallets pay at most ~13 extra probes.
 */
export async function firstTrueBlock(
  lo: number,
  hi: number,
  touched: (block: number) => Promise<boolean>,
): Promise<number | null> {
  if (lo > hi) return null;
  if (!(await touched(hi))) return null;
  let top = hi; // known true
  for (let d = 1; d <= GALLOP_LIMIT && hi - d >= lo; d *= 2) {
    const b = hi - d;
    if (!(await touched(b))) {
      lo = b + 1; // known false at b
      break;
    }
    top = b;
  }
  hi = top;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await touched(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
