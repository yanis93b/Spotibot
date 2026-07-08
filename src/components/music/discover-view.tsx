"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Compass,
  Flame,
  Loader2,
  Pause,
  Play,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";
import { CoverImage } from "./cover-image";

export interface DiscoverViewProps {
  /**
   * Play (or toggle play/pause) a track. The parent wires this to
   * `usePlayerStore.getState().playSong(song)` — `playSong` already toggles
   * when called on the currently-playing track.
   */
  onPlay: (song: Song) => void;
}

/**
 * Page size used for the infinite-scroll discover feed. Mirrors the default
 * `limit` on the server (see src/app/api/discover/route.ts). Keeping them in
 * sync means a fresh page never duplicates a track from the previous page.
 */
const PAGE_SIZE = 20;

/** Shape of the `/api/discover` response (mirrors `DiscoverResponse`). */
interface DiscoverPage {
  songs: Song[];
  total: number;
  page: number;
  limit: number;
}

/** Shape of the `/api/trending` response (mirrors `TrendingResponse`). */
interface TrendingResponse {
  songs: Song[];
}

/**
 * Discover page — the public, no-auth-required face of SpotiBot.
 *
 * Two sections:
 *   1. **Trending** — horizontal carousel of the most-liked public tracks
 *      created in the last 7 days (fetched once from `/api/trending`).
 *   2. **Discover feed** — infinite-scroll grid of every public track
 *      across all users, paginated via `/api/discover?page=N&limit=20`.
 *
 * Cards reuse the shared `<CoverImage/>` (gradient fallback + AI cover) and
 * show a play button on hover. Clicking a card (or its play button) hands
 * the song to the parent's `onPlay`, which drives the global player store.
 *
 * Dark theme, no indigo/blue — accent palette is fuchsia/rose.
 */
export function DiscoverView({ onPlay }: DiscoverViewProps) {
  return (
    <div className="space-y-10 pb-10">
      <Header />
      <TrendingSection onPlay={onPlay} />
      <DiscoverFeedSection onPlay={onPlay} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Header
// ───────────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="space-y-2">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-rose-500/20 ring-1 ring-fuchsia-400/30">
          <Compass className="size-5 text-fuchsia-200" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Discover
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        A public feed of tracks shared by every SpotiBot producer. Jump into
        the trending carousel, then scroll the feed to find your next
        obsession.
      </p>
    </header>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Trending carousel
// ───────────────────────────────────────────────────────────────────────────

function TrendingSection({ onPlay }: { onPlay: (song: Song) => void }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Horizontal scroller ref + arrow-button state.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/trending?limit=20", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: TrendingResponse = await res.json();
        if (!cancelled) setSongs(data.songs ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load trending");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Update the prev/next arrow enabled-state whenever the scroller moves or
  // the song list changes. Throttled via rAF so scroll events don't thrash.
  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
  }, [songs, updateArrows]);

  const scrollByCards = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Scroll by ~80% of the visible width — reveals a peek of the next batch
    // so users know there's more to scroll.
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section aria-label="Trending tracks" className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-orange-500/30 to-rose-500/20 ring-1 ring-orange-400/30">
            <Flame className="size-4 text-orange-200" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Trending this week
            </h2>
            <p className="text-xs text-muted-foreground">
              Most-liked public tracks from the last 7 days.
            </p>
          </div>
        </div>

        {/* Arrow buttons — hidden on touch (the user swipes instead). */}
        <div className="hidden gap-2 sm:flex">
          <ArrowButton
            direction="prev"
            disabled={!canNext || loading}
            onClick={() => scrollByCards(-1)}
          />
          <ArrowButton
            direction="next"
            disabled={!canNext || loading}
            onClick={() => scrollByCards(1)}
          />
        </div>
      </div>

      {error ? (
        <ErrorBanner message={error} />
      ) : loading ? (
        <TrendingSkeleton />
      ) : songs.length === 0 ? (
        <EmptyTrending />
      ) : (
        <div
          ref={scrollerRef}
          onScroll={updateArrows}
          className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.12)_transparent] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          {songs.map((song) => (
            <TrendingCard key={song.id} song={song} onPlay={onPlay} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendingCard({
  song,
  onPlay,
}: {
  song: Song;
  onPlay: (song: Song) => void;
}) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isCurrent = current?.id === song.id;
  const showPause = isCurrent && isPlaying;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="group/snap relative w-[260px] shrink-0 snap-start"
    >
      <button
        type="button"
        onClick={() => onPlay(song)}
        aria-label={`${showPause ? "Pause" : "Play"} ${song.title}`}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-xl ring-1 ring-white/10">
          <CoverImage
            id={song.id}
            src={song.coverUrl}
            alt={song.title}
            className="!h-full !w-full rounded-none"
            rounded="rounded-none"
            playing={showPause}
          />
          {/* Hover gradient + play button (Spotify-style) */}
          <div
            className={cn(
              "absolute inset-0 flex items-end justify-end p-3 transition-opacity",
              isCurrent ? "opacity-100" : "opacity-0 group-hover/snap:opacity-100",
            )}
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.55), transparent 55%)",
            }}
          >
            <span className="grid size-11 translate-y-1 place-items-center rounded-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/40 transition-all group-hover/snap:translate-y-0 group-hover/snap:scale-105 hover:bg-fuchsia-400">
              {showPause ? (
                <Pause className="size-5" fill="currentColor" aria-hidden />
              ) : (
                <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
              )}
            </span>
          </div>
        </div>

        <div className="mt-2.5 px-0.5">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              isCurrent ? "text-fuchsia-200" : "text-foreground",
            )}
            title={song.title}
          >
            {song.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {song.genre} · {song.mood}
          </p>
        </div>
      </button>
    </motion.div>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "Scroll left" : "Scroll right"}
      className="grid size-8 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-muted-foreground transition-colors hover:bg-white/[0.1] hover:text-foreground disabled:opacity-30 disabled:hover:bg-white/[0.04] disabled:hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function TrendingSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="w-[260px] shrink-0 space-y-2.5">
          <div className="aspect-square w-full animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

