"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Download,
  Music4,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Song } from "@/lib/types";
import { EqualizerBars } from "./equalizer-bars";
import { GenerationLoader } from "./generation-loader";
import { EmptyState } from "./empty-state";
import { LyricsPanel } from "./lyrics-panel";

export interface SongPlayerProps {
  song: Song | null;
  isGenerating: boolean;
}

/** Format seconds as m:ss (or mm:ss). Returns "0:00" for invalid input. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Deterministic 32-bit hash so a given song.id always yields the same waveform. */
function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic, fast, good enough for a faux waveform. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAR_COUNT = 56;

/**
 * Now-playing surface. Renders the loader while generating, an empty state
 * when no song exists, and a full custom audio player otherwise.
 *
 * Audio control is implemented manually over a hidden <audio> element so we
 * can paint a custom gradient play button, faux waveform, and seek slider
 * that match the Suno-style aesthetic.
 */
export function SongPlayer({ song, isGenerating }: SongPlayerProps) {
  if (isGenerating) return <GenerationLoader />;
  if (!song) return <EmptyState />;
  return <ActivePlayer key={song.id} song={song} />;
}

/** Inner player — keyed by song.id so all playback state resets per track. */
function ActivePlayer({ song }: { song: Song }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  // While the user is dragging the seek slider we suspend timeupdate-driven
  // updates so the thumb tracks the pointer instead of fighting the audio.
  const seekingRef = useRef(false);

  // Deterministic waveform heights for this song.
  const bars = useMemo(() => {
    const rand = mulberry32(hashSeed(song.id));
    return Array.from({ length: BAR_COUNT }, () => 0.25 + rand() * 0.75);
  }, [song.id]);

  // Audio element event wiring.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (!seekingRef.current) setCurrentTime(audio.currentTime);
    };
    const onLoadedMeta = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMeta);
    audio.addEventListener("durationchange", onLoadedMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    // Some browsers won't fire loadedmetadata for a streaming response until
    // the first chunk arrives; if duration is already known, capture it now.
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
      audio.removeEventListener("durationchange", onLoadedMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch {
      // Autoplay/play() can reject if the media isn't ready yet; fail quietly.
      setIsPlaying(false);
    }
  }, []);

  const handleSeekChange = (vals: number[]) => {
    seekingRef.current = true;
    const next = vals[0] ?? 0;
    setCurrentTime(next);
  };

  const handleSeekCommit = (vals: number[]) => {
    const audio = audioRef.current;
    const next = vals[0] ?? 0;
    if (audio) {
      audio.currentTime = next;
    }
    seekingRef.current = false;
    setCurrentTime(next);
  };

  const handleWaveformSeek = (index: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const next = (index / (BAR_COUNT - 1)) * duration;
    audio.currentTime = next;
    setCurrentTime(next);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  const handleVolume = (vals: number[]) => {
    const audio = audioRef.current;
    const v = vals[0] ?? 1;
    setVolume(v);
    if (audio) {
      audio.volume = v;
      audio.muted = v === 0;
      setMuted(v === 0);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const playedBarIndex = Math.floor((progress / 100) * (BAR_COUNT - 1));

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      aria-label="Now playing"
      className="glass-card relative overflow-hidden p-5 sm:p-6"
    >
      <audio
        ref={audioRef}
        src={song.audioUrl}
        preload="metadata"
        className="hidden"
      >
        <track kind="captions" />
      </audio>

      {/* Top: now-playing label + equalizer */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300/80">
            Now Playing
          </span>
          <EqualizerBars
            active={isPlaying}
            barCount={4}
            className="h-3.5"
          />
        </div>
        <Badge
          variant="outline"
          className="border-white/10 bg-white/5 text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          {song.audioFormat.toUpperCase()}
        </Badge>
      </div>

      {/* Title + badges */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500/30 via-purple-500/20 to-rose-500/30 ring-1 ring-white/10">
            <Music4 className="size-5 text-fuchsia-200" aria-hidden />
          </span>
          <h3
            className="gradient-text line-clamp-2 break-words text-xl font-bold leading-tight sm:text-2xl"
            title={song.title}
          >
            {song.title}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-transparent bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/20">
            {song.genre}
          </Badge>
          <Badge className="border-transparent bg-purple-500/15 text-purple-200 hover:bg-purple-500/20">
            {song.mood}
          </Badge>
          <Badge className="border-transparent bg-rose-500/15 text-rose-200 hover:bg-rose-500/20">
            {song.style}
          </Badge>
        </div>

        {song.prompt && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            <span className="text-muted-foreground/60">Prompt: </span>
            {song.prompt}
          </p>
        )}
      </div>

      {/* Faux waveform — deterministic per song, click-to-seek */}
      <div
        className="mt-5 flex h-14 items-center gap-[2px]"
        role="slider"
        aria-label="Seek through track"
        aria-valuemin={0}
        aria-valuemax={Math.max(Math.round(duration), 1)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            handleSeekChange([Math.min(currentTime + 5, duration)]);
            handleSeekCommit([Math.min(currentTime + 5, duration)]);
          } else if (e.key === "ArrowLeft") {
            handleSeekChange([Math.max(currentTime - 5, 0)]);
            handleSeekCommit([Math.max(currentTime - 5, 0)]);
          }
        }}
      >
        {bars.map((h, i) => {
          const played = i <= playedBarIndex;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleWaveformSeek(i)}
              aria-label={`Seek to ${Math.round(
                (i / (BAR_COUNT - 1)) * duration,
              )} seconds`}
              tabIndex={-1}
              className="group flex-1 rounded-full transition-all"
              style={{ height: "100%" }}
            >
              <span
                className={cn(
                  "block w-full rounded-full transition-colors duration-150",
                  played
                    ? "bg-gradient-to-t from-fuchsia-500 to-rose-300"
                    : "bg-white/15 group-hover:bg-white/30",
                )}
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            </button>
          );
        })}
      </div>

      {/* Transport controls */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-rose-500 text-white shadow-lg shadow-fuchsia-500/30 transition-all hover:scale-105 hover:shadow-xl hover:shadow-fuchsia-500/40 active:scale-95"
        >
          {isPlaying ? (
            <Pause className="size-5" fill="currentColor" aria-hidden />
          ) : (
            <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
          )}
        </button>

        <div className="flex-1">
          <Slider
            value={[Math.min(currentTime, duration || 0)]}
            max={Math.max(duration, 0.0001)}
            step={0.1}
            onValueChange={handleSeekChange}
            onValueCommit={handleSeekCommit}
            aria-label="Seek"
            className="[&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-fuchsia-500 [&_[data-slot=slider-range]]:to-rose-400 [&_[data-slot=slider-thumb]]:border-fuchsia-400 [&_[data-slot=slider-thumb]]:bg-white"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Volume (compact) */}
        <div className="hidden items-center gap-2 sm:flex">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            {muted || volume === 0 ? (
              <VolumeX className="size-4" aria-hidden />
            ) : (
              <Volume2 className="size-4" aria-hidden />
            )}
          </button>
          <Slider
            value={[muted ? 0 : volume]}
            max={1}
            step={0.05}
            onValueChange={handleVolume}
            aria-label="Volume"
            className="w-20 [&_[data-slot=slider-range]]:bg-fuchsia-400/70 [&_[data-slot=slider-thumb]]:border-fuchsia-400 [&_[data-slot=slider-thumb]]:bg-white"
          />
        </div>
      </div>

      {/* Action row: download + lyrics toggle */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href={song.audioUrl}
          download={`${song.title}.${song.audioFormat || "wav"}`}
          aria-label={`Download ${song.title} as ${song.audioFormat?.toUpperCase() || "WAV"}`}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-foreground/85 transition-all hover:border-fuchsia-400/30 hover:bg-white/10 hover:text-foreground"
        >
          <Download className="size-4 text-fuchsia-300" aria-hidden />
          Download {song.audioFormat?.toUpperCase() || "WAV"}
        </a>

        <button
          type="button"
          onClick={() => setShowLyrics((s) => !s)}
          aria-expanded={showLyrics}
          aria-controls="song-lyrics-panel"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-foreground/85 transition-all hover:border-fuchsia-400/30 hover:bg-white/10 hover:text-foreground"
        >
          Lyrics
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-200",
              showLyrics && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      {/* Expandable lyrics */}
      {showLyrics && (
        <motion.div
          id="song-lyrics-panel"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-4 overflow-hidden"
        >
          <LyricsPanel lyrics={song.lyrics} />
        </motion.div>
      )}
    </motion.section>
  );
}

export default SongPlayer;
