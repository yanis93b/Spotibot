"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, Download, Play, Pause, Music2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";
import { CoverArt } from "./bottom-player";
import { LyricsPanel } from "./lyrics-panel";
import { EqualizerBars } from "./equalizer-bars";

export interface SongDetailProps {
  song: Song | null;
  onClose: () => void;
  onToggleLike: (id: string) => void;
}

/**
 * Full-screen detail overlay (Suno-style "now playing" expanded view). Shows
 * the cover, title, tags, prompt, full lyrics, and transport controls. Slides
 * up from the bottom when a song is selected from a card.
 */
export function SongDetail({ song, onClose, onToggleLike }: SongDetailProps) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playSong = usePlayerStore((s) => s.playSong);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  return (
    <AnimatePresence>
      {song && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`${song.title} details`}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card relative max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl sm:rounded-3xl"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
            >
              <X className="size-4" aria-hidden />
            </button>

            {/* Header: cover + title + tags */}
            <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:p-8">
              {/* Cover */}
              <div className="relative shrink-0">
                <CoverArt
                  id={song.id}
                  size={200}
                  className="!h-40 !w-40 rounded-2xl sm:!h-48 sm:!w-48"
                  playing={current?.id === song.id && isPlaying}
                />
                {/* Play overlay on cover */}
                <button
                  type="button"
                  onClick={() => {
                    if (current?.id === song.id) togglePlay();
                    else playSong(song);
                  }}
                  aria-label={current?.id === song.id && isPlaying ? "Pause" : "Play"}
                  className="absolute inset-0 grid place-items-center rounded-2xl bg-black/30 opacity-0 transition-opacity hover:opacity-100"
                >
                  <span className="grid size-14 place-items-center rounded-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/40">
                    {current?.id === song.id && isPlaying ? (
                      <Pause className="size-6" fill="currentColor" aria-hidden />
                    ) : (
                      <Play className="size-6 translate-x-0.5" fill="currentColor" aria-hidden />
                    )}
                  </span>
                </button>
              </div>

              {/* Title + tags + actions */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="mb-2 flex items-center gap-2">
                  {current?.id === song.id && isPlaying ? (
                    <EqualizerBars active barCount={4} className="h-4" />
                  ) : (
                    <Music2 className="size-4 text-fuchsia-300" aria-hidden />
                  )}
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-300/80">
                    {current?.id === song.id ? (isPlaying ? "Now Playing" : "Loaded") : "Track"}
                  </span>
                </div>
                <h2 className="gradient-text text-2xl font-bold leading-tight sm:text-3xl">
                  {song.title}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className="border-transparent bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/20">
                    {song.genre}
                  </Badge>
                  <Badge className="border-transparent bg-purple-500/15 text-purple-200 hover:bg-purple-500/20">
                    {song.mood}
                  </Badge>
                  <Badge className="border-transparent bg-rose-500/15 text-rose-200 hover:bg-rose-500/20">
                    {song.style}
                  </Badge>
                  {song.durationMs > 0 && (
                    <Badge
                      variant="outline"
                      className="border-white/10 bg-white/5 text-muted-foreground"
                    >
                      <Clock className="mr-1 size-3" aria-hidden />
                      {Math.floor(song.durationMs / 60000)}:
                      {Math.floor((song.durationMs % 60000) / 1000)
                        .toString()
                        .padStart(2, "0")}
                    </Badge>
                  )}
                </div>

                {song.prompt && (
                  <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground/70">Prompt: </span>
                    {song.prompt}
                  </p>
                )}

                {/* Action buttons */}
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (current?.id === song.id) togglePlay();
                      else playSong(song);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110"
                  >
                    {current?.id === song.id && isPlaying ? (
                      <>
                        <Pause className="size-4" fill="currentColor" aria-hidden /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="size-4" fill="currentColor" aria-hidden /> Play
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleLike(song.id)}
                    aria-pressed={song.liked}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-all",
                      song.liked
                        ? "border-rose-400/30 bg-rose-500/15 text-rose-200"
                        : "border-white/10 bg-white/5 text-foreground/85 hover:bg-white/10",
                    )}
                  >
                    <Heart
                      className={cn("size-4", song.liked && "fill-rose-400 text-rose-400")}
                      aria-hidden
                    />
                    {song.liked ? "Liked" : "Like"}
                  </button>
                  <a
                    href={song.audioUrl}
                    download={`${song.title}.${song.audioFormat || "mp3"}`}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-foreground/85 transition-all hover:bg-white/10"
                  >
                    <Download className="size-4 text-fuchsia-300" aria-hidden />
                    Download {song.audioFormat?.toUpperCase() || "MP3"}
                  </a>
                </div>
              </div>
            </div>

            {/* Lyrics */}
            <div className="border-t border-white/10 p-6 sm:p-8">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                Lyrics
              </h3>
              <LyricsPanel lyrics={song.lyrics} className="max-h-80" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SongDetail;
