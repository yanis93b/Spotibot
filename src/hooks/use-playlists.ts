"use client";

import { useCallback, useEffect, useState } from "react";
import type { Playlist, Song } from "@/lib/types";

export interface UsePlaylistsResult {
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  /** Create a new playlist. Returns the created playlist. */
  create: (name: string) => Promise<Playlist>;
  /** Rename a playlist. */
  rename: (id: string, name: string) => Promise<void>;
  /** Delete a playlist. */
  remove: (id: string) => Promise<void>;
  /** Add a song to a playlist (optimistic count bump). */
  addTrack: (playlistId: string, songId: string) => Promise<void>;
  /** Remove a song from a playlist. */
  removeTrack: (playlistId: string, songId: string) => Promise<void>;
  /** Fetch a single playlist with its tracks. */
  fetchPlaylist: (id: string) => Promise<{ playlist: Playlist; songs: Song[] } | null>;
  /** Replace the full list (after a refetch). */
  setPlaylists: (p: Playlist[]) => void;
}

/**
 * Client-state hook for playlists. Encapsulates the initial GET /api/playlists
 * fetch plus create/rename/delete/addTrack/removeTrack helpers.
 */
export function usePlaylists(): UsePlaylistsResult {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/playlists", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { playlists: Playlist[] };
        if (!cancelled) setPlaylists(data.playlists ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load playlists");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(async (name: string): Promise<Playlist> => {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error ?? `HTTP ${res.status}`);
    }
    const playlist = (await res.json()) as Playlist;
    setPlaylists((prev) => [playlist, ...prev]);
    return playlist;
  }, []);

  const rename = useCallback(async (id: string, name: string): Promise<void> => {
    const res = await fetch(`/api/playlists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = (await res.json()) as Playlist;
    setPlaylists((prev) => prev.map((p) => (p.id === id ? updated : p)));
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    const res = await fetch(`/api/playlists/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, []);

  const addTrack = useCallback(async (playlistId: string, songId: string): Promise<void> => {
    const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songId }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error ?? `HTTP ${res.status}`);
    }
    // Optimistically bump the trackCount on the client.
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId ? { ...p, trackCount: p.trackCount + 1 } : p,
      ),
    );
  }, []);

  const removeTrack = useCallback(async (playlistId: string, songId: string): Promise<void> => {
    const res = await fetch(
      `/api/playlists/${playlistId}/tracks?songId=${encodeURIComponent(songId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId ? { ...p, trackCount: Math.max(0, p.trackCount - 1) } : p,
      ),
    );
  }, []);

  const fetchPlaylist = useCallback(
    async (id: string): Promise<{ playlist: Playlist; songs: Song[] } | null> => {
      const res = await fetch(`/api/playlists/${id}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as Playlist & { songs: Song[] };
      const { songs, ...playlist } = data;
      return { playlist, songs };
    },
    [],
  );

  const setPlaylistsFn = useCallback((p: Playlist[]) => setPlaylists(p), []);

  return {
    playlists,
    loading,
    error,
    create,
    rename,
    remove: remove,
    addTrack,
    removeTrack,
    fetchPlaylist,
    setPlaylists: setPlaylistsFn,
  };
}

export default usePlaylists;
