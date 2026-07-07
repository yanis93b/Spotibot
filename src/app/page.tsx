"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import type { GenerateRequest, Song } from "@/lib/types";
import { AppSidebar, type SidebarView } from "@/components/music/app-sidebar";
import { BottomPlayer } from "@/components/music/bottom-player";
import { PromptComposer } from "@/components/music/prompt-composer";
import { SongFeed } from "@/components/music/song-feed";
import { SongDetail } from "@/components/music/song-detail";
import { GenerationLoader } from "@/components/music/generation-loader";
import { useSongs } from "@/hooks/use-songs";
import { usePlayerStore } from "@/lib/player-store";
import { Sparkles } from "lucide-react";

export default function Home() {
  const { songs, loading: songsLoading, prepend, remove, restore, toggleLike } = useSongs();
  const [view, setView] = useState<SidebarView>("create");
  const [likedOnly, setLikedOnly] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [detailSong, setDetailSong] = useState<Song | null>(null);
  const { toast } = useToast();

  const patchCurrent = usePlayerStore((s) => s.patchCurrent);
  const playSong = usePlayerStore((s) => s.playSong);

  const likedCount = songs.filter((s) => s.liked).length;

  /**
   * Generate a song. Owns the fetch, loading flag, toasts, and library prepend.
   * After success the new song auto-plays and the view flips to the library so
   * the user sees it appear at the top of the feed.
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
        setLikedOnly(false);
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
      const prevLiked = toggleLike(id); // optimistic
      // Keep the player store's current song in sync.
      patchCurrent({ liked: !prevLiked });
      // Keep the detail overlay in sync if it's showing this song.
      setDetailSong((cur) =>
        cur && cur.id === id ? { ...cur, liked: !prevLiked } : cur,
      );
      try {
        const res = await fetch(`/api/songs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liked: !prevLiked }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Server is the source of truth for the liked flag; we already applied
        // it optimistically, so on success there's nothing more to do.
      } catch {
        // Revert on failure.
        toggleLike(id);
        patchCurrent({ liked: Boolean(prevLiked) });
        setDetailSong((cur) =>
          cur && cur.id === id ? { ...cur, liked: Boolean(prevLiked) } : cur,
        );
        toast({
          title: "Couldn't update like",
          variant: "destructive",
        });
      }
    },
    [toggleLike, patchCurrent, toast],
  );

  /** Delete with optimistic remove + confirm (handled in the card menu). */
  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      const removed = remove(id);
      if (detailSong?.id === id) setDetailSong(null);
      try {
        const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast({ title: "Track deleted" });
      } catch {
        if (removed) restore(removed);
        toast({
          title: "Couldn't delete track",
          variant: "destructive",
        });
      }
    },
    [remove, restore, detailSong, toast],
  );

  return (
    <div className="music-bg flex min-h-dvh text-foreground">
      <AppSidebar
        view={view}
        onViewChange={setView}
        trackCount={songs.length}
        likedCount={likedCount}
        likedOnly={likedOnly}
        onToggleLikedOnly={() => {
          setLikedOnly((v) => !v);
          setView("library");
        }}
        isGenerating={isGenerating}
      />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
            <AnimatePresence mode="wait">
              {view === "create" ? (
                <motion.div
                  key="create-view"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-6"
                >
                  {/* Hero (compact) */}
                  <div className="text-center sm:text-left">
                    <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-fuchsia-200">
                      <Sparkles className="size-3" aria-hidden />
                      AI Music Studio
                    </span>
                    <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                      Turn <span className="gradient-text">words</span> into music
                    </h1>
                    <p className="mt-2 max-w-2xl text-pretty text-sm text-muted-foreground sm:text-base">
                      Describe a vibe, pick a style, and the Ace Music model renders a
                      full sung track — vocals, instrumentation, and all — in seconds.
                    </p>
                  </div>

                  {/* Composer OR loader */}
                  {isGenerating ? (
                    <div className="mx-auto max-w-2xl">
                      <GenerationLoader />
                    </div>
                  ) : (
                    <div className="mx-auto max-w-2xl">
                      <PromptComposer loading={isGenerating} onGenerate={handleGenerate} />
                    </div>
                  )}

                  {/* Recent tracks strip (only on create view, when not generating) */}
                  {!isGenerating && songs.length > 0 && (
                    <div>
                      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                        Recent tracks
                      </h2>
                      <SongFeed
                        songs={songs.slice(0, 5)}
                        loading={false}
                        isGenerating={isGenerating}
                        likedOnly={false}
                        onShowDetails={setDetailSong}
                        onToggleLike={handleToggleLike}
                        onDelete={handleDelete}
                      />
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="library-view"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                >
                  <SongFeed
                    songs={songs}
                    loading={songsLoading}
                    isGenerating={isGenerating}
                    likedOnly={likedOnly}
                    onShowDetails={setDetailSong}
                    onToggleLike={handleToggleLike}
                    onDelete={handleDelete}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Sticky bottom player bar */}
        <BottomPlayer onToggleLike={handleToggleLike} />
      </div>

      {/* Detail overlay */}
      <SongDetail
        song={detailSong}
        onClose={() => setDetailSong(null)}
        onToggleLike={handleToggleLike}
      />
    </div>
  );
}
