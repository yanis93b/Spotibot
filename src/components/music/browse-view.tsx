"use client";

import { useEffect, useMemo, useState } from "react";
import { Music2, Sparkles, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { GENRES, MOODS, type Playlist, type Song } from "@/lib/types";
import { TrackList } from "./track-list";

/**
 * Shape of a single genre bucket returned by `GET /api/browse` (no params).
 * Mirrors the server-side `GenreBucket` in `route.ts` — duplicated here so the
 * client doesn't need to know about server types.
 */
interface GenreBucket {
  genre: string;
  count: number;
  songs: Song[];
}

export interface BrowseViewProps {
  /** Toggle the liked flag on a song (passed through to TrackList). */
  onToggleLike: (id: string) => void;
  /** Delete a song (passed through to TrackList). */
  onDelete: (id: string) => void;
  /** Playlists the user can add a track to (passed through to TrackList). */
  playlists?: Playlist[];
  /** Add a song to a playlist (passed through to TrackList). */
  onAddToPlaylist?: (playlistId: string, songId: string) => Promise<void>;
  /** Open the create-playlist dialog (passed through to TrackList). */
  onCreatePlaylist?: () => void;
}

/**
 * Deterministic hue (0–360) from a string so each genre keeps a stable,
 * distinct color across reloads. Same hashing scheme as `cover-image.tsx`.
 */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/**
 * Spotify-style Browse / Discover view.
 *
 * Layout:
 *   1. Genre grid — 10 colorful gradient tiles, one per genre, click to filter.
 *   2. Mood chips — "All" + 8 moods, click to refine the filtered results.
 *   3. Track list — reuses the existing `<TrackList/>` to render results.
 *
 * Data flow:
 *   - On mount, fetches `GET /api/browse` (no params) → top 4 songs per genre
 *     + per-genre counts. Used to populate the tile counts and the initial
 *     "Featured" track list (flattened previews).
 *   - When a genre tile is clicked: fetches `GET /api/browse?genre=X` (plus
 *     the current mood if any) and shows the full result set in TrackList.
 *   - When a mood chip is clicked: if a genre is selected, refetches with the
 *     mood param; otherwise client-filters the cached previews by mood.
 *   - Clicking the active genre tile again deselects it (toggle behavior).
 */
export function BrowseView({
  onToggleLike,
  onDelete,
  playlists,
  onAddToPlaylist,
  onCreatePlaylist,
}: BrowseViewProps) {
  const [genres, setGenres] = useState<GenreBucket[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Single effect that handles every (genre, mood) combination.
   *
   * Why one effect (not two): mount + filter changes are the same logical
   * operation — "produce the songs for the current selection" — and folding
   * them together avoids the race where two effects fight over `loading`.
   *
   * `genres` is in the dep array on purpose: when the initial aggregate fetch
   * resolves and writes `genres`, the effect re-runs and seeds `songs` from
   * the cached previews without another network round-trip.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);

      // ── No genre selected → use the cached genre buckets (client-side).
      if (!selectedGenre) {
        if (genres.length === 0) {
          // First mount: fetch the aggregated buckets.
          setLoading(true);
          try {
            const res = await fetch("/api/browse", { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: { genres: GenreBucket[] } = await res.json();
            if (cancelled) return;
            const buckets = data.genres ?? [];
            setGenres(buckets);
            const flat = buckets.flatMap((g) => g.songs);
            setSongs(
              selectedMood ? flat.filter((s) => s.mood === selectedMood) : flat,
            );
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : "Failed to load");
            }
          } finally {
            if (!cancelled) setLoading(false);
          }
        } else {
          // Buckets already loaded — just client-filter the previews by mood.
          const flat = genres.flatMap((g) => g.songs);
          setSongs(
            selectedMood ? flat.filter((s) => s.mood === selectedMood) : flat,
          );
        }
        return;
      }

      // ── Genre selected → fetch filtered songs from the API.
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("genre", selectedGenre);
        if (selectedMood) params.set("mood", selectedMood);
        const res = await fetch(`/api/browse?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { songs: Song[] } = await res.json();
        if (cancelled) return;
        setSongs(data.songs ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
        setSongs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGenre, selectedMood, genres]);

  /** Toggle the genre filter (clicking the active tile clears it). */
  const handleGenreClick = (genre: string) => {
    setSelectedGenre((cur) => (cur === genre ? null : genre));
  };

  /** Set the mood filter (null = "All"). */
  const handleMoodClick = (mood: string | null) => {
    setSelectedMood(mood);
  };

  /** Clear all filters. */
  const handleReset = () => {
    setSelectedGenre(null);
    setSelectedMood(null);
  };

  // Count per genre for the tiles (0 when the bucket hasn't loaded yet).
  const countByGenre = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of genres) m.set(g.genre, g.count);
    return m;
  }, [genres]);

  const filtersActive = selectedGenre !== null || selectedMood !== null;

  // Dynamic heading based on the current selection.
  const heading = selectedGenre
    ? `${selectedGenre}${selectedMood ? ` · ${selectedMood}` : ""}`
    : selectedMood
      ? `${selectedMood} tracks`
      : "Featured";

  return (
    <div className="space-y-8 pb-6">
      {/* ── Header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Browse
        </h1>
        <p className="text-sm text-muted-foreground">
          Explore your library by genre and mood. Click a tile to filter, then
          refine with a mood chip.
        </p>
      </header>

      {/* ── Genre grid */}
      <section aria-label="Genres" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Genres
          </h2>
          {filtersActive && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              <RotateCcw className="size-3" aria-hidden />
              Reset filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {GENRES.map((genre) => {
            const hue = hueFromString(genre);
            const hue2 = (hue + 40) % 360;
            const count = countByGenre.get(genre) ?? 0;
            const isActive = selectedGenre === genre;
            return (
              <button
                key={genre}
                type="button"
                onClick={() => handleGenreClick(genre)}
                aria-pressed={isActive}
                aria-label={`Filter by ${genre}${
                  count > 0 ? `, ${count} track${count === 1 ? "" : "s"}` : ""
                }`}
                className={cn(
                  "group relative aspect-[16/10] overflow-hidden rounded-lg p-4 text-left ring-1 ring-inset transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400",
                  isActive ? "ring-2 ring-fuchsia-400" : "ring-white/10",
                )}
                style={{
                  // Deterministic two-stop gradient per genre name.
                  background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${hue2} 75% 32%))`,
                }}
              >
                {/* Decorative music glyph in the corner, dims on hover for depth. */}
                <span className="pointer-events-none absolute -right-2 -top-2 rotate-12 opacity-25 transition-opacity group-hover:opacity-40">
                  <Music2 className="size-16 text-white" aria-hidden />
                </span>
                <span className="relative z-10 flex h-full flex-col justify-between">
                  <span className="text-base font-bold text-white drop-shadow-sm sm:text-lg">
                    {genre}
                  </span>
                  <span className="text-xs font-medium text-white/80">
                    {count === 0
                      ? "No tracks"
                      : `${count} track${count === 1 ? "" : "s"}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Mood chips */}
      <section aria-label="Filter by mood" className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Mood
        </h2>
        <div className="flex flex-wrap gap-2">
          <MoodChip
            label="All"
            active={selectedMood === null}
            onClick={() => handleMoodClick(null)}
          />
          {MOODS.map((mood) => (
            <MoodChip
              key={mood}
              label={mood}
              active={selectedMood === mood}
              onClick={() => handleMoodClick(mood)}
            />
          ))}
        </div>
      </section>

      {/* ── Filtered track list */}
      <section aria-label="Filtered tracks" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {heading}
          </h2>
          {!loading && !error && (
            <span className="text-xs text-muted-foreground">
              {songs.length} track{songs.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
          >
            {error}
          </div>
        ) : !loading && songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-10 text-center">
            <Sparkles className="size-7 text-fuchsia-300/70" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No tracks match these filters yet.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Try generating a song in this genre, or pick a different mood.
            </p>
          </div>
        ) : (
          <TrackList
            songs={songs}
            loading={loading}
            onToggleLike={onToggleLike}
            onDelete={onDelete}
            playlists={playlists}
            onAddToPlaylist={onAddToPlaylist}
            onCreatePlaylist={onCreatePlaylist}
          />
        )}
      </section>
    </div>
  );
}

/** Small reusable pill used for the mood filter row. */
function MoodChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400",
        active
          ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100"
          : "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export default BrowseView;
