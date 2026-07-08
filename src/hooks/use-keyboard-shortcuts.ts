"use client";

import { useEffect } from "react";
import { usePlayerStore } from "@/lib/player-store";

/**
 * Global keyboard shortcuts for the music player (Spotify-style):
 *
 *   Space        → play / pause (ignored when typing in an input)
 *   ←  / →       → seek -5s / +5s
 *   ↑  / ↓       → volume up / down
 *   M            → toggle mute
 *   L            → like / unlike the current track
 *   N            → next track (delegated to the parent via onNext)
 *   P            → previous track (delegated via onPrev)
 *
 * Shortcuts are ignored when the focus is inside a text-editable element
 * (input, textarea, [contenteditable]) so typing prompts/lyrics isn't hijacked.
 */

export interface KeyboardShortcutsOptions {
  onToggleLike?: (songId: string) => void;
  onNext?: () => void;
  onPrev?: () => void;
}

export function useKeyboardShortcuts({
  onToggleLike,
  onNext,
  onPrev,
}: KeyboardShortcutsOptions = {}) {
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const current = usePlayerStore((s) => s.current);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when the user is typing.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable;
      if (editable) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(Math.max(0, currentTime - 5));
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(Math.min(duration || 0, currentTime + 5));
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(1, volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.1));
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "l":
          if (current && onToggleLike) {
            e.preventDefault();
            onToggleLike(current.id);
          }
          break;
        case "n":
          if (onNext) {
            e.preventDefault();
            onNext();
          }
          break;
        case "p":
          if (onPrev) {
            e.preventDefault();
            onPrev();
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    current,
    currentTime,
    duration,
    volume,
    onToggleLike,
    onNext,
    onPrev,
  ]);
}

export default useKeyboardShortcuts;
