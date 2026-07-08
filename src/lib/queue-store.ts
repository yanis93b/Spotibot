/**
 * src/lib/queue-store.ts
 *
 * Persistent play queue (Zustand) — the Spotify-style "Up Next" list.
 *
 * The store owns:
 *   - `queue`        : the full ordered list of queued songs (including the
 *                      currently-playing one).
 *   - `currentIndex` : index of the song currently loaded in the player
 *                      (-1 when the queue is empty / nothing is playing).
 *
 * It integrates with the global `usePlayerStore` (the single shared
 * `<audio>` element owner). Whenever `playFrom`, `next`, or `prev` advance
 * the current track, this store hands the new song to
 * `playerStore.playSong(song)`, which loads the URL into the `<audio>`
 * element and starts playback. The queue never touches the audio element
 * directly — that stays a player-store responsibility (single source of
 * truth for the media element).
 *
 * Components typically:
 *   - read the upcoming list via `useQueueStore((s) => s.queue.slice(s.currentIndex + 1))`
 *   - read the current track via the `useCurrentQueueSong()` helper below
 *   - drive skip buttons via `useQueueStore((s) => s.next)` / `s.prev`
 *   - call `playFrom(songs, i)` from a track list / playlist row
 *   - call `addToQueue(song)` / `playNext(song)` from a song card overflow menu
 */

import { create } from "zustand";
import type { Song } from "@/lib/types";
import { usePlayerStore } from "@/lib/player-store";

export interface QueueState {
  /** Full ordered queue (including the currently-playing track). */
  queue: Song[];
  /** Index of the currently-playing track within `queue`. -1 = empty. */
  currentIndex: number;

  // ── queue mutations ─────────────────────────────────────────────────────
  /**
   * Replace the queue with `songs` and start playing the track at
   * `startIndex`. Used when the user picks a row in a track list / playlist
   * — every subsequent track becomes "up next".
   */
  playFrom: (songs: Song[], startIndex: number) => void;
  /** Append a song to the very end of the queue. */
  addToQueue: (song: Song) => void;
  /** Insert a song immediately after the current track (Spotify "Play next"). */
  playNext: (song: Song) => void;
  /** Remove the track at `index`. Adjusts `currentIndex` to stay valid. */
  removeFromQueue: (index: number) => void;
  /** Empty the queue and reset `currentIndex` to -1. */
  clearQueue: () => void;
  /** Drag-and-drop reorder: move the item at `from` to position `to`. */
  reorderQueue: (from: number, to: number) => void;

  // ── transport ───────────────────────────────────────────────────────────
  /**
   * Advance to the next track. Loads it into the player and returns the new
   * current song (or null if the queue is exhausted).
   */
  next: () => Song | null;
  /** Move to the previous track. Returns the new current song or null. */
  prev: () => Song | null;

  // ── derived selectors ───────────────────────────────────────────────────
  /** Returns the currently-playing song (queue[currentIndex]) or null. */
  getCurrent: () => Song | null;
}

