/**
 * Smallest block b in [lo, hi] where the monotone predicate `touched(b)` is true, or null.
 *
 * For an EOA, touched(b) = balance(b) > 0 || nonce(b) > 0 is monotone: once funded, the only
 * way to drain the balance is to send a transaction, which raises the nonce. The first such
 * block therefore contains the wallet's first inbound value transfer.
 * (Caveat: EIP-7702-delegated accounts can move funds without a nonce bump; documented in
 * METHODOLOGY.md.)
 */
export async function firstTrueBlock(
  lo: number,
  hi: number,
  touched: (block: number) => Promise<boolean>,
): Promise<number | null> {
  if (lo > hi) return null;
  if (!(await touched(hi))) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await touched(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
