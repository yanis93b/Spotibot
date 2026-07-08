"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, Play, Pause, Download, Trash2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";
import { EqualizerBars } from "./equalizer-bars";
import { CoverArt } from "./bottom-player";

export interface SongCardProps {
  song: Song;
  /** Open the lyrics / detail view for this song. */
  onShowDetails: (song: Song) => void;
  /** Toggle like. */
  onToggleLike: (id: string) => void;
  /** Delete (with confirm handled by parent). */
  onDelete: (id: string) => void;
}

/**
 * Suno-style song card: a square gradient cover with a hover play overlay,
 * the track title, genre/mood tags, relative timestamp, and a row of action
 * buttons (like, download, delete). Clicking the card opens the detail view.
 *
 * Play state is driven by the global player store — clicking play here loads
 * the song into the shared bottom player.
 */
export function SongCard({ song, onShowDetails, onToggleLike, onDelete }: SongCardProps) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playSong = usePlayerStore((s) => s.playSong);
  const [menuOpen, setMenuOpen] = useState(false);

  const isCurrent = current?.id === song.id;
  const showPause = isCurrent && isPlaying;

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    playSong(song);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      whileHover={{ y: -4 }}
      onClick={() => onShowDetails(song)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onShowDetails(song);
        }
      }}
      className={cn(
        "group relative cursor-pointer rounded-2xl border p-3 transition-colors",
        isCurrent
          ? "border-fuchsia-400/30 bg-fuchsia-500/[0.07]"
          : "border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
      )}
    >
      {/* Cover with hover overlay */}
      <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl">
        <CoverArt id={song.id} size={999} className="!h-full !w-full rounded-xl" playing={showPause} />

        {/* Darkening + play overlay on hover */}
        <div
          className={cn(
            "absolute inset-0 flex items-end justify-between p-3 transition-opacity",
            isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent 55%)" }}
        >
          <button
            type="button"
            onClick={handlePlayClick}
            aria-label={showPause ? `Pause ${song.title}` : `Play ${song.title}`}
            className="grid size-12 translate-y-2 place-items-center rounded-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/40 transition-all hover:scale-110 hover:bg-fuchsia-400 group-hover:translate-y-0"
          >
            {showPause ? (
              <Pause className="size-5" fill="currentColor" aria-hidden />
            ) : (
              <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
            )}
          </button>

          {/* Playing indicator (only when this card is the current track) */}
          {isCurrent && (
            <span className="mb-1.5 mr-1 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1 text-[10px] font-medium text-fuchsia-200 backdrop-blur-sm">
              <EqualizerBars active barCount={3} className="h-3" />
              {isPlaying ? "Playing" : "Paused"}
            </span>
          )}
        </div>
      </div>

      {/* Title + meta */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onShowDetails(song);
        }}
        className="block w-full text-left focus-visible:outline-none"
      >
        <p
          className={cn(
            "truncate text-sm font-semibold",
            isCurrent ? "text-fuchsia-100" : "text-foreground",
          )}
          title={song.title}
        >
          {song.title}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {song.genre} · {song.mood} · {song.style}
        </p>
      </button>

      {/* Action row */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLike(song.id);
          }}
          aria-label={song.liked ? `Unlike ${song.title}` : `Like ${song.title}`}
          aria-pressed={song.liked}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <Heart
            className={cn(
              "size-4 transition-all",
              song.liked ? "fill-rose-500 text-rose-500" : "text-muted-foreground hover:text-rose-300",
            )}
            aria-hidden
          />
        </button>

        <a
          href={song.audioUrl}
          onClick={(e) => e.stopPropagation()}
          download={`${song.title}.${song.audioFormat || "mp3"}`}
          aria-label={`Download ${song.title}`}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-fuchsia-200"
        >
          <Download className="size-4" aria-hidden />
        </a>

        {/* More menu (delete) */}
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute bottom-full right-0 z-20 mb-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#15151c] shadow-xl"
              role="menu"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete(song.id);
                }}
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-300 transition-colors hover:bg-rose-500/15"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete track
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default SongCard;
