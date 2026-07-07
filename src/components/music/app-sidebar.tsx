"use client";

import { motion } from "framer-motion";
import { Music2, Sparkles, Library, Wand2, Heart, Github } from "lucide-react";
import { cn } from "@/lib/utils";
import { AceStatusIndicator } from "./ace-status-indicator";

export type SidebarView = "create" | "library";

export interface AppSidebarProps {
  /** Currently-active view. */
  view: SidebarView;
  /** Switch the active view. */
  onViewChange: (v: SidebarView) => void;
  /** Total track count (shown next to Library). */
  trackCount: number;
  /** Liked track count (shown next to a liked filter). */
  likedCount: number;
  /** Whether the liked filter is on (Library view only). */
  likedOnly: boolean;
  /** Toggle the liked filter. */
  onToggleLikedOnly: () => void;
  /** Whether a generation is in-flight. */
  isGenerating: boolean;
}

/**
 * Suno-style left sidebar: brand at top, primary nav (Create / Library), a
 * liked-tracks filter, the Ace Music connection status, and footer links.
 *
 * On mobile this collapses into a slim icon rail; on sm+ it expands to a
 * fixed 248px column.
 */
export function AppSidebar({
  view,
  onViewChange,
  trackCount,
  likedCount,
  likedOnly,
  onToggleLikedOnly,
  isGenerating,
}: AppSidebarProps) {
  return (
    <aside
      aria-label="Primary navigation"
      className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col border-r border-white/10 bg-[#0b0b12]/80 backdrop-blur-xl sm:w-[248px]"
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-3 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-rose-500 shadow-lg shadow-fuchsia-500/25">
          <Music2 className="size-5 text-white" aria-hidden />
        </span>
        <div className="hidden flex-col leading-none sm:flex">
          <span className="gradient-text text-lg font-bold tracking-tight">
            AceMusic
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70">
            Studio
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 p-2 sm:p-3">
        <NavButton
          active={view === "create"}
          onClick={() => onViewChange("create")}
          icon={<Wand2 className="size-5" aria-hidden />}
          label="Create"
          showLabel
          badge={
            isGenerating ? (
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                className="size-1.5 rounded-full bg-fuchsia-400"
              />
            ) : undefined
          }
        />
        <NavButton
          active={view === "library"}
          onClick={() => onViewChange("library")}
          icon={<Library className="size-5" aria-hidden />}
          label="Library"
          showLabel
          badge={
            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
              {trackCount}
            </span>
          }
        />

        {/* Liked filter — only relevant in Library view */}
        <button
          type="button"
          disabled={view !== "library"}
          onClick={onToggleLikedOnly}
          aria-pressed={likedOnly}
          className={cn(
            "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40",
            likedOnly && view === "library"
              ? "bg-rose-500/15 text-rose-200"
              : "text-foreground/75 hover:bg-white/5 hover:text-foreground",
          )}
        >
          <Heart
            className={cn(
              "size-5 shrink-0",
              likedOnly && view === "library" && "fill-rose-400 text-rose-400",
            )}
            aria-hidden
          />
          <span className="hidden text-sm font-medium sm:inline">Liked</span>
          {likedCount > 0 && (
            <span className="ml-auto hidden text-[10px] font-semibold tabular-nums text-muted-foreground sm:inline">
              {likedCount}
            </span>
          )}
        </button>
      </nav>

      {/* Status + footer */}
      <div className="border-t border-white/10 p-2 sm:p-3">
        <div className="hidden px-1 pb-2 sm:block">
          <AceStatusIndicator />
        </div>
        <a
          href="https://acemusic.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground/70 transition-colors hover:bg-white/5 hover:text-fuchsia-200 sm:flex"
          title="acemusic.ai — the world's first open-source Music AI platform"
        >
          <Sparkles className="size-3.5" aria-hidden />
          Ace Music v1.5
        </a>
        <a
          href="https://github.com/ace-step/ACE-Step-1.5"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View ACE-Step source on GitHub (opens in a new tab)"
          className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground sm:justify-start sm:gap-2 sm:px-3 sm:text-xs"
        >
          <Github className="size-4 sm:size-3.5" aria-hidden />
          <span className="hidden sm:inline">Source</span>
        </a>
      </div>
    </aside>
  );
}

/** Internal: a nav button with icon + label + optional badge. */
function NavButton({
  active,
  onClick,
  icon,
  label,
  badge,
  showLabel,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all",
        active
          ? "bg-gradient-to-r from-fuchsia-500/20 to-purple-500/10 text-fuchsia-100 ring-1 ring-fuchsia-400/25"
          : "text-foreground/75 hover:bg-white/5 hover:text-foreground",
      )}
    >
      <span className={cn("shrink-0", active && "text-fuchsia-300")}>{icon}</span>
      {showLabel && <span className="hidden text-sm font-medium sm:inline">{label}</span>}
      {badge && <span className="ml-auto hidden sm:flex sm:items-center">{badge}</span>}
    </button>
  );
}

export default AppSidebar;
