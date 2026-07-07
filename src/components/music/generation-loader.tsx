"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { EqualizerBars } from "./equalizer-bars";

export interface GenerationLoaderProps {
  /** Called when the user clicks "Cancel". The parent aborts the fetch. */
  onCancel?: () => void;
}

/**
 * Loading state shown in place of the composer while a song is being generated.
 *
 * The Ace Music cloud API is synchronous and its latency varies a lot with
 * server load (15s to 2min+). This loader surfaces a live elapsed timer + a
 * message that adapts as time passes, so the user knows the request is still
 * in flight and hasn't silently died. Also offers a Cancel button.
 */
const STAGES = [
  "Writing lyrics with the LLM lyricist…",
  "Composing the instrumental arrangement…",
  "Synthesizing vocals & music with Ace Music…",
  "Rendering the final mix…",
] as const;

/** Format seconds as m:ss. */
function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function GenerationLoader({ onCancel }: GenerationLoaderProps) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Cycle stage copy every ~3s.
  useEffect(() => {
    const id = setInterval(() => {
      setStageIndex((i) => (i + 1) % STAGES.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // Elapsed timer (updates every second).
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Adaptive message based on elapsed time.
  const message =
    elapsed < 20
      ? "The Ace Music model is rendering your track…"
      : elapsed < 45
        ? "Still working — the model is composing vocals + instrumentation."
        : elapsed < 90
          ? "Taking longer than usual (server load). Hang tight, it's still in progress."
          : "Almost there — large generations can take up to 2 minutes.";

  return (
    <div className="glass-card relative flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10">
      {/* Cancel button (top-right) */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel generation"
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}

      {/* Concentric spinning gradient rings */}
      <div className="relative grid size-24 place-items-center">
        <span className="music-spin-slow absolute inset-0 rounded-full border-2 border-transparent [background:conic-gradient(from_0deg,transparent,rgba(217,70,239,0.85),transparent_45%,rgba(139,92,246,0.7),transparent_75%)] [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] p-[2px]" />
        <span className="music-spin-rev absolute inset-2 rounded-full border-2 border-transparent [background:conic-gradient(from_180deg,transparent,rgba(244,63,94,0.7),transparent_60%,rgba(192,132,252,0.6),transparent)] [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] p-[2px]" />
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-rose-500 shadow-lg shadow-fuchsia-500/30"
        >
          <Sparkles className="size-5 text-white" />
        </motion.div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300/80">
          Generating · {fmt(elapsed)}
        </p>
        <motion.p
          key={stageIndex}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35 }}
          className="min-h-[1.5rem] text-sm font-medium text-foreground/90 sm:text-base"
        >
          {STAGES[stageIndex]}
        </motion.p>
      </div>

      <EqualizerBars active barCount={7} className="h-8" />

      {/* Progress bar — fills based on elapsed time (capped at ~120s = 100%) */}
      <div className="relative h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-fuchsia-500 to-rose-400 transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(95, (elapsed / 120) * 100)}%` }}
        />
        <div className="music-shimmer absolute inset-0" />
      </div>

      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Cancel generation
        </button>
      )}
    </div>
  );
}

export default GenerationLoader;
