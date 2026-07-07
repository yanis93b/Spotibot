"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  Library,
  Play,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { EqualizerBars } from "./equalizer-bars";

export interface SongHistoryProps {
  songs: Song[];
  /** Id of the song currently loaded in the player (for highlight + EQ). */
  currentId: string | null;
  /** Whether the song matching `currentId` is actively playing. */
  isCurrentPlaying?: boolean;
  /** Initial-load skeleton flag (distinct from "list is empty"). */
  loading: boolean;
  /** Loading a fresh generation (suppresses empty state copy). */
  isGenerating?: boolean;
  onSelect: (song: Song) => void;
  onDelete: (id: string) => Promise<void>;
}

/** Deterministic hue (0–360) for a song's gradient cover, derived from id. */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 360;
  }
  return h;
}

/**
 * Library list panel. Shows skeletons during initial load, an empty hint
 * when there are no songs, and a scrollable list of compact song rows
 * otherwise. Each row has a deterministic gradient cover, title, meta
 * subtitle, relative timestamp, play/pause toggle, and a confirm-before-delete
 * trash action.
 */
export function SongHistory({
  songs,
  currentId,
  isCurrentPlaying = false,
  loading,
  isGenerating = false,
  onSelect,
  onDelete,
}: SongHistoryProps) {
  // Client-side sort by createdAt desc as a safety net (API already sorts).
  const sorted = useMemo(
    () =>
      [...songs].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [songs],
  );

  return (
    <section
      aria-label="Your song library"
      className="glass-card flex h-full flex-col p-5 sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
            <Library className="size-4 text-fuchsia-200" aria-hidden />
          </span>
          <h2 className="text-base font-semibold text-foreground">
            Your Library
          </h2>
        </div>
        <Badge
          variant="outline"
          className="border-white/10 bg-white/5 text-[11px] tabular-nums text-muted-foreground"
        >
          {sorted.length} {sorted.length === 1 ? "track" : "tracks"}
        </Badge>
      </div>

      <div className="-mr-2 flex-1 overflow-y-auto pr-2">
        {loading ? (
          <HistorySkeleton />
        ) : sorted.length === 0 ? (
          <EmptyLibrary isGenerating={isGenerating} />
        ) : (
          <ul className="flex flex-col gap-2 pb-1">
            {sorted.map((song, i) => (
              <SongRow
                key={song.id}
                song={song}
                index={i + 1}
                isCurrent={song.id === currentId}
                isCurrentPlaying={song.id === currentId && isCurrentPlaying}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Initial-load skeleton list. */
function HistorySkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3"
        >
          <Skeleton className="size-11 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="size-8 rounded-md" />
        </li>
      ))}
    </ul>
  );
}

/** Empty library hint. */
function EmptyLibrary({ isGenerating }: { isGenerating: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">
        {isGenerating
          ? "Your first track is being composed…"
          : "No songs yet — generate your first track!"}
      </p>
    </div>
  );
}

interface SongRowProps {
  song: Song;
  index: number;
  isCurrent: boolean;
  isCurrentPlaying: boolean;
  onSelect: (song: Song) => void;
  onDelete: (id: string) => Promise<void>;
}

function SongRow({
  song,
  index,
  isCurrent,
  isCurrentPlaying,
  onSelect,
  onDelete,
}: SongRowProps) {
  const [deleting, setDeleting] = useState(false);

  // Two-stop hue pair so each song gets a unique-feeling gradient cover.
  const hue = useMemo(() => hueFromId(song.id), [song.id]);
  const hueB = (hue + 60) % 360;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(song.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border p-3 transition-all",
        isCurrent
          ? "border-fuchsia-400/30 bg-fuchsia-500/[0.08]"
          : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.05]",
      )}
    >
      {/* Cover */}
      <button
        type="button"
        onClick={() => onSelect(song)}
        aria-label={`Play ${song.title}`}
        className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-white/10 transition-transform hover:scale-105 focus-visible:outline-none"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 80% 55%), hsl(${hueB} 80% 50%))`,
        }}
      >
        {isCurrent && isCurrentPlaying ? (
          <EqualizerBars active barCount={3} className="h-4" />
        ) : (
          <span className="flex items-center gap-0.5 text-white/90">
            <Play className="size-4 translate-x-0.5" fill="currentColor" aria-hidden />
          </span>
        )}
        <span className="sr-only">{index}</span>
      </button>

      {/* Meta */}
      <button
        type="button"
        onClick={() => onSelect(song)}
        className="min-w-0 flex-1 text-left focus-visible:outline-none"
      >
        <p
          className={cn(
            "truncate text-sm font-medium",
            isCurrent ? "text-fuchsia-100" : "text-foreground/90",
          )}
          title={song.title}
        >
          {song.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">
            {song.genre} · {song.mood}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">
            {formatDistanceToNow(new Date(song.createdAt), { addSuffix: true })}
          </span>
        </p>
      </button>

      {/* Delete with confirm */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={deleting}
            aria-label={`Delete ${song.title}`}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-all hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-50"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="border-white/10 bg-[#15151c]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this track?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{song.title}&rdquo; will be permanently removed from your
              library. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-foreground/80 hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white hover:from-rose-400 hover:to-fuchsia-400"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.li>
  );
}

export default SongHistory;
