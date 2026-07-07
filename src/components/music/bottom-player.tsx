"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Heart,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  Repeat2,
  Shuffle,
  ListMusic,
  Maximize2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/lib/player-store";
import type { Song } from "@/lib/types";
import { CoverImage } from "./cover-image";

/** Format seconds as m:ss. */
function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

export interface BottomPlayerProps {
  onToggleLike: (songId: string) => void;
  /** Play the next track in the library (optional queue). */
  onNext?: () => void;
  /** Play the previous track. */
  onPrev?: () => void;
}

/**
 * Spotify-style sticky bottom player bar with three sections:
 *  - LEFT  : cover + title + tags + like
 *  - CENTER: transport (shuffle, prev, play/pause, next, repeat) + seek bar
 *  - RIGHT : queue toggle, volume, download, fullscreen
 *
 * Owns the single shared `<audio>` element and wires its events to the global
 * player store so every play control in the app drives this one instance.
 */
export function BottomPlayer({ onToggleLike, onNext, onPrev }: BottomPlayerProps) {
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

  useEffect(() => {
    registerAudio(audioRef.current);
    return () => registerAudio(null);
  }, [registerAudio]);

  const hasTrack = Boolean(current);
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onDurationChange={(e) => onDurationChange(e.currentTarget.duration || 0)}
        onLoadedMetadata={(e) => onDurationChange(e.currentTarget.duration || 0)}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={() => {
          onEnded();
          if (onNext) onNext();
        }}
        className="hidden"
      >
        <track kind="captions" />
      </audio>

      <AnimatePresence>
        {hasTrack && current && (
          <motion.footer
            initial={{ y: 90 }}
            animate={{ y: 0 }}
            exit={{ y: 90 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="sticky bottom-0 z-40 h-[88px] border-t border-white/[0.06] bg-[#050507] px-4 py-3"
            role="region"
            aria-label="Player"
          >
            <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4">
              {/* ── LEFT: cover + title + like ───────────────────────────── */}
              <div className="flex min-w-0 flex-1 items-center gap-3 sm:basis-[30%]">
                <CoverImage
                  id={current.id}
                  src={current.coverUrl}
                  alt={current.title}
                  size={56}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground" title={current.title}>
                    {current.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {current.genre} · {current.mood}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleLike(current.id)}
                  aria-label={current.liked ? "Unlike" : "Like"}
                  aria-pressed={current.liked}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Heart
                    className={cn("size-4", current.liked && "fill-rose-500 text-rose-500")}
                    aria-hidden
                  />
                </button>
              </div>

              {/* ── CENTER: transport + seek ─────────────────────────────── */}
              <div className="flex flex-1 flex-col items-center gap-1.5 sm:basis-[40%]">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    aria-label="Shuffle"
                    className="hidden text-muted-foreground transition-colors hover:text-foreground sm:grid"
                  >
                    <Shuffle className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={onPrev}
                    aria-label="Previous"
                    disabled={!onPrev}
                    className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <SkipBack className="size-5" fill="currentColor" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    className="grid size-9 place-items-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
                  >
                    {isPlaying ? (
                      <Pause className="size-4" fill="currentColor" aria-hidden />
                    ) : (
                      <Play className="size-4 translate-x-0.5" fill="currentColor" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    aria-label="Next"
                    disabled={!onNext}
                    className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  >
                    <SkipForward className="size-5" fill="currentColor" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Repeat"
                    className="hidden text-muted-foreground transition-colors hover:text-foreground sm:grid"
                  >
                    <Repeat2 className="size-4" aria-hidden />
                  </button>
                </div>
                <div className="flex w-full items-center gap-2">
                  <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                    {fmt(currentTime)}
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
                    className="flex-1 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-track]]:bg-white/20 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-white"
                  />
                  <span className="w-10 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {fmt(duration)}
                  </span>
                </div>
              </div>

              {/* ── RIGHT: queue, volume, download, fullscreen ───────────── */}
              <div className="hidden items-center justify-end gap-1 sm:flex sm:basis-[30%]">
                <a
                  href={current.audioUrl}
                  download={`${current.title}.${current.audioFormat || "mp3"}`}
                  aria-label={`Download ${current.title}`}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-fuchsia-200"
                  title="Download"
                >
                  <Download className="size-4" aria-hidden />
                </a>
                <button
                  type="button"
                  aria-label="Queue"
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ListMusic className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                >
                  <VolumeIcon className="size-4" aria-hidden />
                </button>
                <Slider
                  value={[muted ? 0 : volume]}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => setVolume(v[0] ?? 1)}
                  aria-label="Volume"
                  className="w-24 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-track]]:bg-white/20 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-white"
                />
                <button
                  type="button"
                  aria-label="Fullscreen"
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Maximize2 className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
    </>
  );
}

export default BottomPlayer;
