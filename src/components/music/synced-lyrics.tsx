"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePlayerStore } from "@/lib/player-store";
import {
  estimateLineTimestamps,
  findActiveLineIndex,
  type LyricLine,
} from "@/lib/lyrics-timestamps";
import { cn } from "@/lib/utils";

export interface SyncedLyricsProps {
  /** Raw lyrics text (may include `[Verse]`/`[Chorus]` section tags). */
  lyrics: string;
  /** Total track duration in milliseconds (from the `Song` object). */
  durationMs: number;
  /**
   * Current playback position in seconds. Falls back to — and is overridden
   * by — the live `currentTime` from `usePlayerStore` when a track is loaded,
   * so that karaoke highlighting tracks real playback without the parent
   * having to re-render on every `timeupdate` event.
   */
  currentTime?: number;
  /** Optional extra classes for the scroll container. */
  className?: string;
}

/**
 * Karaoke-style synced lyrics.
 *
 * Splits the lyrics into timestamped lines (via `estimateLineTimestamps`),
 * highlights the line whose `startTime <= currentTime`, dims past lines, and
 * auto-scrolls the active line into the center of the viewport. Section tags
 * (`[Verse]`, `[Chorus]`, …) are rendered as small uppercase muted headings
 * and are never highlighted.
 *
 * Live playback state (`currentTime`, `duration`) is sourced from the shared
 * `usePlayerStore` so this component stays in lock-step with the bottom
 * player bar.
 */
export function SyncedLyrics({
  lyrics,
  durationMs,
  currentTime = 0,
  className,
}: SyncedLyricsProps) {
  // Live playback state from the shared player store.
  const storeTime = usePlayerStore((s) => s.currentTime);
  const storeDuration = usePlayerStore((s) => s.duration);

  // Prefer the store's live currentTime when a track is actively loaded
  // (storeTime > 0 once playback begins); otherwise fall back to the prop.
  const effectiveTime = storeTime > 0 ? storeTime : currentTime;
  // Prefer the store's live duration (seconds → ms) once metadata loads;
  // otherwise fall back to the song's persisted durationMs.
  const effectiveDurationMs =
    storeDuration > 0 ? storeDuration * 1000 : durationMs;

  // Memoize the timestamped line list — only recompute when the lyrics text
  // or the effective duration changes.
  const lines = useMemo<LyricLine[]>(
    () => estimateLineTimestamps(lyrics, effectiveDurationMs),
    [lyrics, effectiveDurationMs],
  );

  // Active line = last non-section line whose startTime <= effectiveTime.
  const activeIndex = useMemo(
    () => findActiveLineIndex(lines, effectiveTime),
    [lines, effectiveTime],
  );

  // ── auto-scroll the active line into the center of the viewport ─────────
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    const container = containerRef.current;
    if (!el || !container) return;

    const elTop = el.offsetTop;
    const elHeight = el.offsetHeight;
    const containerHeight = container.clientHeight;
    // Center the active line vertically within the scroll viewport.
    const target = elTop - containerHeight / 2 + elHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeIndex]);

  // ── empty-state ──────────────────────────────────────────────────────────
  if (!lyrics?.trim() || lines.length === 0) {
    return (
      <div
        className={cn(
          "max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-4",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No lyrics available for this track.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-4",
        // Subtle top + bottom fade so lines drift in/out of view karaoke-style.
        "[mask-image:linear-gradient(to_bottom,transparent_0,black_14%,black_86%,transparent_100%)]",
        "[-webkit-mask-image:linear-gradient(to_bottom,transparent_0,black_14%,black_86%,transparent_100%)]",
        className,
      )}
      role="region"
      aria-label="Synced lyrics"
    >
      <div className="flex flex-col gap-3 py-6">
        {lines.map((line, i) => {
          // Section tags: small, uppercase, muted — never highlighted.
          if (line.isSection) {
            return (
              <p
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/60"
              >
                {line.text}
              </p>
            );
          }

          const isActive = i === activeIndex;
          const isPast = i < activeIndex;

          return (
            <p
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className={cn(
                "cursor-pointer rounded-md px-1 transition-all duration-300 ease-out",
                // Default (future) line
                "text-base font-medium text-foreground/80",
                // Past lines: dimmed
                isPast && "opacity-50",
                // Active line: larger, fuchsia, brighter, slight lift
                isActive &&
                  "text-lg font-bold text-fuchsia-400 opacity-100 drop-shadow-[0_0_12px_rgba(217,70,239,0.45)]",
              )}
            >
              {line.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export default SyncedLyrics;
