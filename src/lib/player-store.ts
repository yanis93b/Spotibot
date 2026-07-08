/**
 * Global audio player store (Zustand).
 *
 * Owns the single shared <audio> element's playback state so that the sticky
 * bottom player bar and every song card can drive the same audio instance.
 * The actual <audio> element lives in <BottomPlayer/> and is wired to this
 * store via the registerAudio() + the event handlers it calls.
 *
 * This is the Suno-style architecture: one player, many controls.
 */

import { create } from "zustand";
import type { Song } from "@/lib/types";

export interface PlayerState {
  /** The song currently loaded into the player (null = nothing loaded). */
  current: Song | null;
  /** Whether audio is actively playing. */
  isPlaying: boolean;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Track duration in seconds (0 until metadata loads). */
  duration: number;
  /** Volume 0..1. */
  volume: number;
  /** Muted flag. */
  muted: boolean;
  /** Whether the user is currently dragging the seek bar. */
  seeking: boolean;
  /** The underlying audio element (registered by BottomPlayer). */
  audioEl: HTMLAudioElement | null;

  // ── actions ────────────────────────────────────────────────────────────
  /** Register the audio element so actions can call it directly. */
  registerAudio: (el: HTMLAudioElement | null) => void;
  /** Load a song and start playing it. */
  playSong: (song: Song) => void;
  /** Load a song but don't auto-play (e.g. selecting from the library). */
  loadSong: (song: Song) => void;
  /** Toggle play/pause for the current track. */
  togglePlay: () => void;
  /** Hard play (used by card overlays). */
  play: () => void;
  /** Hard pause. */
  pause: () => void;
  /** Seek to a position (seconds). */
  seek: (seconds: number) => void;
  /** Begin a seek-drag (suspend timeupdate-driven UI updates). */
  beginSeek: () => void;
  /** Commit a seek-drag at the given position. */
  endSeek: (seconds: number) => void;
  /** Set volume 0..1. */
  setVolume: (v: number) => void;
  /** Toggle mute. */
  toggleMute: () => void;

  // ── event-driven state setters (called by <audio> event handlers) ──────
  onTimeUpdate: (t: number) => void;
  onDurationChange: (d: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;

  /** Patch the current song in-place (e.g. after a like toggle). */
  patchCurrent: (patch: Partial<Song>) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  seeking: false,
  audioEl: null,

  registerAudio: (el) => set({ audioEl: el }),

  playSong: (song) => {
    const { audioEl, current } = get();
    // If it's the same song, just toggle play/pause (Suno behavior).
    if (current?.id === song.id && audioEl) {
      if (audioEl.paused) {
        void audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
      return;
    }
    set({
      current: song,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
    });
    if (audioEl) {
      audioEl.src = song.audioUrl;
      audioEl.currentTime = 0;
      void audioEl.play().catch(() => {
        // Autoplay can reject if the media isn't ready; the UI will reflect
        // paused state via the onPlay/onPause events.
        set({ isPlaying: false });
      });
    }
  },

  loadSong: (song) => {
    const { audioEl, current } = get();
    if (current?.id === song.id) return;
    set({ current: song, currentTime: 0, duration: 0, isPlaying: false });
    if (audioEl) {
      audioEl.src = song.audioUrl;
      audioEl.currentTime = 0;
    }
  },

  togglePlay: () => {
    const { audioEl } = get();
    if (!audioEl) return;
    if (audioEl.paused) {
      void audioEl.play().catch(() => {});
    } else {
      audioEl.pause();
    }
  },

  play: () => {
    const { audioEl } = get();
    if (audioEl) void audioEl.play().catch(() => {});
  },

  pause: () => {
    const { audioEl } = get();
    if (audioEl) audioEl.pause();
  },

  seek: (seconds) => {
    const { audioEl } = get();
    if (audioEl) audioEl.currentTime = seconds;
    set({ currentTime: seconds });
  },

  beginSeek: () => set({ seeking: true }),

  endSeek: (seconds) => {
    const { audioEl } = get();
    if (audioEl) audioEl.currentTime = seconds;
    set({ seeking: false, currentTime: seconds });
  },

  setVolume: (v) => {
    const { audioEl } = get();
    const vol = Math.min(1, Math.max(0, v));
    if (audioEl) {
      audioEl.volume = vol;
      audioEl.muted = vol === 0;
    }
    set({ volume: vol, muted: vol === 0 });
  },

  toggleMute: () => {
    const { audioEl, muted } = get();
    if (audioEl) audioEl.muted = !muted;
    set({ muted: !muted });
  },

  onTimeUpdate: (t) => {
    if (!get().seeking) set({ currentTime: t });
  },

  onDurationChange: (d) => set({ duration: d }),

  onPlay: () => set({ isPlaying: true }),

  onPause: () => set({ isPlaying: false }),

  onEnded: () => set({ isPlaying: false, currentTime: 0 }),

  patchCurrent: (patch) =>
    set((s) => (s.current ? { current: { ...s.current, ...patch } } : s)),
}));
