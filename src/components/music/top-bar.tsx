"use client";

import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeToggle from "./theme-toggle";
import { NotificationBell } from "./notification-bell";

export interface TopBarProps {
  /** Show the "Create" CTA on the right. */
  onCreate: () => void;
  isGenerating: boolean;
  /** Search query (Library view). */
  search: string;
  onSearchChange: (q: string) => void;
  /** Whether the search box is visible (Library view only). */
  showSearch: boolean;
}

/**
 * Spotify-style sticky top bar: back/forward nav arrows on the left, a search
 * box (Library view), and a gradient "Create" CTA on the right.
 */
export function TopBar({ onCreate, isGenerating, search, onSearchChange, showSearch }: TopBarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 items-center gap-3 px-6 transition-colors",
        "bg-gradient-to-b from-black/60 to-transparent backdrop-blur-md",
      )}
    >
      {/* Nav arrows */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => window.history.back()}
          className="grid size-8 place-items-center rounded-full bg-black/60 text-white/80 transition-colors hover:bg-black/80"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Forward"
          onClick={() => window.history.forward()}
          className="grid size-8 place-items-center rounded-full bg-black/60 text-white/80 transition-colors hover:bg-black/80"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      {/* Search (Library view) */}
      {showSearch && (
        <div className="relative ml-2 max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="What do you want to play?"
            aria-label="Search tracks"
            className="h-10 w-full rounded-full border border-white/[0.06] bg-white/[0.06] pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-white/20 focus:outline-none"
          />
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <ThemeToggle />
        <button
          type="button"
          onClick={onCreate}
          disabled={isGenerating}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 disabled:opacity-60"
        >
          <Plus className={cn("size-4", isGenerating && "animate-spin")} aria-hidden />
          {isGenerating ? "Generating…" : "Create"}
        </button>
      </div>
    </header>
  );
}

export default TopBar;
