"use client";

/**
 * src/components/music/track-embed.tsx
 *
 * Standalone player for the public share page `/track/[id]`. Renders a
 * centered, minimal single-track player (no sidebar, no bottom bar) that a
 * logged-out visitor can play, seek, and download.
 *
 * Drives the shared `<audio>` element via the global `usePlayerStore` — this
 * component registers its own audio element on mount (so the store has
 * something to call `.play()` / `.pause()` on) and cleans it up on unmount.
 * The PublicTrack → Song conversion fills the player-store-only fields with
 * inert defaults so the store's `Song`-typed actions accept the public shape.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Pause,
  Play,
  Share2,
  Music2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/lib/player-store";
import type { Song } from "@/lib/types";
import type { PublicTrack } from "@/app/api/track/[id]/route";
import { CoverImage } from "./cover-image";
import { ShareDialog } from "./share-dialog";

export interface TrackEmbedProps {
  /** The public track payload (from GET /api/track/[id]). */
  track: PublicTrack;
}

/** Format seconds as m:ss (or m:ss for tracks ≥ 10 min). */
function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

/**
 * Adapts the public, owner-stripped `PublicTrack` shape into the fuller
 * `Song` shape the player store expects. The fields absent from PublicTrack
 * (prompt, voice, liked, seed, bpm, keyScale, timeSignature, audioFormat)
 * are filled with inert defaults — none of them are read by the player store
 * during playback; they exist only for type compatibility.
 */
function publicTrackToSong(track: PublicTrack): Song {
  return {
    id: track.id,
    title: track.title,
    prompt: "",
    lyrics: track.lyrics,
    genre: track.genre,
    mood: track.mood,
    style: track.style,
    voice: "",
    audioUrl: track.audioUrl,
    // The public audio endpoint derives the actual MIME + file extension from
    // the stored audioFormat server-side, so "mp3" here is just a label for
    // the download filename fallback.
    audioFormat: "mp3",
    durationMs: track.durationMs,
    coverUrl: track.coverUrl,
    bpm: null,
    keyScale: null,
    timeSignature: null,
    seed: null,
    liked: false,
    createdAt: track.createdAt,
  };
}

