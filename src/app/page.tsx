"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import type { GenerateRequest, Playlist, Song } from "@/lib/types";
import { AppSidebar, type SidebarView } from "@/components/music/app-sidebar";
import { TopBar } from "@/components/music/top-bar";
import { BottomPlayer } from "@/components/music/bottom-player";
import { MobileNav } from "@/components/music/mobile-nav";
import { PromptComposer } from "@/components/music/prompt-composer";
import { TrackList } from "@/components/music/track-list";
import { NowPlayingPanel } from "@/components/music/now-playing-panel";
import { GenerationLoader } from "@/components/music/generation-loader";
import { CreatePlaylistDialog } from "@/components/music/create-playlist-dialog";
import { AddToPlaylistMenu } from "@/components/music/add-to-playlist-menu";
import { BrowseView } from "@/components/music/browse-view";
import { QueuePanel } from "@/components/music/queue-panel";
import { AnalyticsView } from "@/components/music/analytics-view";
import { SettingsView } from "@/components/music/settings-view";
import { DiscoverView } from "@/components/music/discover-view";
import { FeedView } from "@/components/music/feed-view";
import { ShareDialog } from "@/components/music/share-dialog";
import { RadioToggle } from "@/components/music/radio-toggle";
import { LyricsEditor } from "@/components/music/lyrics-editor";
import { useSongs } from "@/hooks/use-songs";
import { usePlaylists } from "@/hooks/use-playlists";
import { usePlayerStore } from "@/lib/player-store";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useSession } from "next-auth/react";
import { useRadio } from "@/hooks/use-radio";
import { CoverImage } from "@/components/music/cover-image";
import { Play, Pause, Heart, Clock, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Time-of-day greeting (Spotify-style "Good evening / afternoon / morning"). */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Format ms → "X min Y sec" or just "X min". */
function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr} hr ${min % 60} min`;
  return `${min} min`;
}

export default function Home() {
  const { songs, loading: songsLoading, prepend, remove, restore, toggleLike } = useSongs();
  const {
    playlists,
    create: createPlaylist,
    remove: deletePlaylist,
    addTrack,
    fetchPlaylist,
  } = usePlaylists();
  const [view, setView] = useState<SidebarView>("create");
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activePlaylistSongs, setActivePlaylistSongs] = useState<Song[]>([]);
  const [activePlaylistMeta, setActivePlaylistMeta] = useState<Playlist | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  /** Timestamp (ms epoch) until which generation is rate-limited. Null = no limit. */
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  /** Live seconds remaining until the rate limit resets (0 when no limit). */
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState(0);

  // Countdown effect: tick every second while a rate limit is active, and
  // clear it (re-enabling generation) when the timer hits zero.
  useEffect(() => {
    if (!rateLimitUntil) {
      setRateLimitSecondsLeft(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000));
      setRateLimitSecondsLeft(remaining);
      if (remaining <= 0) {
        setRateLimitUntil(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [rateLimitUntil]);
  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false);
  const [profileViewOpen, setProfileViewOpen] = useState(false);
  const { toast } = useToast();
  const { data: session } = useSession();
  useRadio(); // enable radio/autoplay (reads localStorage for enabled state)

  const patchCurrent = usePlayerStore((s) => s.patchCurrent);
  const playSong = usePlayerStore((s) => s.playSong);
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const likedCount = songs.filter((s) => s.liked).length;

  // ── Data for the current view ──────────────────────────────────────────────
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

  const recentSongs = useMemo(
    () =>
      [...songs]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [songs],
  );

  // The list the queue (next/prev) navigates through.
  const queueList = view === "playlist" ? activePlaylistSongs : filteredSongs;

  // ── Handlers ───────────────────────────────────────────────────────────────
  // AbortController for the in-flight generation request (so the user can cancel).
  const generateAbortRef = useRef<AbortController | null>(null);

  const handleGenerate = useCallback(
    async (req: GenerateRequest): Promise<Song> => {
      setIsGenerating(true);
      setRateLimitUntil(null); // clear any previous rate-limit state
      const controller = new AbortController();
      generateAbortRef.current = controller;
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });
        if (!res.ok) {
          let message = `Generation failed (${res.status})`;
          let retryAfterSeconds = 0;
          try {
            const data = (await res.json()) as {
              error?: string;
              retryAfterSeconds?: number;
              quota?: number | null;
            };
            if (data?.error) message = data.error;
            if (typeof data?.retryAfterSeconds === "number") {
              retryAfterSeconds = data.retryAfterSeconds;
            }
          } catch {
            /* ignore */
          }
          // 429 = rate limited. Record the unlock time so the UI can show a
          // live countdown + disable the generate button until it elapses.
          if (res.status === 429 && retryAfterSeconds > 0) {
            const until = Date.now() + retryAfterSeconds * 1000;
            setRateLimitUntil(until);
          }
          throw new Error(message);
        }
        const song = (await res.json()) as Song;
        prepend(song);
        playSong(song);
        setView("library");
        setActivePlaylistId(null);
        toast({ title: "Track ready!", description: `“${song.title}” is now playing.` });
        return song;
      } catch (e) {
        // AbortError = user cancelled — don't show an error toast.
        if (e instanceof DOMException && e.name === "AbortError") {
          toast({ title: "Generation cancelled" });
          throw e;
        }
        const message = e instanceof Error ? e.message : "Generation failed";
        toast({ title: "Couldn't generate track", description: message, variant: "destructive" });
        throw e;
      } finally {
        generateAbortRef.current = null;
        setIsGenerating(false);
      }
    },
    [prepend, playSong, toast],
  );

  /** Cancel the in-flight generation (wired to the loader's Cancel button). */
  const handleCancelGenerate = useCallback(() => {
    generateAbortRef.current?.abort();
  }, []);

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

  const handleNext = useCallback(() => {
    if (!current || queueList.length === 0) return;
    const idx = queueList.findIndex((s) => s.id === current.id);
    if (idx === -1) return;
    const next = queueList[(idx + 1) % queueList.length];
    if (next) playSong(next);
  }, [current, queueList, playSong]);

  const handlePrev = useCallback(() => {
    if (!current || queueList.length === 0) return;
    const idx = queueList.findIndex((s) => s.id === current.id);
    if (idx === -1) return;
    const prev = queueList[(idx - 1 + queueList.length) % queueList.length];
    if (prev) playSong(prev);
  }, [current, queueList, playSong]);

  // Keyboard shortcuts (Space, arrows, M, L, N, P).
  useKeyboardShortcuts({
    onToggleLike: handleToggleLike,
    onNext: handleNext,
    onPrev: handlePrev,
  });

  // ── Playlist handlers ──────────────────────────────────────────────────────
  const handleCreatePlaylist = useCallback(
    async (name: string): Promise<void> => {
      await createPlaylist(name);
      toast({ title: "Playlist created", description: `“${name}” is ready.` });
    },
    [createPlaylist, toast],
  );

  const handleOpenPlaylist = useCallback(
    async (id: string): Promise<void> => {
      const result = await fetchPlaylist(id);
      if (!result) {
        toast({ title: "Couldn't open playlist", variant: "destructive" });
        return;
      }
      setActivePlaylistId(id);
      setActivePlaylistSongs(result.songs);
      setActivePlaylistMeta(result.playlist);
      setView("playlist");
    },
    [fetchPlaylist, toast],
  );

  const handleAddToPlaylist = useCallback(
    async (playlistId: string, songId: string): Promise<void> => {
      await addTrack(playlistId, songId);
      toast({ title: "Added to playlist" });
    },
    [addTrack, toast],
  );

  const handleDeletePlaylist = useCallback(
    async (id: string): Promise<void> => {
      await deletePlaylist(id);
      if (activePlaylistId === id) {
        setActivePlaylistId(null);
        setActivePlaylistSongs([]);
        setActivePlaylistMeta(null);
        setView("library");
      }
      toast({ title: "Playlist deleted" });
    },
    [deletePlaylist, activePlaylistId, toast],
  );

  const heroTitle =
    view === "liked"
      ? "Liked Songs"
      : view === "playlist"
        ? activePlaylistMeta?.name ?? "Playlist"
        : view === "library"
          ? "Your Library"
          : greeting();

  return (
    <div className="music-bg flex h-dvh text-foreground">
      <AppSidebar
        view={view}
        onViewChange={(v) => {
          setView(v);
          setActivePlaylistId(null);
        }}
        trackCount={songs.length}
        likedCount={likedCount}
        isGenerating={isGenerating}
        search={search}
        onSearchChange={setSearch}
        playlists={playlists}
        onCreatePlaylist={() => setCreateDialogOpen(true)}
        onOpenPlaylist={handleOpenPlaylist}
        activePlaylistId={activePlaylistId}
        onViewProfile={() => {
          const username = session?.user?.name;
          if (username) {
            window.open(`/u/${username.toLowerCase().replace(/\s+/g, "-")}`, "_blank");
          }
        }}
      />

      {/* Center + right column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <TopBar
            onCreate={() => {
              setView("create");
              setActivePlaylistId(null);
            }}
            isGenerating={isGenerating}
            search={search}
            onSearchChange={setSearch}
            showSearch={view !== "create"}
          />

          <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-8 sm:px-6">
            <AnimatePresence mode="wait">
              {view === "create" ? (
                <motion.div
                  key="create"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-5"
                >
                  {/* Hero greeting */}
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {isGenerating ? "Creating your track…" : greeting()}
                  </h1>

                  {/* Quick-access tiles (Spotify Home style) */}
                  {!isGenerating && (likedCount > 0 || recentSongs.length > 0) && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {likedCount > 0 && (
                        <QuickTile
                          title="Liked Songs"
                          subtitle={`${likedCount} ${likedCount === 1 ? "track" : "tracks"}`}
                          gradient="from-purple-500 to-fuchsia-600"
                          onClick={() => setView("liked")}
                        />
                      )}
                      {recentSongs.slice(0, 2).map((s) => (
                        <QuickTile
                          key={s.id}
                          title={s.title}
                          subtitle={`${s.genre} · ${s.mood}`}
                          song={s}
                          onClick={() => playSong(s)}
                        />
                      ))}
                    </div>
                  )}

                  {isGenerating ? (
                    <div className="mx-auto max-w-2xl">
                      <GenerationLoader onCancel={handleCancelGenerate} />
                    </div>
                  ) : (
                    <div className="mx-auto max-w-2xl">
                      <PromptComposer
                        loading={isGenerating}
                        onGenerate={handleGenerate}
                        rateLimitSecondsLeft={rateLimitSecondsLeft}
                      />
                    </div>
                  )}

                  {/* Recently generated carousel */}
                  {!isGenerating && recentSongs.length > 0 && (
                    <section>
                      <h2 className="mb-3 text-lg font-bold">Recently generated</h2>
                      <Carousel
                        songs={recentSongs}
                        currentId={current?.id}
                        isPlaying={isPlaying}
                        onPlay={playSong}
                        onToggleLike={handleToggleLike}
                      />
                    </section>
                  )}
                </motion.div>
              ) : view === "browse" ? (
                <motion.div
                  key="browse"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <BrowseView
                    onToggleLike={handleToggleLike}
                    onDelete={handleDelete}
                    playlists={playlists}
                    onAddToPlaylist={handleAddToPlaylist}
                    onCreatePlaylist={() => setCreateDialogOpen(true)}
                  />
                </motion.div>
              ) : view === "discover" ? (
                <motion.div
                  key="discover"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <DiscoverView onPlay={playSong} />
                </motion.div>
              ) : view === "feed" ? (
                <motion.div
                  key="feed"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <FeedView onPlay={playSong} />
                </motion.div>
              ) : view === "analytics" ? (
                <motion.div
                  key="analytics"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <AnalyticsView />
                </motion.div>
              ) : view === "settings" ? (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <SettingsView />
                </motion.div>
              ) : view === "playlist" && activePlaylistMeta ? (
                <motion.div
                  key="playlist"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  {/* Playlist header (Spotify-style banner) */}
                  <PlaylistHeader
                    playlist={activePlaylistMeta}
                    songs={activePlaylistSongs}
                    onPlayAll={() => activePlaylistSongs[0] && playSong(activePlaylistSongs[0])}
                    onDelete={() => handleDeletePlaylist(activePlaylistMeta.id)}
                  />
                  <TrackList
                    songs={activePlaylistSongs}
                    loading={false}
                    onToggleLike={handleToggleLike}
                    onDelete={handleDelete}
                  />
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
                    playlists={playlists}
                    onAddToPlaylist={handleAddToPlaylist}
                    onCreatePlaylist={() => setCreateDialogOpen(true)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Mobile bottom nav (replaces sidebar on small screens) */}
        <MobileNav
          view={view}
          onViewChange={(v) => {
            setView(v);
            setActivePlaylistId(null);
          }}
          isGenerating={isGenerating}
        />

        {/* Sticky bottom player */}
        <BottomPlayer
          onToggleLike={handleToggleLike}
          onNext={handleNext}
          onPrev={handlePrev}
          onQueueToggle={() => setQueuePanelOpen((v) => !v)}
          onShare={() => setShareDialogOpen(true)}
        />
      </div>

      {/* Queue panel (slide-in from right) */}
      <QueuePanel open={queuePanelOpen} onClose={() => setQueuePanelOpen(false)} />

      {/* Right "Now Playing" panel (xl+) */}
      <NowPlayingPanel song={current} onToggleLike={handleToggleLike} />

      {/* Create-playlist modal */}
      <CreatePlaylistDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreatePlaylist}
      />

      {/* Share dialog for the current track */}
      {current && (
        <ShareDialog
          trackId={current.id}
          trackTitle={current.title}
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
        />
      )}

      {/* Lyrics editor for the current track */}
      {current && (
        <LyricsEditor
          songId={current.id}
          initialLyrics={current.lyrics}
          open={lyricsEditorOpen}
          onOpenChange={setLyricsEditorOpen}
          onSaved={(newLyrics) => {
            patchCurrent({ lyrics: newLyrics });
            toast({ title: "Lyrics updated" });
          }}
        />
      )}
    </div>
  );
}

/** Spotify-style quick-access tile (Home view). */
function QuickTile({
  title,
  subtitle,
  gradient,
  song,
  onClick,
}: {
  title: string;
  subtitle: string;
  gradient?: string;
  song?: Song;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.04] pr-3 text-left transition-colors hover:bg-white/[0.1]"
    >
      {song ? (
        <CoverImage id={song.id} src={song.coverUrl} alt={title} size={64} rounded="rounded-none" />
      ) : (
        <span
          className={cn(
            "grid size-16 shrink-0 place-items-center bg-gradient-to-br",
            gradient ?? "from-purple-500 to-fuchsia-600",
          )}
        >
          <Heart className="size-6 fill-white text-white" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

/** Playlist banner header (cover + title + play + delete). */
function PlaylistHeader({
  playlist,
  songs,
  onPlayAll,
  onDelete,
}: {
  playlist: Playlist;
  songs: Song[];
  onPlayAll: () => void;
  onDelete: () => void;
}) {
  const hasSongs = songs.length > 0;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <span
        className="grid size-32 shrink-0 place-items-center rounded-md sm:size-40"
        style={{
          background: `linear-gradient(135deg, hsl(${hueFromName(playlist.name)} 65% 48%), hsl(${(hueFromName(playlist.name) + 60) % 360} 65% 42%))`,
        }}
      >
        <Heart className="size-10 text-white/90" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Playlist
        </p>
        <h1 className="mt-1 truncate text-3xl font-extrabold tracking-tight sm:text-5xl">
          {playlist.name}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {playlist.trackCount} {playlist.trackCount === 1 ? "track" : "tracks"}
          {playlist.durationMs > 0 && ` · ${fmtDuration(playlist.durationMs)}`}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onPlayAll}
            disabled={!hasSongs}
            aria-label="Play all"
            className="grid size-12 place-items-center rounded-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30 transition-all hover:scale-105 hover:bg-fuchsia-400 disabled:opacity-40"
          >
            <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete playlist"
            className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/5 hover:text-rose-300"
          >
            <Trash2 className="size-5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Deterministic hue (0–360) from a string. */
function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Horizontal scroll carousel of song cards. */
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
                  isCurrent
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0",
                )}
              >
                {showPause ? (
                  <Pause className="size-5" fill="currentColor" aria-hidden />
                ) : (
                  <Play className="size-5 translate-x-0.5" fill="currentColor" aria-hidden />
                )}
              </button>
            </div>
            <p
              className={cn(
                "truncate text-sm font-semibold",
                isCurrent ? "text-fuchsia-300" : "text-foreground",
              )}
              title={song.title}
            >
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
              <Heart
                className={cn("size-3.5", song.liked ? "fill-rose-500 text-rose-500" : "text-white")}
                aria-hidden
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
