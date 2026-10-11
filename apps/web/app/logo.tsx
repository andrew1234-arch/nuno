/** Nuno mark: three wallets collapsing into one entity. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 24" className={className} aria-hidden="true">
      <circle cx="8" cy="12" r="6" fill="currentColor" opacity="0.35" />
      <circle cx="16" cy="12" r="6" fill="currentColor" opacity="0.6" />
      <circle cx="24" cy="12" r="6" fill="currentColor" />
    </svg>
  );
}