export function TrackEmbed({ track }: TrackEmbedProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  // Player store: state + actions.
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const registerAudio = usePlayerStore((s) => s.registerAudio);
  const loadSong = usePlayerStore((s) => s.loadSong);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playSong = usePlayerStore((s) => s.playSong);
  const onTimeUpdate = usePlayerStore((s) => s.onTimeUpdate);
  const onDurationChange = usePlayerStore((s) => s.onDurationChange);
  const onPlay = usePlayerStore((s) => s.onPlay);
  const onPause = usePlayerStore((s) => s.onPause);
  const onEnded = usePlayerStore((s) => s.onEnded);
  const beginSeek = usePlayerStore((s) => s.beginSeek);
  const endSeek = usePlayerStore((s) => s.endSeek);

  // Memoize the Song-shaped object so the store sees a stable reference per
  // track id (avoids re-triggering effects on parent re-renders).
  const song = useMemo(() => publicTrackToSong(track), [track]);

  // Register the audio element with the global player store so the store's
  // actions (togglePlay, seek, …) operate on this element. Cleanup on unmount
  // so a navigating-away BottomPlayer can re-register its own.
  useEffect(() => {
    registerAudio(audioRef.current);
    return () => registerAudio(null);
  }, [registerAudio]);

  // Load the track into the store (sets `current` + audio.src) without
  // auto-playing (browsers block autoplay-with-sound anyway). Re-runs when the
  // track id changes so navigating between share pages swaps the audio src.
  useEffect(() => {
    loadSong(song);
  }, [song, loadSong]);

  const isCurrent = current?.id === track.id;
  const showPause = isCurrent && isPlaying;

  const handlePlayClick = () => {
    if (isCurrent) {
      togglePlay();
    } else {
      playSong(song);
    }
  };

  const downloadFilename = `${track.title.replace(/[^\w\u4e00-\u9fa5\- ]+/g, "").trim() || "track"}.mp3`;

  const badges = [track.genre, track.mood, track.style].filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#050507] px-4 py-10">
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onDurationChange={(e) => onDurationChange(e.currentTarget.duration || 0)}
        onLoadedMetadata={(e) => onDurationChange(e.currentTarget.duration || 0)}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        className="hidden"
      >
        <track kind="captions" />
      </audio>

      <div className="glass-card w-full max-w-md rounded-3xl p-6 shadow-2xl shadow-black/50 sm:p-8">
        {/* ── Cover ─────────────────────────────────────────────── */}
        <div className="mb-6 flex justify-center">
          <CoverImage
            id={track.id}
            src={track.coverUrl}
            alt={track.title}
            size={320}
            rounded="rounded-2xl"
            playing={showPause}
            className="shadow-xl shadow-black/40"
          />
        </div>

        {/* ── Title + badges ────────────────────────────────────── */}
        <div className="mb-5 text-center">
          <h1
            className="truncate text-xl font-bold text-foreground sm:text-2xl"
            title={track.title}
          >
            {track.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {badges.map((label, i) => (
              <Badge
                key={`${label}-${i}`}
                variant="secondary"
                className="border-white/10 bg-white/[0.06] text-xs font-medium text-muted-foreground"
              >
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* ── Seek bar ──────────────────────────────────────────── */}
        <div className="mb-4 flex items-center gap-2">
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {fmt(currentTime)}
          </span>
          <Slider
            value={[Math.min(currentTime, duration || 0)]}
            max={Math.max(duration, 0.0001)}
            step={0.1}
            onValueChange={(v) => {
              beginSeek();
              onTimeUpdate(v[0] ?? 0);
            }}
            onValueCommit={(v) => endSeek(v[0] ?? 0)}
            aria-label="Seek"
            className="flex-1 [&_[data-slot=slider-range]]:bg-fuchsia-500 [&_[data-slot=slider-track]]:bg-white/15 [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-fuchsia-400"
          />
          <span className="w-10 shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {fmt(duration)}
          </span>
        </div>

        {/* ── Transport ─────────────────────────────────────────── */}
        <div className="mb-6 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={handlePlayClick}
            aria-label={showPause ? "Pause" : "Play"}
            className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-rose-500 text-white shadow-lg shadow-fuchsia-500/40 transition-transform hover:scale-105 active:scale-95"
          >
            {showPause ? (
              <Pause className="size-6" fill="currentColor" aria-hidden />
            ) : (
              <Play className="size-6 translate-x-0.5" fill="currentColor" aria-hidden />
            )}
          </button>
        </div>

        {/* ── Actions: download + share ─────────────────────────── */}
        <div className="flex items-center justify-center gap-2">
          <a
            href={track.audioUrl}
            download={downloadFilename}
            aria-label={`Download ${track.title}`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-foreground"
          >
            <Download className="size-4" aria-hidden />
            Download
          </a>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShareOpen(true)}
            aria-label="Share track"
            className="h-9 gap-2 border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
          >
            <Share2 className="size-4" aria-hidden />
            Share
          </Button>
        </div>

        {/* ── Lyrics (collapsible) ──────────────────────────────── */}
        {track.lyrics?.trim() && (
          <div className="mt-6 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={() => setLyricsOpen((o) => !o)}
              aria-expanded={lyricsOpen}
              aria-controls="track-embed-lyrics"
              className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                <Music2 className="size-3.5" aria-hidden />
                Lyrics
              </span>
              {lyricsOpen ? (
                <ChevronUp className="size-4" aria-hidden />
              ) : (
                <ChevronDown className="size-4" aria-hidden />
              )}
            </button>
            {lyricsOpen && (
              <pre
                id="track-embed-lyrics"
                className={cn(
                  "mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/30 p-4 pl-5 font-mono text-[12px] leading-relaxed text-foreground/80",
                  "before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-fuchsia-500 before:via-purple-400 before:to-rose-400",
                )}
              >
                {track.lyrics.trim()}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ── Share dialog ─────────────────────────────────────────── */}
      <ShareDialog
        trackId={track.id}
        trackTitle={track.title}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}

export default TrackEmbed;
