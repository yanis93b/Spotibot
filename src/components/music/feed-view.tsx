"use client";

/**
 * FeedView — Spotify-style "Following" feed.
 *
 * Renders the most recent tracks created by users the current user follows,
 * newest first, with infinite-scroll-style "Load more" pagination.
 *
 * Each track row shows:
 *   [cover] | title  · "by [owner name]"   | genre · mood   | play button
 *
 * The play button delegates to the parent via `onPlay(song)`. The current
 * track is highlighted (and shows Pause) by reading the global player store
 * — same pattern as `TrackList` and `SongCard`.
 *
 * Empty state: per spec — "You're not following anyone yet. Browse the
 * discover feed to find creators."
 *
 * The `FeedSong` type mirrors the server's `FeedSong` (Song + owner display
 * fields) and is duplicated here so the client bundle doesn't import the
 * server-only route file.
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Users2,
  Loader2,
  AlertCircle,
  Compass,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";
import { CoverImage } from "./cover-image";

/** A song in the feed response — `Song` + owner display info. */
export interface FeedSong extends Song {
  ownerId: string;
  ownerName: string | null;
  ownerImage: string | null;
}

/** Shape of the `/api/feed` response envelope (mirrors the server type). */
interface FeedResponse {
  songs: FeedSong[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface FeedViewProps {
  /** Called when the user clicks a track's play button. */
  onPlay: (song: Song) => void;
}

/** Page size for the feed (matches the server's default). */
const PAGE_SIZE = 20;

export function FeedView({ onPlay }: FeedViewProps) {
  const [songs, setSongs] = useState<FeedSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // ── Initial load ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/feed?page=1&limit=${PAGE_SIZE}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as FeedResponse;
        if (cancelled) return;
        setSongs(data.songs);
        setPage(1);
        setHasMore(data.hasMore);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load feed.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load more (next page appended to the list) ─────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const res = await fetch(
        `/api/feed?page=${nextPage}&limit=${PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as FeedResponse;
      setSongs((cur) => [...cur, ...data.songs]);
      setPage(nextPage);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more tracks.",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page]);

  return (
    <section aria-label="Following feed" className="space-y-5">
      {/* ── Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
            <Users2 className="size-4 text-fuchsia-200" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Following Feed
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Fresh tracks from creators you follow
            </p>
          </div>
        </div>
        {!loading && !error && songs.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {songs.length}
            {hasMore ? "+" : ""} track{songs.length === 1 ? "" : "s"}
          </span>
        )}
      </header>

      {/* ── Body */}
      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Couldn&apos;t load the feed.</p>
            <p className="mt-0.5 text-rose-200/80">{error}</p>
          </div>
        </div>
      ) : songs.length === 0 ? (
        <EmptyFeed />
      ) : (
        <>
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {songs.map((song, i) => (
                <FeedRow
                  key={song.id}
                  song={song}
                  index={i + 1}
                  onPlay={onPlay}
                />
              ))}
            </AnimatePresence>
          </ul>

          {/* ── Load more */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
              >
                {loadingMore && (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                )}
                {loadingMore ? "Loading…" : "Load more tracks"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** A single feed row — cover, title + owner, genre/mood, play button. */
function FeedRow({
  song,
  index,
  onPlay,
}: {
  song: FeedSong;
  index: number;
  onPlay: (song: Song) => void;
}) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const isCurrent = current?.id === song.id;
  const showPause = isCurrent && isPlaying;

  const handlePlay = () => {
    if (isCurrent) togglePlay();
    else onPlay(song);
  };

  const ownerLabel = song.ownerName?.trim() || "Unknown creator";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        "group grid grid-cols-[2rem_auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2 transition-colors sm:grid-cols-[2rem_auto_1fr_minmax(0,12rem)_2.5rem] sm:gap-4",
        isCurrent ? "bg-white/[0.08]" : "hover:bg-white/[0.05]",
      )}
    >
      {/* Index / play button */}
      <button
        type="button"
        onClick={handlePlay}
        aria-label={
          showPause ? `Pause ${song.title}` : `Play ${song.title} by ${ownerLabel}`
        }
        className="relative grid place-items-center text-right text-sm tabular-nums text-muted-foreground focus-visible:outline-none"
      >
        <span className={cn("group-hover:opacity-0", isCurrent && "opacity-0")}>
          {index}
        </span>
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

      {/* Cover */}
      <button
        type="button"
        onClick={handlePlay}
        aria-label={`Play ${song.title}`}
        className="relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
      >
        <CoverImage
          id={song.id}
          src={song.coverUrl}
          alt={song.title}
          size={44}
          playing={showPause}
        />
      </button>

      {/* Title + owner */}
      <button
        type="button"
        onClick={handlePlay}
        className="flex min-w-0 flex-col items-start text-left focus-visible:outline-none"
      >
        <span
          className={cn(
            "block w-full truncate text-sm font-medium",
            isCurrent ? "text-fuchsia-300" : "text-foreground",
          )}
          title={song.title}
        >
          {song.title}
        </span>
        <span
          className="mt-0.5 flex w-full items-center gap-1 truncate text-xs text-muted-foreground"
          title={`by ${ownerLabel}`}
        >
          <span className="text-muted-foreground/70">by</span>
          <span className="truncate font-medium text-muted-foreground">
            {ownerLabel}
          </span>
        </span>
      </button>

      {/* Genre · mood (hidden on the smallest screens to keep the row tidy) */}
      <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
        {song.genre} · {song.mood}
      </span>

      {/* Explicit play button (always visible; the row index/cover also play) */}
      <button
        type="button"
        onClick={handlePlay}
        aria-label={
          showPause ? `Pause ${song.title}` : `Play ${song.title}`
        }
        className={cn(
          "grid size-9 place-items-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400",
          showPause
            ? "bg-fuchsia-500 text-white hover:bg-fuchsia-400"
            : "bg-white/[0.06] text-foreground/80 opacity-0 hover:bg-fuchsia-500 hover:text-white group-hover:opacity-100",
        )}
      >
        {showPause ? (
          <Pause className="size-4" fill="currentColor" aria-hidden />
        ) : (
          <Play className="size-4 translate-x-0.5" fill="currentColor" aria-hidden />
        )}
      </button>
    </motion.li>
  );
}

/** Initial-load skeleton (matches the row layout). */
function FeedSkeleton() {
  return (
    <ul className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2 sm:grid-cols-[2rem_auto_1fr_minmax(0,12rem)_2.5rem] sm:gap-4"
        >
          <div className="ml-auto h-3 w-3 animate-pulse rounded bg-white/10" />
          <div className="size-11 animate-pulse rounded-md bg-white/10" />
          <div className="space-y-1.5">
            <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-white/10" />
          </div>
          <div className="hidden h-3 w-20 animate-pulse rounded bg-white/10 sm:block" />
        </li>
      ))}
    </ul>
  );
}

/** Empty-state placeholder (spec text). */
function EmptyFeed() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500/20 to-purple-500/10 ring-1 ring-white/10">
        <Sparkles className="size-7 text-fuchsia-200" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          You&apos;re not following anyone yet.
        </p>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          You&apos;re not following anyone yet. Browse the discover feed to find
          creators.
        </p>
      </div>
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-muted-foreground">
        <Compass className="size-3" aria-hidden />
        Try the Browse tab
      </span>
    </div>
  );
}

export default FeedView;
