"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJobSocket, type JobStatus } from "@/hooks/use-job-socket";
import { EqualizerBars } from "./equalizer-bars";

export interface RealtimeLoaderProps {
  /** The job to track. Drives the socket connection via `useJobSocket`. */
  jobId: string;
  /** Called when the user clicks "Cancel". The parent aborts the job. */
  onCancel: () => void;
  /**
   * Called once when the server reports `status === "completed"` AND a
   * `songId` was supplied. Guarded against duplicate invocations across
   * re-renders via an internal ref keyed on `songId`.
   */
  onComplete?: (songId: string) => void;
}

/**
 * Five-step generation timeline. Order is significant — `stepIndexOf` relies
 * on this array's index matching the natural progress order.
 */
const STEPS: { key: JobStatus; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "lyrics", label: "Lyrics" },
  { key: "audio", label: "Audio" },
  { key: "cover", label: "Cover" },
  { key: "completed", label: "Done" },
];

/** Default stage copy. The server may override with a `stage` field. */
const STAGE_LABELS: Record<JobStatus, string> = {
  queued: "Queued — waiting for the music engine…",
  lyrics: "Writing lyrics with the LLM lyricist…",
  audio: "Synthesizing vocals & music with Ace Music…",
  cover: "Generating cover art…",
  completed: "Done! Your track is ready.",
  error: "Generation failed.",
};

type HookStatus = JobStatus | "idle" | "connecting";

function stepIndexOf(status: HookStatus): number {
  if (status === "idle" || status === "connecting") return 0;
  return STEPS.findIndex((s) => s.key === status);
}

/** Format seconds as `m:ss` for the elapsed timer. */
function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Generation loader with REAL-TIME progress (vs. `GenerationLoader`'s
 * time-based fake progress).
 *
 * Subscribes to the socket.io job channel on mount and renders:
 *  - concentric spinning SpotiBot logo
 *  - current stage label (animated transitions between stages)
 *  - live progress bar (0–100% from server)
 *  - 5-step timeline (queued → lyrics → audio → cover → completed) with
 *    check / spinner / pending affordances
 *  - elapsed timer + cancel button
 *
 * On `status === "completed"` with a `songId`, fires `onComplete(songId)`
 * exactly once per `songId` (idempotent across re-renders).
 */
export function RealtimeLoader({
  jobId,
  onCancel,
  onComplete,
}: RealtimeLoaderProps) {
  const { status, progress, error, songId } = useJobSocket(jobId);
  const [elapsed, setElapsed] = useState(0);

  // Elapsed timer (resets implicitly because the component is mounted fresh
  // per generation — parents should key it on `jobId`).
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Fire onComplete exactly once per songId.
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (status === "completed" && songId && firedRef.current !== songId) {
      firedRef.current = songId;
      onComplete?.(songId);
    }
  }, [status, songId, onComplete]);

  const isError = status === "error";
  const isDone = status === "completed";
  const activeIdx = stepIndexOf(status);

  // Per-step visual state.
  const stepState = (i: number): "completed" | "active" | "pending" => {
    if (isDone) return "completed";
    if (isError) {
      // Dim everything except the failed step (if it was the active one).
      return i === activeIdx ? "active" : "pending";
    }
    if (i < activeIdx) return "completed";
    if (i === activeIdx) return "active";
    return "pending";
  };

  const headerLabel = isError
    ? "Error"
    : isDone
      ? "Complete"
      : `Generating · ${fmt(elapsed)}`;

  return (
    <div className="glass-card relative flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10">
      {/* Cancel button (top-right) */}
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel generation"
        className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>

      {/* Concentric spinning gradient rings with the SpotiBot logo at center */}
      <div className="relative grid size-24 place-items-center">
        <span className="music-spin-slow absolute inset-0 rounded-full border-2 border-transparent [background:conic-gradient(from_0deg,transparent,rgba(217,70,239,0.85),transparent_45%,rgba(139,92,246,0.7),transparent_75%)] [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] p-[2px]" />
        <span className="music-spin-rev absolute inset-2 rounded-full border-2 border-transparent [background:conic-gradient(from_180deg,transparent,rgba(244,63,94,0.7),transparent_60%,rgba(192,132,252,0.6),transparent)] [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] p-[2px]" />
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="grid size-14 place-items-center overflow-hidden rounded-full shadow-lg shadow-fuchsia-500/30 ring-1 ring-white/10"
        >
          <img
            src="/spotibot-brand.png"
            alt="SpotiBot"
            width={56}
            height={56}
            className="size-full object-cover"
            draggable={false}
          />
        </motion.div>
      </div>

      <div className="space-y-1.5">
        <p
          className={cn(
            "text-[11px] font-semibold uppercase tracking-[0.18em]",
            isError ? "text-rose-300/80" : "text-fuchsia-300/80",
          )}
        >
          {headerLabel}
        </p>
        <AnimatePresence mode="wait">
          <motion.p
            key={status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
            className="min-h-[1.5rem] text-sm font-medium text-foreground/90 sm:text-base"
          >
            {isError && error ? error : STAGE_LABELS[status]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Real-time progress bar */}
      <div className="w-full max-w-sm space-y-2">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              isError
                ? "bg-gradient-to-r from-rose-500 to-rose-400"
                : "bg-gradient-to-r from-fuchsia-500 to-rose-400",
            )}
            initial={false}
            animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
          {!isDone && !isError && (
            <div className="music-shimmer absolute inset-0" />
          )}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{Math.round(progress)}%</span>
          <span>
            {isDone
              ? "Complete"
              : isError
                ? "Failed"
                : progress > 0
                  ? "In progress"
                  : "Waiting"}
          </span>
        </div>
      </div>

      {/* 5-step timeline */}
      <ol className="flex w-full max-w-md items-start">
        {STEPS.map((step, i) => {
          const state = stepState(i);
          const nextDone = state === "completed";
          return (
            <Fragment key={step.key}>
              <li className="flex shrink-0 flex-col items-center gap-2">
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full border text-[11px] font-semibold transition-colors duration-200",
                    state === "completed" &&
                      "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-200",
                    state === "active" &&
                      "border-fuchsia-400 bg-fuchsia-500/10 text-fuchsia-200 shadow-[0_0_0_4px_rgba(217,70,239,0.15)]",
                    state === "pending" &&
                      "border-white/10 bg-white/5 text-muted-foreground",
                  )}
                >
                  {state === "completed" ? (
                    <Check className="size-4" aria-hidden />
                  ) : state === "active" ? (
                    <Loader2
                      className={cn(
                        "size-4 animate-spin",
                        isError ? "text-rose-300" : "text-fuchsia-300",
                      )}
                      aria-hidden
                    />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    "w-20 text-center text-[10px] font-medium uppercase tracking-wide transition-colors",
                    state === "pending"
                      ? "text-muted-foreground"
                      : isError
                        ? "text-rose-300/90"
                        : "text-fuchsia-200",
                  )}
                >
                  {step.label}
                </span>
              </li>
              {i < STEPS.length - 1 && (
                <li
                  aria-hidden
                  className={cn(
                    "mx-1 mt-4 h-0.5 flex-1 rounded-full transition-colors duration-300",
                    nextDone
                      ? "bg-fuchsia-400/50"
                      : "bg-white/10",
                  )}
                />
              )}
            </Fragment>
          );
        })}
      </ol>

      <EqualizerBars
        active={!isDone && !isError}
        barCount={7}
        className="h-8"
      />

      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        Cancel generation
      </button>
    </div>
  );
}

export default RealtimeLoader;
