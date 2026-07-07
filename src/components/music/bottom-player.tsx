"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Heart,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ChevronUp,
  Music2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/lib/player-store";
import { EqualizerBars } from "./equalizer-bars";
import { LyricsPanel } from "./lyrics-panel";
import { useState } from "react";

/** Format seconds as m:ss. */
function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export interface BottomPlayerProps {
  /** Toggle like on the current song. */
  onToggleLike: (songId: string) => void;
}

/**
 * Sticky bottom player bar — the Suno signature. Owns the single shared
 * `<audio>` element and wires its events to the global player store so every
 * play button in the app (cards, overlays) controls this one audio instance.
 *
 * Hidden (collapsed to zero height) when no song is loaded. Slides up with a
 * spring when a song becomes current.
 */
export function BottomPlayer({ onToggleLike }: BottomPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const registerAudio = usePlayerStore((s) => s.registerAudio);
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const onTimeUpdate = usePlayerStore((s) => s.onTimeUpdate);
  const onDurationChange = usePlayerStore((s) => s.onDurationChange);
  const onPlay = usePlayerStore((s) => s.onPlay);
  const onPause = usePlayerStore((s) => s.onPause);
  const onEnded = usePlayerStore((s) => s.onEnded);
  const beginSeek = usePlayerStore((s) => s.beginSeek);
  const endSeek = usePlayerStore((s) => s.endSeek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  const [showLyrics, setShowLyrics] = useState(false);

  // Register the audio element with the store once.
  useEffect(() => {
    registerAudio(audioRef.current);
    return () => registerAudio(null);
  }, [registerAudio]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasTrack = Boolean(current);

  return (
    <>
      {/* The single shared audio element. src is mutated by the store on playSong. */}
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onDurationChange={(e) => onDurationChange(e.currentTarget.duration || 0)}
        onLoadedMetadata={(e) => onDurationChange(e.currentTarget.duration || 0)}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        className="hidden"
      >
        <track kind="captions" />
      </audio>

      {/* Lyrics drawer (expands above the player bar) */}
      <AnimatePresence>
        {showLyrics && hasTrack && current && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="border-t border-white/10 bg-[#0b0b12]/95 backdrop-blur-xl"
          >
            <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
              <LyricsPanel lyrics={current.lyrics} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The player bar itself */}
      <AnimatePresence>
        {hasTrack && current && (
          <motion.footer
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="sticky bottom-0 z-40 border-t border-white/10 bg-[#0b0b12]/95 backdrop-blur-xl"
            role="region"
            aria-label="Now playing bar"
          >
            <div className="mx-auto flex h-20 max-w-[1600px] items-center gap-3 px-3 sm:gap-4 sm:px-6">
              {/* ── Left: cover + title + tags ─────────────────────────────── */}
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none sm:basis-72">
                <CoverArt id={current.id} size={48} playing={isPlaying} />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-semibold text-foreground"
                    title={current.title}
                  >
                    {current.title}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {current.genre} · {current.mood}
                    </span>
                  </p>
                </div>
                {/* Like */}
                <button
                  type="button"
                  onClick={() => onToggleLike(current.id)}
                  aria-label={current.liked ? "Unlike track" : "Like track"}
                  aria-pressed={current.liked}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <Heart
                    className={cn(
                      "size-4 transition-all",
                      current.liked
                        ? "fill-rose-500 text-rose-500"
                        : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                </button>
              </div>

              {/* ── Center: transport + seek ──────────────────────────────── */}
              <div className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    className="grid size-9 place-items-center rounded-full bg-foreground text-background transition-transform hover:scale-105 active:scale-95"
                  >
                    {isPlaying ? (
                      <Pause className="size-4" fill="currentColor" aria-hidden />
                    ) : (
                      <Play className="size-4 translate-x-0.5" fill="currentColor" aria-hidden />
                    )}
                  </button>
                </div>
                <div className="flex w-full max-w-xl items-center gap-2">
                  <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                    {formatTime(currentTime)}
                  </span>
                  <Slider
                    value={[Math.min(currentTime, duration || 0)]}
                    max={Math.max(duration, 0.0001)}
                    step={0.1}
                    onValueChange={(v) => {
                      beginSeek();
                      onTimeUpdate(v[0] ?? 0);
                    }}
                    onValueCommit={(v) => endSeek(v[0] ?? 0)}
                    aria-label="Seek"
                    className="flex-1 [&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-fuchsia-500 [&_[data-slot=slider-range]]:to-rose-400 [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-fuchsia-400 [&_[data-slot=slider-thumb]]:bg-white"
                  />
                  <span className="w-9 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatTime(duration)}
                  </span>
                </div>
              </div>

              {/* ── Right: volume + lyrics + download ─────────────────────── */}
              <div className="hidden items-center gap-1 sm:flex sm:basis-72 sm:justify-end">
                {/* Lyrics toggle */}
                <button
                  type="button"
                  onClick={() => setShowLyrics((s) => !s)}
                  aria-label={showLyrics ? "Hide lyrics" : "Show lyrics"}
                  aria-expanded={showLyrics}
                  className={cn(
                    "grid size-9 place-items-center rounded-lg transition-colors hover:bg-white/5",
                    showLyrics ? "text-fuchsia-300" : "text-muted-foreground hover:text-foreground",
                  )}
                  title="Lyrics"
                >
                  <ChevronUp
                    className={cn("size-4 transition-transform", showLyrics && "rotate-180")}
                    aria-hidden
                  />
                </button>

                {/* Volume */}
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="size-4" aria-hidden />
                  ) : (
                    <Volume2 className="size-4" aria-hidden />
                  )}
                </button>
                <Slider
                  value={[muted ? 0 : volume]}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => setVolume(v[0] ?? 1)}
                  aria-label="Volume"
                  className="w-20 [&_[data-slot=slider-range]]:bg-fuchsia-400/70 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-fuchsia-400 [&_[data-slot=slider-thumb]]:bg-white"
                />

                {/* Download */}
                <a
                  href={current.audioUrl}
                  download={`${current.title}.${current.audioFormat || "mp3"}`}
                  aria-label={`Download ${current.title}`}
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-fuchsia-200"
                  title="Download"
                >
                  <Download className="size-4" aria-hidden />
                </a>
              </div>
            </div>

            {/* Mobile condensed controls row (lyrics + download) */}
            <div className="flex items-center justify-end gap-1 border-t border-white/5 px-3 py-1.5 sm:hidden">
              <button
                type="button"
                onClick={() => setShowLyrics((s) => !s)}
                aria-label={showLyrics ? "Hide lyrics" : "Show lyrics"}
                aria-expanded={showLyrics}
                className={cn(
                  "grid size-8 place-items-center rounded-lg",
                  showLyrics ? "text-fuchsia-300" : "text-muted-foreground",
                )}
              >
                <ChevronUp
                  className={cn("size-4 transition-transform", showLyrics && "rotate-180")}
                  aria-hidden
                />
              </button>
              <a
                href={current.audioUrl}
                download={`${current.title}.${current.audioFormat || "mp3"}`}
                aria-label={`Download ${current.title}`}
                className="grid size-8 place-items-center rounded-lg text-muted-foreground"
              >
                <Download className="size-4" aria-hidden />
              </a>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
    </>
  );
}

/** Shared gradient cover-art component (deterministic hue from id). */
export function CoverArt({
  id,
  size = 48,
  playing,
  className,
}: {
  id: string;
  size?: number;
  playing?: boolean;
  className?: string;
}) {
  // Deterministic hue from id.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  const h2 = (h + 50) % 360;
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-white/10",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${h} 75% 55%), hsl(${h2} 75% 45%))`,
      }}
      aria-hidden
    >
      {playing ? (
        <EqualizerBars active barCount={4} className="h-4" />
      ) : (
        <Music2 className="text-white/80" style={{ width: size * 0.4, height: size * 0.4 }} />
      )}
    </span>
  );
}

export default BottomPlayer;
