"use client";

import { useState } from "react";

const HUES = [28, 200, 140, 280, 340, 50, 170, 230];

/** Token image from its nad.fun metadata, or a lettered circle when there is none or it fails to load. */
export function TokenLogo({ src, symbol, size = 32 }: { src?: string | null; symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (src && !failed) {
    return <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="shrink-0 rounded-full bg-[var(--panel)] object-cover" style={style} />;
  }
  const hue = HUES[[...symbol].reduce((h, c) => h + c.charCodeAt(0), 0) % HUES.length];
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ ...style, background: `hsl(${hue} 55% 45%)`, fontSize: size * 0.42 }}>
      {(symbol.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}
