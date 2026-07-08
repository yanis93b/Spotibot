"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePlayerStore } from "@/lib/player-store";
import type { Song } from "@/lib/types";

/**
 * useRadio — Spotify-style "Radio / Autoplay" feature.
 *
 * When enabled, watches the global player store for track-end events and
 * automatically plays a similar track (same `genre`) from the user's library.
 *
 * Detection strategy
 * ------------------
 * `onEnded()` in the player store is the unique signal we care about: it
 * flips `isPlaying` from true→false AND resets `currentTime` to 0 while
 * keeping the same `current` song. Neither a manual pause (which keeps
 * currentTime) nor a load/play of a *different* song (which changes the
 * current id) match that signature, so we can reliably tell a real "track
 * ended" transition apart from other state changes by subscribing to the
 * store and inspecting the prev→next delta.
 *
 * Persistence
 * ------------
 * `radioEnabled` is mirrored to localStorage under `spotibot-radio` so the
 * user's preference survives reloads. The flag is read via
 * `useSyncExternalStore` so the UI stays in sync across tabs (the `storage`
 * event) and across toggles within this tab (a custom event).
 */

const STORAGE_KEY = "spotibot-radio";

/** Custom event fired when radio is toggled WITHIN this tab. The native
 *  `storage` event only fires across other tabs/windows, so we dispatch
 *  this so the local useSyncExternalStore subscription re-reads after the
 *  user clicks the toggle (mirrors the theme-toggle pattern). */
const RADIO_CHANGE_EVENT = "spotibot:radio-change";

/** Module-level cache for the user's library — populated on first ended
 *  event and reused for subsequent ones. Reset to null only on tab reload. */
let libraryCache: Song[] | null = null;

async function fetchLibrary(): Promise<Song[]> {
  if (libraryCache) return libraryCache;
  try {
    const res = await fetch("/api/songs", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { songs: Song[] };
    libraryCache = Array.isArray(data.songs) ? data.songs : [];
    return libraryCache;
  } catch {
    return [];
  }
}

// ── useSyncExternalStore plumbing for the persisted flag ────────────────
function subscribeRadio(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener(RADIO_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(RADIO_CHANGE_EVENT, handler);
  };
}

function getRadioSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Server snapshot must match the first client snapshot to avoid hydration
 *  mismatches; both return false (radio off by default on SSR + first paint). */
function getRadioServerSnapshot(): boolean {
  return false;
}

function writeRadio(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Ignore write failures (private mode, quota, etc.).
  }
  window.dispatchEvent(new Event(RADIO_CHANGE_EVENT));
}

/**
 * Pick & play the next radio track.
 *
 * 1. Fetch the user's library (cached on first call).
 * 2. Filter to same-genre tracks that aren't the current one.
 * 3. Fall back to any other track if no same-genre match exists.
 * 4. Pick a random candidate and load it via the player store.
 *
 * Bails out silently if the user has manually moved to a different track
 * while the (async) fetch was in flight — never hijacks an explicit action.
 */
async function autoplayNext(current: Song | null): Promise<void> {
  if (!current) return;
  const library = await fetchLibrary();

  // The fetch may have taken a moment; if the user skipped/loaded something
  // else in the meantime, do nothing.
  if (usePlayerStore.getState().current?.id !== current.id) return;
  if (library.length === 0) return;

  const sameGenre = library.filter(
    (s) => s.genre === current.genre && s.id !== current.id,
  );
  const pool =
    sameGenre.length > 0
      ? sameGenre
      : library.filter((s) => s.id !== current.id);

  if (pool.length === 0) return;
  const next = pool[Math.floor(Math.random() * pool.length)];
  usePlayerStore.getState().playSong(next);
}

export interface UseRadioResult {
  /** Whether radio/autoplay is currently enabled. */
  radioEnabled: boolean;
  /** Flip the radioEnabled flag (and persist it). */
  toggleRadio: () => void;
}

export function useRadio(): UseRadioResult {
  const radioEnabled = useSyncExternalStore(
    subscribeRadio,
    getRadioSnapshot,
    getRadioServerSnapshot,
  );

  const toggleRadio = useCallback(() => {
    writeRadio(!getRadioSnapshot());
  }, []);

  // Subscribe to the player store ONLY while radio is enabled, so we don't
  // pay the per-render subscription cost when the feature is off.
  useEffect(() => {
    if (!radioEnabled) return;

    let prevIsPlaying = usePlayerStore.getState().isPlaying;
    let prevTime = usePlayerStore.getState().currentTime;
    let prevId = usePlayerStore.getState().current?.id ?? null;
    // One-shot guard per song id: prevents a single ended event from
    // triggering multiple autoplayNext calls (e.g. if the store notifies
    // twice on the same transition). Reset whenever the song changes or
    // the user re-starts playback of the same track.
    let firedForId: string | null = null;

    const unsub = usePlayerStore.subscribe((state) => {
      const id = state.current?.id ?? null;

      // New track loaded → reset the one-shot guard.
      if (id !== prevId) {
        firedForId = null;
      }

      // User (re)started playback of the same track → re-arm.
      if (state.isPlaying && !prevIsPlaying && id === prevId) {
        firedForId = null;
      }

      // Ended signature: was playing → paused, time reset to 0, same song,
      // and we haven't already fired for this song.
      const justEnded =
        prevIsPlaying &&
        !state.isPlaying &&
        prevTime > 0 &&
        state.currentTime === 0 &&
        id !== null &&
        id === prevId &&
        firedForId !== id;

      if (justEnded && id) {
        firedForId = id;
        void autoplayNext(state.current);
      }

      prevIsPlaying = state.isPlaying;
      prevTime = state.currentTime;
      prevId = id;
    });

    return () => {
      unsub();
    };
  }, [radioEnabled]);

  return { radioEnabled, toggleRadio };
}

export default useRadio;
