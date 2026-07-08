"use client";

import { motion } from "framer-motion";
import { useSession, signOut } from "next-auth/react";
import {
  Music2,
  Sparkles,
  Home,
  Heart,
  Search,
  Plus,
  Github,
  ListMusic,
  LogOut,
  Loader2,
  Compass,
  BarChart3,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AceStatusIndicator } from "./ace-status-indicator";

export type SidebarView = "create" | "library" | "liked" | "playlist" | "browse" | "analytics" | "settings";

export interface AppSidebarProps {
  view: SidebarView;
  onViewChange: (v: SidebarView) => void;
  trackCount: number;
  likedCount: number;
  isGenerating: boolean;
  /** Search query (drives the Library filter). */
  search: string;
  onSearchChange: (q: string) => void;
  /** The user's playlists (rendered under Library). */
  playlists: Array<{ id: string; name: string; trackCount: number }>;
  /** Open the create-playlist dialog. */
  onCreatePlaylist: () => void;
  /** Open a specific playlist view. */
  onOpenPlaylist: (id: string) => void;
  /** The currently-open playlist id (for highlight). */
  activePlaylistId?: string | null;
}

/**
 * Spotify-style left sidebar: brand + primary nav (Home / Search / Create) and
 * a "Your Library" section with All / Liked filters. On mobile it collapses to
 * a 64px icon rail; on lg+ it's a fixed 260px column with the search box.
 */