export const useQueueStore = create<QueueState>((set, get) => {
  /**
   * Hand a song off to the global player and start playback.
   * Uses `usePlayerStore.getState()` (non-reactive) to avoid subscribing the
   * queue store to player updates — they're independent concerns.
   */
  const playThrough = (song: Song) => {
    usePlayerStore.getState().playSong(song);
  };

  return {
    queue: [],
    currentIndex: -1,

    playFrom: (songs, startIndex) => {
      if (songs.length === 0) {
        set({ queue: [], currentIndex: -1 });
        return;
      }
      // Clamp startIndex into [0, songs.length - 1] so a stray out-of-range
      // value (e.g. -1 or beyond-the-end) doesn't crash.
      const idx = Math.max(0, Math.min(startIndex, songs.length - 1));
      set({ queue: songs, currentIndex: idx });
      const song = songs[idx];
      if (song) playThrough(song);
    },

    addToQueue: (song) => {
      const { currentIndex, queue } = get();
      // If nothing is playing yet, adding to queue becomes "start playing
      // this now" — matches Spotify's behavior on the first enqueue.
      if (currentIndex < 0) {
        set({ queue: [song], currentIndex: 0 });
        playThrough(song);
        return;
      }
      set({ queue: [...queue, song] });
    },

    playNext: (song) => {
      const { currentIndex, queue } = get();
      // Same first-enqueue fast-path as addToQueue.
      if (currentIndex < 0) {
        set({ queue: [song], currentIndex: 0 });
        playThrough(song);
        return;
      }
      // Insert immediately after the current track so it plays next.
      const next = [...queue];
      next.splice(currentIndex + 1, 0, song);
      set({ queue: next });
    },

    removeFromQueue: (index) => {
      const { queue, currentIndex } = get();
      if (index < 0 || index >= queue.length) return;
      const next = [...queue];
      next.splice(index, 1);

      // Keep `currentIndex` pointing at a valid track. Removing the
      // currently-playing track does NOT auto-advance the player here —
      // the player keeps the (now-removed) song loaded and the user can
      // explicitly skip. We only fix the index so the queue UI stays sane.
      let newIdx = currentIndex;
      if (index < currentIndex) {
        // Removed a track before the current one → shift left.
        newIdx = currentIndex - 1;
      } else if (index === currentIndex) {
        // Removed the current track → clamp to the new last valid index.
        newIdx = Math.min(currentIndex, next.length - 1);
      }
      set({ queue: next, currentIndex: newIdx });
    },

    clearQueue: () => set({ queue: [], currentIndex: -1 }),

    reorderQueue: (from, to) => {
      const { queue, currentIndex } = get();
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= queue.length ||
        to >= queue.length
      ) {
        return;
      }
      const next = [...queue];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);

      // Track the currently-playing song through the move so it stays
      // "current" after the DnD operation completes.
      let newIdx = currentIndex;
      if (currentIndex === from) {
        // The current song itself was dragged.
        newIdx = to;
      } else if (from < currentIndex && to >= currentIndex) {
        // Dragged an earlier item past the current → current shifts left.
        newIdx = currentIndex - 1;
      } else if (from > currentIndex && to <= currentIndex) {
        // Dragged a later item before the current → current shifts right.
        newIdx = currentIndex + 1;
      }
      set({ queue: next, currentIndex: newIdx });
    },

    next: () => {
      const { queue, currentIndex } = get();
      const ni = currentIndex + 1;
      if (ni >= queue.length) return null;
      set({ currentIndex: ni });
      const song = queue[ni];
      if (song) playThrough(song);
      return song ?? null;
    },

    prev: () => {
      const { queue, currentIndex } = get();
      const pi = currentIndex - 1;
      if (pi < 0) return null;
      set({ currentIndex: pi });
      const song = queue[pi];
      if (song) playThrough(song);
      return song ?? null;
    },

    getCurrent: () => {
      const { queue, currentIndex } = get();
      if (currentIndex < 0 || currentIndex >= queue.length) return null;
      return queue[currentIndex];
    },
  };
});

/**
 * Convenience hook: subscribe to the currently-playing queued song so
 * components re-render when the queue advances. Equivalent to
 * `useQueueStore((s) => s.getCurrent())` but reactive on queue/index changes.
 */
export function useCurrentQueueSong(): Song | null {
  return useQueueStore((s) =>
    s.currentIndex >= 0 && s.currentIndex < s.queue.length
      ? (s.queue[s.currentIndex] ?? null)
      : null,
  );
}

/**
 * Convenience hook: subscribe to the list of upcoming tracks (everything
 * after the current one). This is what the queue panel renders.
 */
export function useUpcomingSongs(): Song[] {
  return useQueueStore((s) =>
    s.currentIndex >= 0 ? s.queue.slice(s.currentIndex + 1) : s.queue,
  );
}
