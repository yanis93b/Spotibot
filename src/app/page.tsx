"use client";

import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import type { GenerateRequest, Song } from "@/lib/types";
import { AppSidebar, type SidebarView } from "@/components/music/app-sidebar";
import { TopBar } from "@/components/music/top-bar";
import { BottomPlayer } from "@/components/music/bottom-player";
import { PromptComposer } from "@/components/music/prompt-composer";
import { TrackList } from "@/components/music/track-list";
import { NowPlayingPanel } from "@/components/music/now-playing-panel";
import { GenerationLoader } from "@/components/music/generation-loader";
import { useSongs } from "@/hooks/use-songs";
import { usePlayerStore } from "@/lib/player-store";
import { CoverImage } from "@/components/music/cover-image";
import { Play, Pause, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  const { songs, loading: songsLoading, prepend, remove, restore, toggleLike } = useSongs();
  const [view, setView] = useState<SidebarView>("create");
  const [isGenerating, setIsGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const patchCurrent = usePlayerStore((s) => s.patchCurrent);
  const playSong = usePlayerStore((s) => s.playSong);
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const likedCount = songs.filter((s) => s.liked).length;

  // Filtered lists for the Library / Liked views + search.
  const filteredSongs = useMemo(() => {
    let list = songs;
    if (view === "liked") list = list.filter((s) => s.liked);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.genre.toLowerCase().includes(q) ||
          s.mood.toLowerCase().includes(q) ||
          s.lyrics.toLowerCase().includes(q),
      );
    }
    return list;
  }, [songs, view, search]);

  // Recent tracks for the Home view carousel.
  const recentSongs = useMemo(
    () =>
      [...songs]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [songs],
  );

  /**
   * Generate a song. Owns the fetch, loading flag, toasts, and library prepend.
   * After success the new song auto-plays and the view flips to the library.
   */
  const handleGenerate = useCallback(
    async (req: GenerateRequest): Promise<Song> => {
      setIsGenerating(true);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });

        if (!res.ok) {
          let message = `Generation failed (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) message = data.error;
          } catch {
            /* ignore */
          }
          throw new Error(message);
        }

        const song = (await res.json()) as Song;
        prepend(song);
        playSong(song);
        setView("library");
        toast({
          title: "Track ready!",
          description: `“${song.title}” is now playing.`,
        });
        return song;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Generation failed";
        toast({
          title: "Couldn't generate track",
          description: message,
          variant: "destructive",
        });
        throw e;
      } finally {
        setIsGenerating(false);
      }
    },
    [prepend, playSong, toast],
  );

  /** Toggle like with optimistic update + PATCH. */
  const handleToggleLike = useCallback(
    async (id: string): Promise<void> => {
      const prevLiked = toggleLike(id);
      patchCurrent({ liked: !prevLiked });
      try {
        const res = await fetch(`/api/songs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liked: !prevLiked }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        toggleLike(id);
        patchCurrent({ liked: Boolean(prevLiked) });
        toast({ title: "Couldn't update like", variant: "destructive" });
      }
    },
    [toggleLike, patchCurrent, toast],
  );

  /** Delete with optimistic remove. */
  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      const removed = remove(id);
      try {
        const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast({ title: "Track deleted" });
      } catch {
        if (removed) restore(removed);
        toast({ title: "Couldn't delete track", variant: "destructive" });
      }
    },
    [remove, restore, toast],
  );

  // Next/prev queue: based on the filtered list order.
  const handleNext = useCallback(() => {
    if (!current || filteredSongs.length === 0) return;
    const idx = filteredSongs.findIndex((s) => s.id === current.id);
    if (idx === -1) return;
    const next = filteredSongs[(idx + 1) % filteredSongs.length];
    if (next) playSong(next);
  }, [current, filteredSongs, playSong]);

  const handlePrev = useCallback(() => {
    if (!current || filteredSongs.length === 0) return;
    const idx = filteredSongs.findIndex((s) => s.id === current.id);
    if (idx === -1) return;
    const prev = filteredSongs[(idx - 1 + filteredSongs.length) % filteredSongs.length];
    if (prev) playSong(prev);
  }, [current, filteredSongs, playSong]);

  const heroTitle =
    view === "liked" ? "Liked Songs" : view === "library" ? "Your Library" : "Good evening";

  return (
    <div className="music-bg flex h-dvh text-foreground">
      <AppSidebar
        view={view}
        onViewChange={setView}
        trackCount={songs.length}
        likedCount={likedCount}
        isGenerating={isGenerating}
        search={search}
        onSearchChange={setSearch}
      />

      {/* Center + right column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Main scroll area */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <TopBar
            onCreate={() => setView("create")}
            isGenerating={isGenerating}
            search={search}
            onSearchChange={setSearch}
            showSearch={view !== "create"}
          />

          <div className="mx-auto w-full max-w-[1400px] flex-1 px-6 pb-8">
            <AnimatePresence mode="wait">
              {view === "create" ? (
                <motion.div
                  key="create"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  {/* Hero greeting */}
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {isGenerating ? "Creating your track…" : "Create something new"}
                  </h1>

                  {isGenerating ? (
                    <div className="mx-auto max-w-2xl">
                      <GenerationLoader />
                    </div>
                  ) : (
                    <div className="mx-auto max-w-2xl">
                      <PromptComposer loading={isGenerating} onGenerate={handleGenerate} />
                    </div>
                  )}

                  {/* Recently generated carousel */}
                  {!isGenerating && recentSongs.length > 0 && (
                    <section>
                      <h2 className="mb-3 text-lg font-bold">Recently generated</h2>
                      <Carousel songs={recentSongs} currentId={current?.id} isPlaying={isPlaying} onPlay={playSong} onToggleLike={handleToggleLike} />
                    </section>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="library"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{heroTitle}</h1>
                  <TrackList
                    songs={filteredSongs}
                    loading={songsLoading}
                    onToggleLike={handleToggleLike}
                    onDelete={handleDelete}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Sticky bottom player */}
        <BottomPlayer onToggleLike={handleToggleLike} onNext={handleNext} onPrev={handlePrev} />
      </div>

      {/* Right "Now Playing" panel (xl+) */}
      <NowPlayingPanel song={current} onToggleLike={handleToggleLike} />
    </div>
  );
}

/** Horizontal scroll carousel of song cards (Home view, Spotify "Recently played" style). */
function Carousel({
  songs,
  currentId,
  isPlaying,
  onPlay,
  onToggleLike,
}: {
  songs: Song[];
  currentId?: string;
  isPlaying: boolean;
  onPlay: (s: Song) => void;
  onToggleLike: (id: string) => void;
}) {
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {songs.map((song) => {
        const isCurrent = song.id === currentId;
        const showPause = isCurrent && isPlaying;
        return (
          <div
            key={song.id}
            className="group relative w-44 shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.08]"
          >
            <div className="relative mb-3">
              <CoverImage
                id={song.id}
                src={song.coverUrl}
                alt={song.title}
                size={160}
                rounded="rounded-md"
                className="w-full !h-auto aspect-square"
                playing={showPause}
              />
              <button
                type="button"
                onClick={() => onPlay(song)}
                aria-label={showPause ? `Pause ${song.title}` : `Play ${song.title}`}
                className={cn(
                  "absolute bottom-2 right-2 grid size-11 place-items-center rounded-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/40 transition-all hover:scale-110 hover:bg-fuchsia-400",
                  isCurrent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0",
                )}
              >
                {showPause ? (
                  <Pause className="size-5" fill="currentColor" aria-hidden />
                ) : (
                  <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
                )}
              </button>
            </div>
            <p className={cn("truncate text-sm font-semibold", isCurrent ? "text-fuchsia-300" : "text-foreground")} title={song.title}>
              {song.title}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {song.genre} · {song.mood}
            </p>
            <button
              type="button"
              onClick={() => onToggleLike(song.id)}
              aria-label={song.liked ? `Unlike ${song.title}` : `Like ${song.title}`}
              className={cn(
                "absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/50 backdrop-blur-sm transition-opacity",
                song.liked ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <Heart className={cn("size-3.5", song.liked ? "fill-rose-500 text-rose-500" : "text-white")} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
