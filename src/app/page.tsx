"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import type { GenerateRequest, Song } from "@/lib/types";
import { SiteHeader } from "@/components/music/site-header";
import { SiteFooter } from "@/components/music/site-footer";
import { PromptComposer } from "@/components/music/prompt-composer";
import { SongPlayer } from "@/components/music/song-player";
import { SongHistory } from "@/components/music/song-history";
import { useSongs } from "@/hooks/use-songs";

export default function Home() {
  const { songs, loading: songsLoading, prepend, remove, restore } = useSongs();
  const [current, setCurrent] = useState<Song | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  /**
   * Generate a song. Parent owns the fetch (and therefore the loading flag
   * + toast feedback) so the composer stays a controlled, presentational
   * surface. Returns the created Song so callers can chain if needed.
   */
  const handleGenerate = useCallback(
    async (req: GenerateRequest): Promise<Song> => {
      setIsGenerating(true);
      setCurrent(null);
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
            /* ignore JSON parse errors — fall back to status message */
          }
          throw new Error(message);
        }

        const song = (await res.json()) as Song;
        prepend(song);
        setCurrent(song);
        toast({
          title: "Track ready!",
          description: `“${song.title}” is now playing.`,
        });
        return song;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Generation failed";
        toast({
          title: "Couldn’t generate track",
          description: message,
          variant: "destructive",
        });
        throw e;
      } finally {
        setIsGenerating(false);
      }
    },
    [prepend, toast],
  );

  /**
   * Delete a song. Optimistically remove from the list and the player; if
   * the DELETE request fails, restore the song and surface a toast.
   */
  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      const removed = remove(id);
      if (current?.id === id) setCurrent(null);

      try {
        const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
        if (!res.ok) {
          let message = `Delete failed (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) message = data.error;
          } catch {
            /* ignore */
          }
          throw new Error(message);
        }
        toast({ title: "Track deleted" });
      } catch (e) {
        if (removed) restore(removed);
        const message = e instanceof Error ? e.message : "Delete failed";
        toast({
          title: "Couldn’t delete track",
          description: message,
          variant: "destructive",
        });
      }
    },
    [remove, restore, current, toast],
  );

  return (
    <div className="music-bg flex min-h-screen flex-col text-foreground">
      <SiteHeader />

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mx-auto mb-8 max-w-2xl text-center sm:mb-10"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-fuchsia-200">
              AI Music Studio
            </span>
            <h1 className="mt-4 text-balance text-3xl font-bold tracking-tight sm:text-5xl">
              Turn <span className="gradient-text">words</span> into music
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-muted-foreground sm:text-base">
              Describe a vibe, pick a style, and the{" "}
              <span className="text-fuchsia-200">Ace Music</span> model composes
              original lyrics and renders a full sung track — vocals, instrumentation,
              and all — in seconds.
            </p>
          </motion.div>

          {/* Main grid: composer+player on left, library on right */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="flex flex-col gap-6 lg:col-span-3">
              <PromptComposer
                loading={isGenerating}
                onGenerate={handleGenerate}
              />
              <SongPlayer song={current} isGenerating={isGenerating} />
            </div>

            <div className="lg:col-span-2">
              <SongHistory
                songs={songs}
                currentId={current?.id ?? null}
                loading={songsLoading}
                isGenerating={isGenerating}
                onSelect={setCurrent}
                onDelete={handleDelete}
              />
            </div>
          </div>
        </div>
      </main>

      <SiteFooter className="mt-auto" />
    </div>
  );
}
