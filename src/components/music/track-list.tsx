"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Play, Pause, Clock, MoreHorizontal, Trash2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";
import { CoverImage } from "./cover-image";

export interface TrackListProps {
  songs: Song[];
  loading: boolean;
  onToggleLike: (id: string) => void;
  onDelete: (id: string) => void;
  /** Optional title for the section (e.g. "All Tracks"). */
  title?: string;
  /** Show the full table header (Spotify-style). Default true. */
  showHeader?: boolean;
}

/** Format ms → m:ss. */
function fmt(ms: number): string {
  const s = Math.floor((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

/**
 * Spotify-style track list table: #, cover+title+tags, album (genre/mood),
 * liked heart, duration, and a hover-revealed more menu (delete/download).
 *
 * Play state is driven by the global player store — clicking the row or the
 * index play button loads the track into the shared bottom player.
 */
export function TrackList({
  songs,
  loading,
  onToggleLike,
  onDelete,
  title,
  showHeader = true,
}: TrackListProps) {
  const sorted = useMemo(
    () =>
      [...songs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [songs],
  );

  return (
    <section aria-label={title ?? "Tracks"} className="space-y-2">
      {showHeader && (
        <div className="grid grid-cols-[2rem_1fr_auto] items-center gap-4 border-b border-white/[0.06] px-4 pb-2 text-xs uppercase tracking-wider text-muted-foreground sm:grid-cols-[2rem_1fr_minmax(0,180px)_3rem_3rem]">
          <span className="text-right">#</span>
          <span>Title</span>
          <span className="hidden sm:block">Album</span>
          <span className="hidden sm:block text-center">
            <Heart className="mx-auto size-3.5" aria-hidden />
          </span>
          <span className="text-right">
            <Clock className="ml-auto size-3.5" aria-hidden />
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[2rem_1fr_auto] items-center gap-4 rounded-md px-4 py-2 sm:grid-cols-[2rem_1fr_minmax(0,180px)_3rem_3rem]"
            >
              <div className="h-3 w-3 animate-pulse rounded bg-white/10" />
              <div className="flex items-center gap-3">
                <div className="size-10 animate-pulse rounded bg-white/10" />
                <div className="space-y-1.5">
                  <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
                  <div className="h-2.5 w-20 animate-pulse rounded bg-white/10" />
                </div>
              </div>
              <div className="hidden h-3 w-24 animate-pulse rounded bg-white/10 sm:block" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? null : (
        <ul className="space-y-0.5">
          <AnimatePresence initial={false}>
            {sorted.map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                index={i + 1}
                onToggleLike={onToggleLike}
                onDelete={onDelete}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function TrackRow({
  song,
  index,
  onToggleLike,
  onDelete,
}: {
  song: Song;
  index: number;
  onToggleLike: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playSong = usePlayerStore((s) => s.playSong);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const [menuOpen, setMenuOpen] = useState(false);

  const isCurrent = current?.id === song.id;
  const showPause = isCurrent && isPlaying;

  const handlePlay = () => {
    if (isCurrent) togglePlay();
    else playSong(song);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        "group grid grid-cols-[2rem_1fr_auto] items-center gap-4 rounded-md px-4 py-2 transition-colors sm:grid-cols-[2rem_1fr_minmax(0,180px)_3rem_3rem]",
        isCurrent ? "bg-white/[0.08]" : "hover:bg-white/[0.06]",
      )}
      onDoubleClick={handlePlay}
    >
      {/* # / play button */}
      <button
        type="button"
        onClick={handlePlay}
        aria-label={showPause ? `Pause ${song.title}` : `Play ${song.title}`}
        className="relative grid place-items-center text-right text-sm tabular-nums text-muted-foreground"
      >
        <span className={cn("group-hover:opacity-0", isCurrent && "opacity-0")}>{index}</span>
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          {showPause ? (
            <Pause className="size-4 text-white" fill="currentColor" aria-hidden />
          ) : (
            <Play className="size-4 text-white" fill="currentColor" aria-hidden />
          )}
        </span>
        {isCurrent && !showPause && (
          <span className="absolute inset-0 grid place-items-center">
            <Pause className="size-4 text-fuchsia-400" aria-hidden />
          </span>
        )}
      </button>

      {/* Title + cover */}
      <button
        type="button"
        onClick={handlePlay}
        className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none"
      >
        <CoverImage
          id={song.id}
          src={song.coverUrl}
          alt={song.title}
          size={40}
          playing={showPause}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium",
              isCurrent ? "text-fuchsia-300" : "text-foreground",
            )}
          >
            {song.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {song.genre} · {song.mood} · {song.style}
          </span>
        </span>
      </button>

      {/* Album (genre/mood tag) */}
      <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
        {song.genre} {song.bpm ? `· ${song.bpm} BPM` : ""}
      </span>

      {/* Like */}
      <button
        type="button"
        onClick={() => onToggleLike(song.id)}
        aria-label={song.liked ? `Unlike ${song.title}` : `Like ${song.title}`}
        aria-pressed={song.liked}
        className={cn(
          "hidden place-items-center sm:grid",
          song.liked
            ? "text-rose-400 opacity-100"
            : "text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground",
        )}
      >
        <Heart className={cn("size-4", song.liked && "fill-rose-400")} aria-hidden />
      </button>

      {/* Duration + more menu */}
      <div className="relative flex items-center justify-end gap-2 text-right text-sm tabular-nums text-muted-foreground">
        <a
          href={song.audioUrl}
          onClick={(e) => e.stopPropagation()}
          download={`${song.title}.${song.audioFormat || "mp3"}`}
          aria-label={`Download ${song.title}`}
          className="hidden place-items-center opacity-0 transition-opacity hover:text-fuchsia-200 group-hover:opacity-100 sm:grid"
        >
          <Download className="size-4" aria-hidden />
        </a>
        <span>{fmt(song.durationMs)}</span>
        <button
          type="button"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          className="grid place-items-center rounded opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute bottom-full right-0 z-20 mb-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#1a1a22] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDelete(song.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-300 transition-colors hover:bg-rose-500/15"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </button>
          </div>
        )}
      </div>
    </motion.li>
  );
}

export default TrackList;
