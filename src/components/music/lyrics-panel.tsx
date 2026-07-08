"use client";

import { cn } from "@/lib/utils";

export interface LyricsPanelProps {
  lyrics: string;
  className?: string;
}

/**
 * Scrollable, pre-wrapped lyrics display with a gradient left border accent.
 * Uses whitespace-pre-wrap to preserve line breaks authored by the LLM,
 * and a monospace typeface to mimic a lyric sheet.
 */
export function LyricsPanel({ lyrics, className }: LyricsPanelProps) {
  return (
    <div
      className={cn(
        "relative max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-4",
        // Gradient left accent bar via a pseudo-element look using border + bg layered.
        "before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-fuchsia-500 before:via-purple-400 before:to-rose-400",
        className,
      )}
    >
      <pre
        className="whitespace-pre-wrap break-words pl-3 font-mono text-[13px] leading-relaxed text-foreground/80"
      >
        {lyrics?.trim() || "No lyrics available for this track."}
      </pre>
    </div>
  );
}

export default LyricsPanel;
