"use client";

import { motion } from "framer-motion";
import { Heart, Download, Music2, Gauge, KeyRound, Clock3, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";
import { CoverImage } from "./cover-image";

export interface NowPlayingPanelProps {
  song: Song | null;
  onToggleLike: (id: string) => void;
}

/**
 * Spotify-style right-side "Now Playing" panel. Shows the large cover art,
 * track title, tags, musical attributes (BPM/key/time-sig/seed), a like +
 * download button, and the full lyrics in a scrollable area.
 *
 * Hidden on screens below xl (the bottom player + detail overlay cover those
 * cases on smaller screens).
 */
export function NowPlayingPanel({ song, onToggleLike }: NowPlayingPanelProps) {
  // Read playing state at the top so hooks are always called unconditionally.
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentId = usePlayerStore((s) => s.current?.id);

  if (!song) {
    return (
      <aside className="hidden w-[340px] shrink-0 flex-col rounded-lg border border-white/[0.06] bg-gradient-to-b from-[#1a1a22] to-[#0f0f15] p-4 xl:flex">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Now Playing
        </p>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
            <Music2 className="size-7 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">
            Select a track to see its cover, lyrics, and details here.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[340px] shrink-0 flex-col rounded-lg border border-white/[0.06] bg-gradient-to-b from-[#1a1a22] to-[#0f0f15] p-4 xl:flex">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Now Playing
      </p>

      <motion.div
        key={song.id}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-4"
      >
        {/* Cover */}
        <CoverImage
          id={song.id}
          src={song.coverUrl}
          alt={song.title}
          size={308}
          rounded="rounded-lg"
          className="w-full"
          playing={isPlaying && currentId === song.id}
        />

        {/* Title + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-foreground" title={song.title}>
              {song.title}
            </h3>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {song.genre} · {song.mood} · {song.style}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onToggleLike(song.id)}
            aria-label={song.liked ? `Unlike ${song.title}` : `Like ${song.title}`}
            aria-pressed={song.liked}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <Heart
              className={cn("size-5", song.liked && "fill-rose-500 text-rose-500")}
              aria-hidden
            />
          </button>
        </div>

        {/* Musical attributes (Spotify-style credit chips) */}
        <div className="flex flex-wrap gap-2">
          {song.bpm != null && (
            <AttrChip icon={<Gauge className="size-3" aria-hidden />} label={`${song.bpm} BPM`} />
          )}
          {song.keyScale && (
            <AttrChip icon={<KeyRound className="size-3" aria-hidden />} label={song.keyScale} />
          )}
          {song.timeSignature && (
            <AttrChip
              icon={<Clock3 className="size-3" aria-hidden />}
              label={timeSigLabel(song.timeSignature)}
            />
          )}
          {song.seed != null && (
            <AttrChip icon={<Hash className="size-3" aria-hidden />} label={`seed ${song.seed}`} />
          )}
          <AttrChip
            icon={<Music2 className="size-3" aria-hidden />}
            label={song.audioFormat?.toUpperCase() ?? "MP3"}
          />
        </div>

        {/* Download */}
        <a
          href={song.audioUrl}
          download={`${song.title}.${song.audioFormat || "mp3"}`}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-xs font-medium text-foreground/85 transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <Download className="size-3.5 text-fuchsia-300" aria-hidden />
          Download {song.audioFormat?.toUpperCase() ?? "MP3"}
        </a>

        {/* Prompt */}
        {song.prompt && (
          <div className="rounded-md border border-white/[0.06] bg-black/20 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Prompt
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{song.prompt}</p>
          </div>
        )}

        {/* Lyrics */}
        <div className="min-h-0 flex-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Lyrics
          </p>
          <div className="max-h-64 overflow-y-auto rounded-md border border-white/[0.06] bg-black/20 p-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground/75">
              {song.lyrics?.trim() || "No lyrics available."}
            </pre>
          </div>
        </div>
      </motion.div>
    </aside>
  );
}

/** Small attribute chip (BPM / key / time-sig / seed). */
function AttrChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

/** Map a time-signature code to a human label. */
function timeSigLabel(code: string): string {
  switch (code) {
    case "2":
      return "2/4";
    case "3":
      return "3/4";
    case "4":
      return "4/4";
    case "6":
      return "6/8";
    default:
      return code;
  }
}

export default NowPlayingPanel;
