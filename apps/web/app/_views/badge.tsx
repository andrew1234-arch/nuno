import { LEVEL_LABEL, type Level } from "@/lib/levels";

const STYLE: Record<Level, string> = {
  red: "bg-[color-mix(in_srgb,var(--flag)_14%,transparent)] text-[var(--flag)]",
  amber: "bg-[color-mix(in_srgb,var(--c-accent)_20%,transparent)] text-[var(--c-accent-text)]",
  clear: "bg-[color-mix(in_srgb,var(--organic)_14%,transparent)] text-[var(--organic)]",
  none: "bg-[var(--panel)] text-[var(--muted)]",
};

const DOT: Record<Level, string> = {
  red: "bg-[var(--flag)]",
  amber: "bg-[var(--c-accent)]",
  clear: "bg-[var(--organic)]",
  none: "bg-[var(--unknown)]",
};

export function Badge({ level, large }: { level: Level; large?: boolean }) {
  return (
    <span className={`pill inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium ${large ? "px-4 py-1.5 text-base" : "px-2.5 py-0.5 text-xs"} ${STYLE[level]}`}>
      <span className={`rounded-full ${large ? "h-2.5 w-2.5" : "h-2 w-2"} ${DOT[level]}`} aria-hidden="true" />
      {LEVEL_LABEL[level]}
    </span>
  );
}
