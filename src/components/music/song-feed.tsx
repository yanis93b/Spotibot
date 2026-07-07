"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Library, Heart, Music2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Song } from "@/lib/types";
import { SongCard } from "./song-card";

export interface SongFeedProps {
  songs: Song[];
  loading: boolean;
  isGenerating: boolean;
  likedOnly: boolean;
  onShowDetails: (song: Song) => void;
  onToggleLike: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Responsive grid of song cards — the Library view body. Shows skeletons during
 * the initial load, a contextual empty state when there are no songs, and a
 * filtered grid otherwise. When `likedOnly` is on, only liked tracks render
 * (with their own empty state).
 */
export function SongFeed({
  songs,
  loading,
  isGenerating,
  likedOnly,
  onShowDetails,
  onToggleLike,
  onDelete,
}: SongFeedProps) {
  // Client-side sort by createdAt desc (safety net; API already sorts).
  const sorted = useMemo(
    () =>
      [...songs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [songs],
  );

  const filtered = likedOnly ? sorted.filter((s) => s.liked) : sorted;

  return (
    <section aria-label="Your tracks" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
            {likedOnly ? (
              <Heart className="size-4 fill-rose-400 text-rose-400" aria-hidden />
            ) : (
              <Library className="size-4 text-fuchsia-200" aria-hidden />
            )}
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {likedOnly ? "Liked Tracks" : "Your Tracks"}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "track" : "tracks"}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <FeedSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState likedOnly={likedOnly} isGenerating={isGenerating} />
      ) : (
        <motion.div
          layout
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                onShowDetails={onShowDetails}
                onToggleLike={onToggleLike}
                onDelete={onDelete}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}

/** Initial-load skeleton grid. */
function FeedSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/5 bg-white/[0.02] p-3"
        >
          <Skeleton className="mb-3 aspect-square w-full rounded-xl" />
          <Skeleton className="mb-2 h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Contextual empty state. */
function EmptyState({
  likedOnly,
  isGenerating,
}: {
  likedOnly: boolean;
  isGenerating: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500/20 to-purple-500/10 ring-1 ring-white/10">
        {likedOnly ? (
          <Heart className="size-7 text-rose-300" aria-hidden />
        ) : (
          <Music2 className="size-7 text-fuchsia-200" aria-hidden />
        )}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {likedOnly
            ? "No liked tracks yet"
            : isGenerating
              ? "Composing your first track…"
              : "No tracks yet"}
        </p>
        <p className="text-xs text-muted-foreground">
          {likedOnly
            ? "Tap the heart on any track to save it here."
            : isGenerating
              ? "Hang tight — the Ace Music model is rendering your song."
              : "Head to the Create tab to generate your first song."}
        </p>
      </div>
    </div>
  );
}

export default SongFeed;