export function AppSidebar({
  view,
  onViewChange,
  trackCount,
  likedCount,
  isGenerating,
  search,
  onSearchChange,
  playlists,
  onCreatePlaylist,
  onOpenPlaylist,
  activePlaylistId,
}: AppSidebarProps) {
  return (
    <aside
      aria-label="Primary navigation"
      className="hidden h-dvh w-[260px] shrink-0 flex-col gap-2 border-r border-white/[0.06] bg-black/40 p-2 sm:flex"
    >
      {/* Brand + top nav card */}
      <div className="rounded-lg bg-[#121214] p-3">
        <a
          href="/"
          className="mb-3 flex items-center gap-2.5 rounded-md px-2 py-1 focus-visible:outline-none"
          aria-label="SpotiBot home"
        >
          <img
            src="/spotibot-brand.png"
            alt="SpotiBot logo"
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-lg shadow-lg shadow-fuchsia-500/20"
            draggable={false}
          />
          <span className="flex flex-col leading-none">
            <span className="gradient-text text-lg font-bold tracking-tight">
              SpotiBot
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
              Le bot de musique moderne
            </span>
          </span>
        </a>

        <nav className="flex flex-col gap-1">
          <NavBtn
            active={view === "create"}
            onClick={() => onViewChange("create")}
            icon={<Home className="size-5" aria-hidden />}
            label="Home"
          />
          <NavBtn
            active={view === "browse"}
            onClick={() => onViewChange("browse")}
            icon={<Compass className="size-5" aria-hidden />}
            label="Browse"
          />
          <NavBtn
            active={view === "analytics"}
            onClick={() => onViewChange("analytics")}
            icon={<BarChart3 className="size-5" aria-hidden />}
            label="Analytics"
          />
          <NavBtn
            active={view === "settings"}
            onClick={() => onViewChange("settings")}
            icon={<SettingsIcon className="size-5" aria-hidden />}
            label="Settings"
          />
          <button
            type="button"
            onClick={() => onViewChange("library")}
            className={cn(
              "flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors",
              view === "library"
                ? "bg-white/10 text-white"
                : "text-muted-foreground hover:text-white",
            )}
          >
            <Search className="size-5" aria-hidden />
            <span>Search</span>
          </button>
        </nav>
      </div>

      {/* Library card */}
      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-[#121214] p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => onViewChange("library")}
            className="flex items-center gap-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-white"
          >
            <ListMusic className="size-5" aria-hidden />
            Your Library
          </button>
          <button
            type="button"
            onClick={() => onViewChange("create")}
            aria-label="Create new song"
            title="Create new song"
            className={cn(
              "grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-white",
              isGenerating && "text-fuchsia-400",
            )}
          >
            <Plus className={cn("size-4", isGenerating && "animate-spin")} aria-hidden />
          </button>
        </div>

        {/* Filter chips: All / Liked */}
        <div className="mb-3 flex gap-2 px-1">
          <FilterChip
            active={view === "library"}
            onClick={() => onViewChange("library")}
          >
            All
          </FilterChip>
          <FilterChip
            active={view === "liked"}
            onClick={() => onViewChange("liked")}
          >
            <Heart className="mr-1 size-3" aria-hidden />
            Liked
          </FilterChip>
        </div>

        {/* Search box (Library only) */}
        {view !== "create" && (
          <div className="mb-2 px-1">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search in library"
                aria-label="Search your library"
                className="h-9 w-full rounded-md border border-white/[0.06] bg-white/[0.04] pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-fuchsia-400/30 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Library list (All / Liked entries + playlists) */}
        <div className="-mr-1 flex-1 overflow-y-auto pr-1">
          <LibraryEntry
            active={view === "library" && !activePlaylistId}
            onClick={() => onViewChange("library")}
            icon={<ListMusic className="size-5" aria-hidden />}
            title="All Tracks"
            subtitle={`${trackCount} ${trackCount === 1 ? "track" : "tracks"}`}
          />
          <LibraryEntry
            active={view === "liked"}
            onClick={() => onViewChange("liked")}
            icon={
              <span className="grid size-12 place-items-center rounded-md bg-gradient-to-br from-purple-500 to-fuchsia-600">
                <Heart className="size-5 fill-white text-white" aria-hidden />
              </span>
            }
            title="Liked Songs"
            subtitle={`${likedCount} ${likedCount === 1 ? "track" : "tracks"}`}
          />

          {/* Playlists divider + create button */}
          {playlists.length > 0 && (
            <div className="px-2 pb-1 pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Playlists
              </span>
            </div>
          )}
          {playlists.map((p) => (
            <LibraryEntry
              key={p.id}
              active={activePlaylistId === p.id}
              onClick={() => onOpenPlaylist(p.id)}
              icon={
                <span
                  className="grid size-12 place-items-center rounded-md"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hueFromName(p.name)} 65% 48%), hsl(${(hueFromName(p.name) + 60) % 360} 65% 42%))`,
                  }}
                >
                  <ListMusic className="size-5 text-white/90" aria-hidden />
                </span>
              }
              title={p.name}
              subtitle={`Playlist · ${p.trackCount} ${p.trackCount === 1 ? "track" : "tracks"}`}
            />
          ))}

          {/* Create playlist row */}
          <button
            type="button"
            onClick={onCreatePlaylist}
            className="mt-2 flex w-full items-center gap-3 rounded-md p-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            <span className="grid size-12 place-items-center rounded-md bg-gradient-to-br from-fuchsia-500/80 to-purple-600/80">
              <Plus className="size-5 text-white" aria-hidden />
            </span>
            <span className="font-medium">Create Playlist</span>
          </button>
        </div>
      </div>

      {/* Footer: status + links + user */}
      <div className="rounded-lg bg-[#121214] p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <AceStatusIndicator />
          <a
            href="https://github.com/ace-step/ACE-Step-1.5"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View ACE-Step source on GitHub"
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <Github className="size-4" aria-hidden />
          </a>
        </div>
        <UserBar />
      </div>
    </aside>
  );
}

/** Internal: a primary nav button. */
function NavBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors",
        active ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Internal: a small filter chip. */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-white text-black"
          : "bg-white/[0.06] text-muted-foreground hover:bg-white/10 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/** Internal: a library list entry (Spotify playlist-row style). */
function LibraryEntry({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md p-1.5 text-left transition-colors",
        active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium", active ? "text-fuchsia-200" : "text-foreground/90")}>
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

/** Deterministic hue (0–360) for a playlist's gradient, derived from its name. */
function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/**
 * User bar: shows the signed-in user's avatar + email + a sign-out button.
 * Renders a skeleton while the session is loading.
 */
function UserBar() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 px-1 py-1.5">
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  const name = session.user.name ?? session.user.email ?? "User";
  const email = session.user.email ?? "";
  const image = session.user.image;
  const initials = name.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-white/[0.04]">
      {image ? (
        <img src={image} alt="" className="size-7 rounded-full" />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-xs font-bold text-white">
          {initials}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{name}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{email}</span>
      </span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/signin" })}
        aria-label="Sign out"
        title="Sign out"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-rose-300"
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export default AppSidebar;