function EmptyTrending() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
      <Flame className="size-7 text-orange-300/60" aria-hidden />
      <p className="text-sm text-muted-foreground">
        No trending tracks yet this week.
      </p>
      <p className="text-xs text-muted-foreground/70">
        Like a public track to help it trend.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Discover feed (infinite-scroll grid)
// ───────────────────────────────────────────────────────────────────────────

function DiscoverFeedSection({ onPlay }: { onPlay: (song: Song) => void }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sentinel ref + observer for infinite scroll.
  const sentinelRef = useRef<HTMLDivElement>(null);

  const hasMore = songs.length < total;

  // ── Initial + next-page fetch.
  // One effect keyed on [page]: page 1 is the initial load, page > 1 is a
  // "load more" that appends. The `loading`/`loadingMore` split lets the UI
  // render skeletons for the first page and a small spinner at the bottom
  // for subsequent pages without clobbering the existing grid.
  useEffect(() => {
    if (page === 1) return; // page 1 is handled by the mount effect below.

    let cancelled = false;
    (async () => {
      setLoadingMore(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/discover?page=${page}&limit=${PAGE_SIZE}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: DiscoverPage = await res.json();
        if (cancelled) return;
        setSongs((cur) => {
          // De-dup by id in case the underlying order shifted between
          // fetches (a track was unpublished, pushing later tracks earlier).
          const seen = new Set(cur.map((s) => s.id));
          return [...cur, ...(data.songs ?? []).filter((s) => !seen.has(s.id))];
        });
        setTotal(data.total);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load more");
        }
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  // ── Mount: fetch the first page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/discover?page=1&limit=${PAGE_SIZE}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: DiscoverPage = await res.json();
        if (cancelled) return;
        setSongs(data.songs ?? []);
        setTotal(data.total);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load feed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Infinite scroll: observe the sentinel, advance the page when it
  // intersects AND we're not already loading AND there's more to load.
  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        // Guard against duplicate fetches: only advance when we're idle and
        // there's still more to load. The page-1 effect sets `loading`, the
        // page-N effect sets `loadingMore`; either blocks the next advance.
        if (loading || loadingMore || !hasMore) return;
        loadMore();
      },
      // Start loading 600px before the sentinel is actually visible so the
      // next page is ready by the time the user reaches the bottom.
      { rootMargin: "0px 0px 600px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, loading, loadingMore, hasMore]);

  return (
    <section aria-label="Public discover feed" className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10">
            <Sparkles className="size-4 text-fuchsia-200" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Fresh from the community
            </h2>
            <p className="text-xs text-muted-foreground">
              {total > 0
                ? `${total} public track${total === 1 ? "" : "s"} · newest first`
                : "Newest public tracks from every producer."}
            </p>
          </div>
        </div>
      </div>

      {error && songs.length === 0 ? (
        <ErrorBanner message={error} />
      ) : loading ? (
        <FeedSkeleton />
      ) : songs.length === 0 && !error ? (
        <EmptyFeed />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            <AnimatePresence initial={false}>
              {songs.map((song) => (
                <DiscoverCard key={song.id} song={song} onPlay={onPlay} />
              ))}
            </AnimatePresence>
          </div>

          {/* Sentinel + bottom status row */}
          <div ref={sentinelRef} className="h-px w-full" aria-hidden />

          <div className="flex min-h-9 items-center justify-center gap-2 text-xs text-muted-foreground">
            {loadingMore && (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                <span>Loading more…</span>
              </>
            )}
            {!loadingMore && !hasMore && songs.length > 0 && (
              <span>You&apos;ve reached the end of the feed.</span>
            )}
            {!loadingMore && error && songs.length > 0 && (
              <span className="text-rose-300">{error}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function DiscoverCard({
  song,
  onPlay,
}: {
  song: Song;
  onPlay: (song: Song) => void;
}) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isCurrent = current?.id === song.id;
  const showPause = isCurrent && isPlaying;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "group relative cursor-pointer rounded-xl border p-3 transition-colors",
        isCurrent
          ? "border-fuchsia-400/30 bg-fuchsia-500/[0.07]"
          : "border-white/[0.08] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
      )}
      onClick={() => onPlay(song)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(song);
        }
      }}
    >
      {/* Cover */}
      <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-lg">
        <CoverImage
          id={song.id}
          src={song.coverUrl}
          alt={song.title}
          className="!h-full !w-full rounded-none"
          rounded="rounded-none"
          playing={showPause}
        />
        <div
          className={cn(
            "absolute inset-0 flex items-end justify-end p-2.5 transition-opacity",
            isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.55), transparent 55%)",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(song);
            }}
            aria-label={`${showPause ? "Pause" : "Play"} ${song.title}`}
            className="grid size-10 translate-y-1 place-items-center rounded-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/40 transition-all group-hover:translate-y-0 group-hover:scale-105 hover:bg-fuchsia-400"
          >
            {showPause ? (
              <Pause className="size-5" fill="currentColor" aria-hidden />
            ) : (
              <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {/* Title + meta */}
      <p
        className={cn(
          "truncate text-sm font-semibold",
          isCurrent ? "text-fuchsia-200" : "text-foreground",
        )}
        title={song.title}
      >
        {song.title}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {song.genre} · {song.mood}
      </p>
    </motion.div>
  );
}

function FeedSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="space-y-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="aspect-square w-full animate-pulse rounded-lg bg-white/[0.06]" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

function EmptyFeed() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
      <Sparkles className="size-8 text-fuchsia-300/60" aria-hidden />
      <p className="text-sm text-muted-foreground">
        No public tracks yet.
      </p>
      <p className="text-xs text-muted-foreground/70">
        Be the first — share a track to the discover feed.
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
    >
      {message}
    </div>
  );
}

export default DiscoverView;
