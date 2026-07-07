"use client";

import { useCallback, useEffect, useState } from "react";
import type { Song } from "@/lib/types";

export interface UseSongsResult {
  songs: Song[];
  loading: boolean;
  error: string | null;
  /** Optimistic prepend: the API call is the source of truth for revert. */
  prepend: (song: Song) => void;
  /** Optimistic remove; returns the removed song for rollback on error. */
  remove: (id: string) => Song | undefined;
  /** Restore a previously-removed song (e.g. when DELETE fails). */
  restore: (song: Song) => void;
  /** Optimistically toggle a song's liked flag by id. Returns the previous value for rollback. */
  toggleLike: (id: string) => boolean | undefined;
  /** Replace the full list (used after a refetch). */
  setSongs: (songs: Song[]) => void;
}

/**
 * Lightweight client-state hook for the song library. Encapsulates the
 * initial GET /api/songs fetch plus optimistic prepend/remove/toggleLike
 * helpers the page can use during generate / delete / like flows.
 *
 * Networking for create/delete/like is owned by the page (so it can drive
 * toast + generating state); this hook only manages the list itself.
 */
export function useSongs(): UseSongsResult {
  const [songs, setSongsState] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/songs", { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as { songs: Song[] };
        if (!cancelled) setSongsState(data.songs ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load songs");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const prepend = useCallback((song: Song) => {
    setSongsState((prev) => [song, ...prev.filter((s) => s.id !== song.id)]);
  }, []);

  const remove = useCallback((id: string): Song | undefined => {
    let removed: Song | undefined;
    setSongsState((prev) => {
      removed = prev.find((s) => s.id === id);
      return prev.filter((s) => s.id !== id);
    });
    return removed;
  }, []);

  const restore = useCallback((song: Song) => {
    setSongsState((prev) =>
      [song, ...prev.filter((s) => s.id !== song.id)].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    );
  }, []);

  const toggleLike = useCallback((id: string): boolean | undefined => {
    let prevLiked: boolean | undefined;
    setSongsState((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          prevLiked = s.liked;
          return { ...s, liked: !s.liked };
        }
        return s;
      }),
    );
    return prevLiked;
  }, []);

  const setSongs = useCallback((next: Song[]) => {
    setSongsState(next);
  }, []);

  return { songs, loading, error, prepend, remove, restore, toggleLike, setSongs };
}

export default useSongs;
